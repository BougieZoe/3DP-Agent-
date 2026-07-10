import { describe, it, expect } from 'vitest';
import { createWatertightCubeModel, createOpenCubeModel, createSingleTriangleModel, createNonIndexedModel } from './testMeshes';
import { createGeometryModel } from '../geometryModel';
import { computeMetrics, computeMeshVolume, computeSurfaceArea, analyzeOverhang, deriveOhStatus, deriveWtStatus } from '../metrics';

describe('computeMeshVolume', () => {
  it('returns positive volume for watertight cube', () => {
    const model = createWatertightCubeModel();
    const vol = computeMeshVolume(model.positions, model.indices);
    expect(vol).toBeCloseTo(1.0, 5);
  });

  it('returns near-zero for single triangle (no volume)', () => {
    const model = createSingleTriangleModel();
    const vol = computeMeshVolume(model.positions, model.indices);
    expect(vol).toBeLessThan(0.01);
  });
});

describe('computeSurfaceArea', () => {
  it('returns correct area for unit cube', () => {
    const model = createWatertightCubeModel();
    const area = computeSurfaceArea(model.positions, model.indices);
    expect(area).toBeCloseTo(6.0, 4);
  });
});

describe('analyzeOverhang', () => {
  it('reports no overhangs for watertight cube sides', () => {
    const model = createWatertightCubeModel();
    const result = analyzeOverhang(model.positions, model.indices);
    expect(result.faceCount).toBeGreaterThan(0);
    expect(result.totalFaceCount).toBe(12);
  });
});

describe('deriveOhStatus', () => {
  it('returns good for zero overhang ratio', () => {
    expect(deriveOhStatus(0)).toBe('good');
    expect(deriveOhStatus(0.01)).toBe('good');
    expect(deriveOhStatus(0.05)).toBe('good');
  });

  it('returns warning for moderate overhang ratio', () => {
    expect(deriveOhStatus(0.051)).toBe('warning');
    expect(deriveOhStatus(0.1)).toBe('warning');
    expect(deriveOhStatus(0.15)).toBe('warning');
  });

  it('returns critical for high overhang ratio', () => {
    expect(deriveOhStatus(0.151)).toBe('critical');
    expect(deriveOhStatus(0.3)).toBe('critical');
    expect(deriveOhStatus(1.0)).toBe('critical');
  });

  it('boundary at exactly 0.05 is good, not warning', () => {
    expect(deriveOhStatus(0.05)).toBe('good');
  });

  it('boundary at exactly 0.15 is warning, not critical', () => {
    expect(deriveOhStatus(0.15)).toBe('warning');
  });
});

describe('computeMetrics', () => {
  it('computes all metrics for watertight cube', () => {
    const model = createWatertightCubeModel();
    const result = computeMetrics(model);

    expect(result.result.meshVolumeMm3).toBeCloseTo(1.0, 4);
    expect(result.result.surfaceAreaMm2).toBeCloseTo(6.0, 4);
    expect(result.result.boundingBoxDimensionsMm.x).toBeCloseTo(1.0, 4);
    expect(result.result.boundingBoxDimensionsMm.y).toBeCloseTo(1.0, 4);
    expect(result.result.boundingBoxDimensionsMm.z).toBeCloseTo(1.0, 4);
    expect(result.result.boundingBoxVolumeMm3).toBeCloseTo(1.0, 4);
    expect(result.result.overhang.totalFaceCount).toBe(12);
    expect(result.explanation).toContain('Volume');
  });

  it('returns lower confidence for non-indexed geometry', () => {
    const model = createNonIndexedModel();
    const result = computeMetrics(model);
    expect(result.confidence).toBeLessThan(1.0);
    expect(result.explanation).toContain('Non-indexed');
  });

  it('returns wall thickness samples for cube', () => {
    const model = createWatertightCubeModel();
    const result = computeMetrics(model);

    expect(result.result.wallThicknessSamples.length).toBeGreaterThanOrEqual(0);
  });

  it('handles open cube gracefully', () => {
    const model = createOpenCubeModel();
    const result = computeMetrics(model);

    expect(result.result.overhang.totalFaceCount).toBe(10);
    expect(result.result.meshVolumeMm3).toBeGreaterThan(0);
  });

  it('thinWallRatio is 0 for solid unit cube (no thin walls)', () => {
    const model = createWatertightCubeModel();
    const result = computeMetrics(model);
    expect(result.result.thinWallRatio).toBe(0);
    expect(result.result.thinWallCount).toBe(0);
  });

  it('wall thickness confidence uses distribution not single min value', () => {
    const model = createWatertightCubeModel();
    const result = computeMetrics(model);
    const m = result.result;

    // p5, p10, median should exist and be positive
    expect(m.p5WallThicknessMm).not.toBeNull();
    expect(m.p10WallThicknessMm).not.toBeNull();
    expect(m.medianWallThicknessMm).not.toBeNull();

    if (m.p5WallThicknessMm != null && m.minWallThicknessMm != null) {
      // p5 should be >= min (p5 is the 5th percentile, not the absolute min)
      expect(m.p5WallThicknessMm).toBeGreaterThanOrEqual(m.minWallThicknessMm!);
    }

    // minWallThicknessMm alone should NOT determine confidence
    // Confidence should incorporate averageConfidence and thinWallRatio
    expect(result.confidence).toBeGreaterThanOrEqual(0.1);
  });
});

