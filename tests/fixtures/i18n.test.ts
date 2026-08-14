/**
 * i18n content-dictionary tests: parameter interpolation, per-language lookup,
 * and graceful fallbacks.
 */
import { describe, it, expect } from 'vitest';
import { translate, CONTENT } from '../../shared/i18n/content';

describe('translate', () => {
  it('interpolates params in the requested language', () => {
    expect(translate(CONTENT, 'failurePredictor.overhangDesc', 'zh', { faces: 3, threshold: 50 }))
      .toBe('3个面超过50°悬垂角 — 需支撑防止下垂');
    expect(translate(CONTENT, 'geometryAnalyst.widespreadThinWalls', 'ja', { pct: 45 }))
      .toBe('サンプリング領域の45%がFDM閾値未満');
    expect(translate(CONTENT, 'orchestrator.consensusScore', 'en', { score: 72, verdict: 'WARN' }))
      .toBe('Consensus Score: 72/100 (WARN)');
  });

  it('substitutes every occurrence of a param', () => {
    const zh = translate(CONTENT, 'optimizationAdvisor.overhangImpl', 'zh', { threshold: 50 });
    expect(zh).toContain('使用50°规则');
    expect(zh).toContain('小于50°的悬垂');
  });

  it('returns the key when the entry is missing', () => {
    expect(translate(CONTENT, 'missing.key', 'en')).toBe('missing.key');
  });
});
