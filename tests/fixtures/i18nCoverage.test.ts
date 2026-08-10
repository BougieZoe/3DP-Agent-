/**
 * i18n coverage guard.
 *
 * The shared content dictionary is the single source of truth for localized
 * analysis text. These checks make sure the keyed system stays consistent:
 *  - every CONTENT entry has all three languages populated;
 *  - every `translate(CONTENT, 'key', ...)` used in the localized source files
 *    resolves to a defined entry (no typo'd/missing keys);
 *  - dynamic keys (agent labels/descriptions, material support labels) resolve
 *    for every known variant.
 *
 * NOTE: this guards the keyed system. It does not (and cheaply cannot) catch a
 * developer bypassing translate() with a raw hardcoded English literal — that
 * is the job of code review / the audit. The test prevents the common,
 * mechanical regression: adding a new key but forgetting one language, or
 * referencing a key that doesn't exist.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../../shared/i18n/content';

/** Directories expected to localize their user-facing text via translate(CONTENT, ...). */
const SCOPED_DIRS = [
  'client/src/agents',
  'client/src/analysis',
  'client/src/lib',
  'client/src/components',
];

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (/\.(ts|tsx)$/.test(entry) && !/__tests__/.test(p)) {
        files.push(p);
      }
    }
  };
  for (const d of SCOPED_DIRS) walk(d);
  return files;
}

function usedStaticKeys(): string[] {
  const keys = new Set<string>();
  const re = /translate\(\s*CONTENT\s*,\s*['"]([^'"]+)['"]/g;
  for (const file of sourceFiles()) {
    const src = readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(src)) !== null) keys.add(m[1]);
  }
  return Array.from(keys);
}

describe('i18n content coverage', () => {
  it('every content entry has all three languages populated', () => {
    const bad = Object.entries(CONTENT).filter(([, e]) => !e.en || !e.ja || !e.zh);
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('every static translate(CONTENT, ...) key used in source is defined', () => {
    const missing = usedStaticKeys().filter(k => !CONTENT[k]);
    expect(missing).toEqual([]);
  });

  it('dynamic content keys resolve for every known variant', () => {
    const agentIds = ['geometry_analyst', 'printability_scorer', 'failure_predictor', 'optimization_advisor'];
    for (const id of agentIds) {
      expect(CONTENT[`agentName.${id}`], `agentName.${id}`).toBeDefined();
      expect(CONTENT[`agentDesc.${id}`], `agentDesc.${id}`).toBeDefined();
    }
    for (const s of ['minimal', 'standard', 'required', 'asNeeded']) {
      expect(CONTENT[`optimizationAdvisor.matSupport.${s}`], `matSupport.${s}`).toBeDefined();
    }
  });
});
