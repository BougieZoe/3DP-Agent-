/**
 * Progressive translation overlays.
 *
 * catalog.ts is the single authored catalogue and is already ~5.5k lines. To
 * avoid growing it further, per-language translation batches live in
 * ./lang/<code>.ts and are merged into the catalogue at module load.
 *
 * Rules
 * -----
 * - An overlay may only *fill in* a language slot that is still empty. It can
 *   never overwrite an authored string, so a batch file cannot silently change
 *   existing copy.
 * - An overlay may not introduce new keys: a typo in a key name is dropped
 *   instead of creating an orphan entry nobody reads.
 * - Keys missing from every overlay keep resolving to English through
 *   FALLBACK_LANG, and `scripts/i18n-audit.mjs` reports what is left.
 */
export type OverlayTable = Record<string, string>;

export function applyOverlays(
  catalogue: Record<string, Record<string, string>>,
  overlays: Record<string, OverlayTable | undefined>,
): { applied: number; ignoredLanguages: string[] } {
  let applied = 0;
  const ignoredLanguages: string[] = [];
  for (const [lang, table] of Object.entries(overlays)) {
    if (!table) {
      ignoredLanguages.push(lang);
      continue;
    }
    for (const [key, text] of Object.entries(table)) {
      const entry = catalogue[key];
      if (!entry) continue; // unknown key: never create an orphan
      const current = entry[lang];
      if (typeof current === 'string' && current.trim().length > 0) continue; // authored wins
      if (typeof text !== 'string' || text.trim().length === 0) continue;
      entry[lang] = text;
      applied += 1;
    }
  }
  return { applied, ignoredLanguages };
}
