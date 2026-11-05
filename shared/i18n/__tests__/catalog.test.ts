import { describe, it, expect } from 'vitest';
import { MESSAGES } from '../catalog';
import { CONTENT, translate } from '../content';
import { getTranslation, translations } from '@/lib/i18n';

const keys = Object.keys(MESSAGES);

/**
 * One catalogue, two views (UI flat map + pipeline translate()). These tests
 * pin the invariants that made the old two-store arrangement unsafe: no
 * missing language, no empty string, and both lookup paths reading the same
 * source.
 */
describe('message catalogue', () => {
  it('has a non-trivial number of messages', () => {
    expect(keys.length).toBeGreaterThan(900);
  });

  it('carries en, ja and zh for every key', () => {
    const bad: string[] = [];
    for (const [key, entry] of Object.entries(MESSAGES)) {
      for (const lang of ['en', 'ja', 'zh'] as const) {
        const v = (entry as Record<string, string>)[lang];
        if (typeof v !== 'string' || v.trim().length === 0) bad.push(`${key}.${lang}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('exposes the same value through both lookup APIs', () => {
    for (const key of ['pdf.labelQuickCheck', 'causality.chainHeader', 'title', 'verdictReady']) {
      for (const lang of ['en', 'ja', 'zh'] as const) {
        expect(getTranslation(lang, key)).toBe(translate(CONTENT, key, lang));
      }
    }
  });

  it('keeps the flat UI map and the keyed dict in sync', () => {
    expect(Object.keys(translations.en)).toHaveLength(keys.length);
    expect(Object.keys(CONTENT)).toHaveLength(keys.length);
  });

  it('interpolates {param} placeholders through both APIs', () => {
    const templateKey = keys.find((k) => MESSAGES[k as keyof typeof MESSAGES].en.includes('{'));
    expect(templateKey).toBeTruthy();
    const params = { n: 3, count: 3, pct: 3, v: 3, min: 3, faces: 3, threshold: 3, x: 3, y: 3, z: 3, process: 3, message: 3, list: 3 };
    const out = getTranslation('en', templateKey!, params);
    const out2 = translate(CONTENT, templateKey!, 'en', params);
    expect(out).not.toMatch(/\{(n|count|pct|v|min|faces|threshold)\}/);
    expect(out).toBe(out2);
  });
});