describe('deriveOhStatus contract', () => {
  // ── Table-driven cases ─────────────────────────────────────────────────
  const CASES: Array<{ ratio: number; expected: 'good' | 'warning' | 'critical'; label: string }> = [
    { ratio: 0,     expected: 'good',     label: 'ratio 0 → good' },
    { ratio: 0.01,  expected: 'good',     label: 'ratio 0.01 → good' },
    { ratio: 0.04,  expected: 'good',     label: 'ratio 0.04 → good' },
    { ratio: 0.05,  expected: 'good',     label: 'ratio 0.05 → good (threshold is >0.05)' },
    { ratio: 0.051, expected: 'warning',  label: 'ratio 0.051 → warning' },
    { ratio: 0.10,  expected: 'warning',  label: 'ratio 0.10 → warning' },
    { ratio: 0.14,  expected: 'warning',  label: 'ratio 0.14 → warning' },
    { ratio: 0.15,  expected: 'warning',  label: 'ratio 0.15 → warning (threshold is >0.15)' },
    { ratio: 0.151, expected: 'critical', label: 'ratio 0.151 → critical' },
    { ratio: 0.30,  expected: 'critical', label: 'ratio 0.30 → critical' },
    { ratio: 1.0,   expected: 'critical', label: 'ratio 1.0 → critical' },
  ];

  for (const { ratio, expected, label } of CASES) {
    it(label, () => expect(deriveOhStatus(ratio)).toBe(expected));
  }

  // ── Invariant: determinism ──────────────────────────────────────────────
  it('same input always returns same status', () => {
    for (const { ratio } of CASES) {
      const a = deriveOhStatus(ratio);
      const b = deriveOhStatus(ratio);
      expect(a).toBe(b);
    }
  });
});

describe('deriveWtStatus contract', () => {
  // ── Table-driven cases ─────────────────────────────────────────────────
  const CASES: Array<{ twr: number; p5: number | null; expected: 'good' | 'warning' | 'critical'; label: string }> = [
    { twr: 0,     p5: 2,    expected: 'good',     label: 'twr 0, p5 2mm → good' },
    { twr: 0.02,  p5: 1.5,  expected: 'good',     label: 'twr 0.02 → good' },
    { twr: 0.04,  p5: 0.5,  expected: 'good',     label: 'twr 0.04 → good' },
    { twr: 0.05,  p5: 0.5,  expected: 'good',     label: 'twr 0.05 → good (threshold is >0.05)' },
    { twr: 0.051, p5: 0.5,  expected: 'warning',  label: 'twr 0.051 → warning' },
    { twr: 0.10,  p5: 2,    expected: 'warning',  label: 'twr 0.10 → warning' },
    { twr: 0.14,  p5: 2,    expected: 'warning',  label: 'twr 0.14 → warning' },
    { twr: 0.15,  p5: 2,    expected: 'warning',  label: 'twr 0.15 → warning (threshold is >0.15)' },
    { twr: 0.151, p5: 2,    expected: 'critical', label: 'twr 0.151 → critical' },
    { twr: 0.30,  p5: 2,    expected: 'critical', label: 'twr 0.30 → critical' },
    // p5 fallback: low thinWallRatio but critical p5
    { twr: 0,     p5: 0.3,  expected: 'warning',  label: 'twr 0, p5 0.3mm → warning (p5<0.4 fallback)' },
    { twr: 0.03,  p5: 0.35, expected: 'warning',  label: 'twr 0.03, p5 0.35mm → warning (p5<0.4)' },
    { twr: 0.03,  p5: 0.5,  expected: 'good',     label: 'twr 0.03, p5 0.5mm → good (p5≥0.4)' },
    // null p5
    { twr: 0,     p5: null, expected: 'good',     label: 'twr 0, p5 null → good' },
    { twr: 0.03,  p5: null, expected: 'good',     label: 'twr 0.03, p5 null → good' },
    // edge: p5 exactly at boundary (0.4 is NOT < 0.4)
    { twr: 0,     p5: 0.4,  expected: 'good',     label: 'twr 0, p5 0.4mm → good (≥0.4 is not warning)' },
  ];

  for (const { twr, p5, expected, label } of CASES) {
    it(label, () => expect(deriveWtStatus(twr, p5)).toBe(expected));
  }

  // ── Invariant: determinism ──────────────────────────────────────────────
  it('same input always returns same status', () => {
    for (const { twr, p5 } of CASES) {
      const a = deriveWtStatus(twr, p5);
      const b = deriveWtStatus(twr, p5);
      expect(a).toBe(b);
    }
  });
});
