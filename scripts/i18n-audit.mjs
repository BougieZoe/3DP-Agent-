#!/usr/bin/env node
/**
 * i18n audit — reports what is still not translated.
 *
 * Two failure modes are measured separately, because they need different fixes:
 *
 *  1. HARDCODED  — CJK string literals sitting directly in UI/pipeline source.
 *     These ignore the language selector entirely: switching to German shows
 *     Chinese, which is exactly the bug this audit exists to catch.
 *     Components that carry their own per-language tables (`{ zh: {…}, en: {…} }`)
 *     are already selector-aware, so those entries are excluded here — counting
 *     them used to make the number grow every time a translation was added.
 *     Regex/keyword tables (ruleEngine, intentParser) are still counted: they
 *     never reach the UI, but they are neither translated nor data — read them
 *     as "language-specific logic", not as copy to migrate.
 *  2. MISSING    — catalogue keys that no longer carry a translation for a
 *     supported language. They fall back to English, so they are a translation
 *     backlog, not a correctness bug.
 *
 * Usage: node scripts/i18n-audit.mjs [--json] [--limit N]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CATALOG = join(ROOT, 'shared/i18n/catalog.ts');
const SCAN_DIRS = ['client/src', 'shared'];
// Source of truth for the language list; keep in sync with
// shared/i18n/content.ts SUPPORTED_LANGUAGES.
const LANGS = ['en', 'ja', 'zh', 'ko', 'de', 'es', 'fr', 'it', 'sv'];
const BASELINE = ['en', 'ja', 'zh'];
const CJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
/**
 * Files whose CJK is *translation data*, not hardcoded UI copy: per-language
 * label tables and overlay batches. They exist precisely to serve the selector,
 * so counting them would drown the real signal.
 */
const DATA_FILE = /(^|\/)shared\/i18n\/lang\/|(^|\/)client\/src\/components\/yieldUi\.ts$|(^|\/)client\/src\/lib\/yieldLabels\.ts$/;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 20 : 20;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * In-component translation tables are not hardcoded UI copy: a component that
 * carries its own per-language map (`{ zh: {…}, en: {…} }`) is already
 * selector-aware. Counting those entries made the number go UP every time a
 * translation was added, which is the opposite of what this audit means.
 * Returns 1-based line numbers that are translation data or block comments.
 */
const LANG_START = new RegExp(`^\\s*(${LANGS.join('|')})\\s*:\\s*[\\{[]`);

function dataLines(src) {
  const lines = src.split('\n');
  const skip = new Set();
  // 1) per-language tables: brace/bracket-matched ranges starting at `xx: {`
  for (let i = 0; i < lines.length; i += 1) {
    if (!LANG_START.test(lines[i])) continue;
    let depth = 0;
    let opened = false;
    let j = i;
    for (; j < lines.length; j += 1) {
      for (const ch of lines[j]) {
        if (ch === '{' || ch === '[') {
          depth += 1;
          opened = true;
        } else if (ch === '}' || ch === ']') depth -= 1;
      }
      if (opened && depth <= 0) break;
    }
    const end = Math.min(j + 1, lines.length);
    for (let n = i + 1; n <= end; n += 1) skip.add(n);
    i = j;
  }
  // 2) block comments (multi-line JSDoc with Chinese prose)
  let inComment = false;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (inComment) {
      skip.add(i + 1);
      if (t.includes('*/')) inComment = false;
    } else if (t.startsWith('/*') && !t.includes('*/')) {
      inComment = true;
      skip.add(i + 1);
    }
  });
  return skip;
}

let dictSkipped = 0;

