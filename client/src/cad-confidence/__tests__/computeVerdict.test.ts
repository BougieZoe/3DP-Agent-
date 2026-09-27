import { describe, it, expect } from 'vitest';
import { computeVerdict } from '../confidenceEngine';
import { getThresholds } from '@/analysis/thresholds';

/**
 * Byte-copy of the pre-migration body. Kept ONLY as the equivalence oracle for
 * the cleanup: the middle `>= 50` branch was unreachable (same guard, same
 * 'WARN' as the `>= 30` branch below it), so removing it must not move any
 * score across a verdict boundary.
 */
function legacyComputeVerdict(score: number, hasFailedChecks: boolean, hasWarningChecks: boolean): string {
  if (score >= 80 && !hasFailedChecks) return 'PASS';
  if (score >= 50 && !hasFailedChecks) return 'WARN';
  if (score >= 30 && !hasFailedChecks) return 'WARN';
  return 'FAIL';
}

describe('cad-confidence computeVerdict — dead-branch cleanup', () => {
  it('matches the legacy implementation for every integer score 0..100, failed or not', () => {
    const mismatches: string[] = [];
    for (let score = 0; score <= 100; score++) {
      for (const failed of [false, true]) {
        const actual = computeVerdict(score, failed, false);
        const legacy = legacyComputeVerdict(score, failed, false);
        if (actual !== legacy) mismatches.push(`score=${score} failed=${failed}: ${actual} != ${legacy}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('honours the ruling thresholds at their exact boundaries', () => {
    const r = getThresholds().ruling;
    expect(computeVerdict(r.cadPassMinScore, false, false)).toBe('PASS');
    expect(computeVerdict(r.cadPassMinScore - 1, false, false)).toBe('WARN');
    expect(computeVerdict(r.cadWarnMinScore, false, false)).toBe('WARN');
    expect(computeVerdict(r.cadWarnMinScore - 1, false, false)).toBe('FAIL');
  });

  it('fails on failed checks regardless of score', () => {
    expect(computeVerdict(100, true, false)).toBe('FAIL');
    expect(computeVerdict(0, true, true)).toBe('FAIL');
  });

  it('is unaffected by warning checks (API-compatibility argument)', () => {
    for (const warning of [false, true]) {
      expect(computeVerdict(85, false, warning)).toBe('PASS');
      expect(computeVerdict(40, false, warning)).toBe('WARN');
    }
  });
});
