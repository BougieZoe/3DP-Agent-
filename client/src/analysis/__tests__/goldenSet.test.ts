/**
 * GOLDEN SET — regression contract for the analysis pipeline, pinned against
 * real STL bytes (see `goldenSamples.ts` for provenance).
 *
 * What these assertions protect
 * -----------------------------
 * The calibration work found the front-end engine is *right* on three things
 * the Python engine gets wrong. Those are load-bearing product behaviour and
 * are asserted hard here so a future refactor cannot silently regress them:
 *
 *   1. Wall thickness is measured from the sampling pipeline, NOT read off the
 *      bounding-box minimum edge (test_model: 0.757mm measured vs 1.98mm bbox).
 *   2. Bed-contact faces are not counted as overhang (t_cube20 / t_big300: 0.0).
 *   3. Oversize parts are caught by bedFit (t_big300: 300mm → fits === false).
 *
 * Assertion levels
 * ----------------
 * - Hard `expect`: an invariant of correct behaviour; must never regress.
 * - `it.todo`: a known gap with a decided fix but no implementation yet. These
 *   are deliberately NOT written as assertions — pinning a defective value into
 *   a snapshot is how a bug gets enshrined as "expected".
 */

import {
  analyzeGolden,
  GOLDEN_SAMPLE_NAMES,
  GOLDEN_SAMPLE_LABELS,
  type GoldenSampleName,
} from './goldenSamples';

/** Bounding-box minimum edge, used to prove min-wall is NOT derived from it. */
function bboxMinEdge(name: GoldenSampleName): number {
  const d = analyzeGolden(name).metrics.result!.boundingBoxDimensionsMm;
  return Math.min(d.x, d.y, d.z);
}

describe('golden set — real STL bytes through the real pipeline', () => {
  it('every sample loads and analyzes without throwing', () => {
    for (const name of GOLDEN_SAMPLE_NAMES) {
      // Sanity: the label table stays in sync with the sample list.
      expect(GOLDEN_SAMPLE_LABELS[name]).toBeTruthy();
      expect(() => analyzeGolden(name)).not.toThrow();
    }
  });

  it('t_cube20 — watertight 20mm cube: exact volume, full wall, no overhang', () => {
    const a = analyzeGolden('t_cube20');
    expect(a.validation.result?.isWatertight).toBe(true);
    expect(a.validation.result?.holeCount).toBe(0);
    expect(a.metrics.result?.meshVolumeMm3).toBeCloseTo(8000, 6);
    expect(a.metrics.result?.boundingBoxVolumeMm3).toBeCloseTo(8000, 6);
    expect(a.metrics.result?.minWallThicknessMm).toBeCloseTo(20, 6);
    expect(a.metrics.result?.volumeReliable).toBe(true);
    // Bed-contact faces must NOT be flagged as overhang.
    expect(a.metrics.result?.overhang?.ratio).toBe(0);
    expect(a.scaleGuard?.result?.status).toBe('ok');
  });

  it('t_big300 — 300mm part is rejected by bedFit (Python passed it as printable)', () => {
    const a = analyzeGolden('t_big300');
    expect(a.validation.result?.isWatertight).toBe(true);
    expect(a.metrics.result?.meshVolumeMm3).toBeCloseTo(27_000_000, 3);
    expect(a.metrics.result?.volumeReliable).toBe(true);
    expect(a.bedFit?.result?.fits).toBe(false);
    // A cube resting on the bed has no overhang — the whole bottom face is support.
    expect(a.metrics.result?.overhang?.ratio).toBe(0);
  });

  it('test_model — min wall is MEASURED, not the bounding-box minimum edge', () => {
    const a = analyzeGolden('test_model');
    const measured = a.metrics.result?.minWallThicknessMm;
    const bboxMin = bboxMinEdge('test_model');

    expect(a.validation.result?.isWatertight).toBe(false);
    expect(a.validation.result?.holeCount).toBeGreaterThan(0);
    expect(measured).not.toBeNull();
    expect(a.metrics.result?.volumeReliable).toBe(false);
    // The two must disagree — this is the defect the Python engine shipped.
    expect(bboxMin).toBeGreaterThan(1.5);
    expect(measured!).toBeLessThan(1);
    expect(measured!).toBeCloseTo(0.757, 2);
  });

  it('t_thinwall05 — 0.5mm plate raises a thin-wall signal at low confidence', () => {
    const a = analyzeGolden('t_thinwall05');
    expect(a.validation.result?.isWatertight).toBe(true);
    expect(a.metrics.result?.minWallThicknessMm).toBeCloseTo(0.5, 6);
    expect(a.metrics.result?.thinWallRatio).toBeGreaterThan(0);
    expect(a.overallConfidence).toBeLessThan(0.3);
  });

  it('t_cone — curved solid volume tracks the analytic value', () => {
    const a = analyzeGolden('t_cone');
    const v = a.metrics.result?.meshVolumeMm3 ?? 0;
    // Analytic: π·10²·20/3 = 2094.4mm³; faceting undershoots slightly.
    expect(v).toBeGreaterThan(2050);
    expect(v).toBeLessThan(2100);
  });

  it('t_sphere10 — curved solid volume + bed-contact-only overhang', () => {
    const a = analyzeGolden('t_sphere10');
    const v = a.metrics.result?.meshVolumeMm3 ?? 0;
    // Analytic: 4/3·π·10³ = 4188.8mm³; faceting undershoots slightly.
    expect(v).toBeGreaterThan(4100);
    expect(v).toBeLessThan(4190);
    // Overhang is moderate — the sphere's underside, not the flat contact patch.
    expect(a.metrics.result?.overhang?.severity).toBe('moderate');
  });

  it('test_cube — 1mm part trips the inch-misread sentinel', () => {
    const a = analyzeGolden('test_cube');
    expect(a.validation.result?.isWatertight).toBe(false);
    expect(a.scaleGuard?.result?.status).toBe('suspect_inch');
    expect(a.scaleGuard?.result?.suggestedScale).toBe(25.4);
    expect(a.metrics.result?.volumeReliable).toBe(false);
  });

  it('t_openbox — one missing face is detected as non-watertight', () => {
    const a = analyzeGolden('t_openbox');
    expect(a.validation.result?.isWatertight).toBe(false);
    expect(a.validation.result?.holeCount).toBeGreaterThan(0);
    expect(a.metrics.result?.volumeReliable).toBe(false);
  });

  it('volumeReliable agrees with isWatertight on every sample', () => {
    for (const name of GOLDEN_SAMPLE_NAMES) {
      const a = analyzeGolden(name);
      // The flag is the metrics module's own watertightness test; it must
      // never drift from the validation module's verdict.
      expect(a.metrics.result?.volumeReliable).toBe(a.validation.result?.isWatertight);
    }
  });
  // ── Known gaps: decided, not yet implemented. ────────────────────────────
  // Recorded as todo rather than as an assertion — the shape of the verdict
  // outlet is not settled yet, and pinning an undecided shape into a snapshot
  // turns an open decision into a contract.

  it.todo('analysis layer must expose a single rules-based verdict + score outlet');
});
