import { describe, it, expect } from 'vitest';
import { deriveVerdict, VERDICT_THRESHOLDS } from '../AnalysisVerdictBar';

/**
 * The verdict is a precedence rollup over states the pipeline already produced.
 * These cases pin the precedence order: a mesh-integrity failure must outrank a
 * severity warning, and "unknown" must never collapse into "ready" (AGENTS.md:
 * never coerce unknown into pass).
 */
describe('deriveVerdict', () => {
  const base = {
    available: true,
    isWatertight: true,
    isManifold: true,
    wallStatus: 'good' as const,
    overhangStatus: 'good' as const,
  };

  it('returns ready only when every fact passed', () => {
    expect(deriveVerdict(base)).toBe('ready');
  });

  it('blocks on a non-watertight mesh even when wall and overhang look fine', () => {
    expect(deriveVerdict({ ...base, isWatertight: false })).toBe('blocked');
  });

  it('blocks on a non-manifold mesh', () => {
    expect(deriveVerdict({ ...base, isManifold: false })).toBe('blocked');
  });

  it('reports fix when either geometry status is critical', () => {
    expect(deriveVerdict({ ...base, wallStatus: 'critical' })).toBe('fix');
    expect(deriveVerdict({ ...base, overhangStatus: 'critical' })).toBe('fix');
  });

  it('reports minor when either geometry status is a warning', () => {
    expect(deriveVerdict({ ...base, wallStatus: 'warning' })).toBe('minor');
    expect(deriveVerdict({ ...base, overhangStatus: 'warning' })).toBe('minor');
  });

  it('stays unknown when a required status is missing instead of assuming pass', () => {
    expect(deriveVerdict({ ...base, wallStatus: null })).toBe('unknown');
    expect(deriveVerdict({ ...base, available: false })).toBe('unknown');
  });

  it('uses the analyzer thresholds rather than re-typed constants', () => {
    expect(VERDICT_THRESHOLDS.thinWallMm).toBe(0.8);
    expect(VERDICT_THRESHOLDS.overhangDeg).toBe(50);
  });
});