/** Count CJK literals that actually reach the UI (skips comments and keys). */
function scanHardcoded() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    let entries = [];
    try {
      entries = walk(join(ROOT, dir));
    } catch {
      continue;
    }
    for (const file of entries) {
      if (file.endsWith('catalog.ts')) continue;
      if (DATA_FILE.test(relative(ROOT, file))) continue;
      const src = readFileSync(file, 'utf8');
      const hits = [];
      const skip = dataLines(src);
      src.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (skip.has(i + 1)) {
          if (CJK.test(line)) dictSkipped += 1;
          return;
        }
        const literals = line.match(/(["'`>])([^"'`<>\n]*)(["'`<])/g) ?? [];
        for (const lit of literals) {
          if (CJK.test(lit)) hits.push({ line: i + 1, text: lit.trim().slice(0, 120) });
        }
      });
      if (hits.length) files.push({ file: relative(ROOT, file), count: hits.length, hits });
    }
  }
  return files.sort((a, b) => b.count - a.count);
}

/** Catalogue keys missing a language, plus per-language coverage. */
function scanCatalog() {
  const src = readFileSync(CATALOG, 'utf8');
  const blocks = [...src.matchAll(/"([^"]+)":\s*\{([\s\S]*?)\n  \}/g)];
  const perLang = Object.fromEntries(LANGS.map((l) => [l, 0]));
  const missing = Object.fromEntries(LANGS.map((l) => [l, []]));
  const baselineGaps = [];
  for (const [, key, body] of blocks) {
    for (const lang of LANGS) {
      const m = body.match(new RegExp(`(?:^|[\\s{,])${lang}:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
      if (m && m[1].trim()) {
        perLang[lang] += 1;
      } else {
        missing[lang].push(key);
        if (BASELINE.includes(lang)) baselineGaps.push(`${key}.${lang}`);
      }
    }
  }
  // Overlay batches (shared/i18n/lang/*.ts) fill languages progressively and
  // are merged into MESSAGES at load; count them here too or the coverage
  // report would always claim 0% for the newer languages.
  const overlaysDir = join(ROOT, 'shared/i18n/lang');
  let overlayFiles = [];
  try {
    overlayFiles = readdirSync(overlaysDir).filter((n) => n.endsWith('.ts'));
  } catch {
    overlayFiles = [];
  }
  const overlayCounts = {};
  for (const name of overlayFiles) {
    const lang = name.replace(/\.ts$/, '');
    if (!LANGS.includes(lang)) continue;
    const src = readFileSync(join(overlaysDir, name), 'utf8');
    const keys = [...src.matchAll(/^\s{2}(?:"([^"]+)"|([A-Za-z0-9_]+)):\s*['"`]/gm)].map(
      (m) => m[1] ?? m[2],
    );
    overlayCounts[lang] = keys;
  }
  for (const [lang, keys] of Object.entries(overlayCounts)) {
    const known = new Set(missing[lang]);
    const applied = keys.filter((k) => known.has(k));
    perLang[lang] += applied.length;
    missing[lang] = missing[lang].filter((k) => !keys.includes(k));
  }

  return { total: blocks.length, perLang, missing, baselineGaps, overlays: Object.fromEntries(
    Object.entries(overlayCounts).map(([l, k]) => [l, k.length]),
  ) };
}

const hardcoded = scanHardcoded();
const catalog = scanCatalog();
const hardcodedTotal = hardcoded.reduce((n, f) => n + f.count, 0);

if (asJson) {
  console.log(JSON.stringify({ hardcodedTotal, dictSkipped, hardcoded, catalog }, null, 2));
  process.exit(0);
}

const pct = (n) => `${((n / Math.max(1, catalog.total)) * 100).toFixed(1)}%`;

console.log(`\ni18n audit — ${catalog.total} catalogue keys, ${LANGS.length} languages\n`);
console.log('Coverage per language:');
for (const lang of LANGS) {
  const done = catalog.perLang[lang];
  const flag = BASELINE.includes(lang) ? '' : done === catalog.total ? '' : '  ← fallback to English';
  console.log(`  ${lang.padEnd(3)} ${String(done).padStart(5)}  ${pct(done).padStart(6)}${flag}`);
}
console.log(`\nBaseline gaps (en/ja/zh, must be zero): ${catalog.baselineGaps.length}`);
if (catalog.baselineGaps.length) console.log('  ' + catalog.baselineGaps.slice(0, LIMIT).join(', '));

console.log(`\nHardcoded CJK literals outside the catalogue: ${hardcodedTotal} in ${hardcoded.length} files`);
if (dictSkipped) {
  console.log(`  (${dictSkipped} CJK lines inside in-component translation tables / block`);
  console.log('   comments were excluded — they are selector-aware data, not missed copy)');
}
for (const f of hardcoded.slice(0, LIMIT)) {
  console.log(`  ${String(f.count).padStart(4)}  ${f.file}`);
  if (process.env.I18N_AUDIT_VERBOSE) {
    for (const h of f.hits.slice(0, 5)) console.log(`         L${h.line} ${h.text}`);
  }
}
if (hardcoded.length > LIMIT) console.log(`  … ${hardcoded.length - LIMIT} more files`);
console.log('\nRule: anything hardcoded ignores the language selector. Migrate it into');
console.log('shared/i18n/catalog.ts, or accept the English fallback for the new languages.');
console.log('Exit code is 0 unless a baseline (en/ja/zh) translation is actually missing.\n');

process.exit(catalog.baselineGaps.length === 0 ? 0 : 1);
