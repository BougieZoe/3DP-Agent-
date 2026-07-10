import { describe, it, expect } from 'vitest';
import { createWatertightCubeModel, createDisconnectedShellsModel, createLargeFlatPlate, createOverhangPlate } from './testMeshes';
import { fromThreeBufferGeometry } from '../geometryConversion';
import { estimateSupportVolume } from '../support';
import { deriveSupportStatus } from '../metrics';

const OVERHANG_PLATE_ANGLE = 60;

describe('estimateSupportVolume', () => {
  it('reports no supports for flat horizontal plate', () => {
    const geo = createLargeFlatPlate(10);
    const model = fromThreeBufferGeometry(geo);
    const result = estimateSupportVolume(model);
    expect(result.result.supportFaceCount).toBe(0);
    expect(result.result.difficulty).toBe('none');
    expect(result.result.supportRegions).toEqual([]);
    expect(result.result.largestRegionRatio).toBe(0);
    expect(result.result.tallSupportRatio).toBe(0);
  });

  function ohPlate(): ReturnType<typeof fromThreeBufferGeometry> {
    return fromThreeBufferGeometry(createOverhangPlate(10, 10, OVERHANG_PLATE_ANGLE));
  }

  it('reports one support region for single overhang plate', () => {
    const result = estimateSupportVolume(ohPlate());
    expect(result.result.supportFaceCount).toBe(2);
    expect(result.result.supportRegions.length).toBe(1);
    expect(result.result.largestRegionRatio).toBe(1);
  });

  it('preserves existing difficulty and volume for single island', () => {
    const result = estimateSupportVolume(ohPlate());
    // 2 overhang faces out of 2 total → ratio=1.0 → 'very_difficult' (existing logic)
    expect(result.result.difficulty).toBe('very_difficult');
    expect(result.result.totalSupportVolumeMm3).toBeGreaterThan(0);
    // Region volume sum matches total
    expect(result.result.supportRegions[0].estimatedVolumeMm3).toBeCloseTo(
      result.result.totalSupportVolumeMm3, -1
    );
  });

  it('produces two support regions for two disconnected shells with overhangs', () => {
    const model = createDisconnectedShellsModel();
    const result = estimateSupportVolume(model);
    // Both cubes have vertical side faces → overhangs. Cubes are disconnected → 2 regions
    expect(result.result.supportFaceCount).toBeGreaterThan(0);
    expect(result.result.supportRegions.length).toBe(2);
    expect(result.result.largestRegionRatio).toBeGreaterThan(0.4);
    expect(result.result.largestRegionRatio).toBeLessThan(0.6);
  });

  it('directionality near 1.0 for aligned overhang normals', () => {
    const result = estimateSupportVolume(ohPlate());
    // Both faces have nearly identical normals → directionality close to 1
    expect(result.result.directionality).toBeGreaterThan(0.95);
  });

  it('directionality lower for multi-directional overhangs (cube)', () => {
    const model = createWatertightCubeModel();
    const result = estimateSupportVolume(model);
    // Cube vertical faces point ±x, ±z → vectors partially cancel
    expect(result.result.supportFaceCount).toBeGreaterThan(0);
    expect(result.result.directionality).toBeLessThan(0.5);
  });

  it('zGradient is within -1..1 range', () => {
    const model = createWatertightCubeModel();
    const result = estimateSupportVolume(model);
    expect(result.result.zGradient).toBeGreaterThanOrEqual(-1);
    expect(result.result.zGradient).toBeLessThanOrEqual(1);
  });

  it('difficulty correlates with largestRegionRatio > 0.5', () => {
    // Single large overhang island → largestRegionRatio = 1.0 → very_difficult
    const result = estimateSupportVolume(ohPlate());
    if (result.result.largestRegionRatio > 0.5) {
      expect(result.result.difficulty).not.toBe('none');
    }
  });

  it('difficulty correlates with tallSupportRatio > 0.3', () => {
    // Overhang plate has faces at different Z heights → tallSupportRatio ~0.5
    const result = estimateSupportVolume(ohPlate());
    if (result.result.tallSupportRatio > 0.3) {
      expect(result.result.difficulty).not.toBe('none');
    }
  });

  it('watertight cube has connected support region covering all vertical walls', () => {
    const model = createWatertightCubeModel();
    const result = estimateSupportVolume(model);
    // All 4 vertical walls are adjacent → single BFS cluster
    expect(result.result.supportRegions.length).toBe(1);
    expect(result.result.largestRegionRatio).toBe(1);
  });
});

function makeSupportResult(overrides: Partial<import('../types').SupportResult>): import('../types').SupportResult {
  const base: import('../types').SupportResult = {
    totalSupportVolumeMm3: 0, supportFaceCount: 0,
    averageOverhangAngleDeg: 0, difficulty: 'none',
    estimatedSupportGrams: 0, volumeByAngleDeg: [],
    supportRegions: [], largestRegionRatio: 0,
    tallSupportRatio: 0, zGradient: 0, directionality: 0,
  };
  return { ...base, ...overrides };
}

function region(fc: number, vol: number, cz: number): import('../types').SupportRegion {
  return {
    faceCount: fc, centroid: { x: 0, y: 0, z: cz },
    boundingBoxSize: { x: 10, y: 5, z: 5 },
    normalizedDirection: { x: 0, y: 1, z: 0 },
    avgAngleDeg: 55, estimatedVolumeMm3: vol,
    zRange: { min: cz - 2, max: cz + 2 },
  };
}

describe('deriveSupportStatus contract', () => {
  // ── Table-driven cases ─────────────────────────────────────────────────
  const CASES: Array<{
    input: import('../types').SupportResult;
    expectedStatus: 'good' | 'warning' | 'critical';
    expectedReasonHint?: string;
    label: string;
  }> = [
    // None
    {
      input: makeSupportResult({ difficulty: 'none' }),
      expectedStatus: 'good',
      expectedReasonHint: 'No support',
      label: 'none → good',
    },
    // Easy isolated
    {
      input: makeSupportResult({
        difficulty: 'easy', supportFaceCount: 10,
        supportRegions: [region(10, 100, 0)],
        largestRegionRatio: 1, tallSupportRatio: 0.1,
        directionality: 0.3,
      }),
      expectedStatus: 'good',
      expectedReasonHint: 'Isolated manageable',
      label: 'easy, single region → good',
    },
    // Moderate → warning
    {
      input: makeSupportResult({
        difficulty: 'moderate', supportFaceCount: 20,
        supportRegions: [region(20, 200, 0)],
        largestRegionRatio: 1, tallSupportRatio: 0.1,
        directionality: 0.3,
      }),
      expectedStatus: 'warning',
      expectedReasonHint: 'Moderate support',
      label: 'moderate → warning',
    },
    // Difficult → warning (only very_difficult → critical)
    {
      input: makeSupportResult({
        difficulty: 'difficult', supportFaceCount: 30,
        supportRegions: [region(30, 500, 0)],
        largestRegionRatio: 1, tallSupportRatio: 0.1,
        directionality: 0.3,
      }),
      expectedStatus: 'warning',
      expectedReasonHint: 'Difficult support',
      label: 'difficult → warning (only very_difficult is critical)',
    },
    // Very difficult → critical
    {
      input: makeSupportResult({
        difficulty: 'very_difficult', supportFaceCount: 40,
        supportRegions: [region(40, 800, 0)],
        largestRegionRatio: 1, tallSupportRatio: 0.1,
        directionality: 0.3,
      }),
      expectedStatus: 'critical',
      expectedReasonHint: 'Very difficult',
      label: 'very_difficult → critical (regardless of ratio)',
    },
    // Multiple islands (5) → warning
    {
      input: makeSupportResult({
        difficulty: 'easy', supportFaceCount: 40,
        supportRegions: Array.from({ length: 5 }, (_, i) => region(8, 100, i * 3)),
        largestRegionRatio: 0.2, tallSupportRatio: 0.1,
        directionality: 0.3,
      }),
      expectedStatus: 'warning',
      expectedReasonHint: 'separate support islands',
      label: '5 islands → warning',
    },
    // Large island (>0.5) + tall (>0.3) → critical
    {
      input: makeSupportResult({
        difficulty: 'easy', supportFaceCount: 50,
        supportRegions: [region(50, 1000, 10)],
        largestRegionRatio: 0.8, tallSupportRatio: 0.4,
        directionality: 0.3,
      }),
      expectedStatus: 'critical',
      expectedReasonHint: 'removal risk',
      label: 'large island + tall → critical (rule override)',
    },
    // Tall only (without large island) → warning
    {
      input: makeSupportResult({
        difficulty: 'easy', supportFaceCount: 20,
        supportRegions: Array.from({ length: 3 }, () => region(7, 100, 5)),
        largestRegionRatio: 0.35, tallSupportRatio: 0.5,
        directionality: 0.3,
      }),
      expectedStatus: 'warning',
      expectedReasonHint: 'tall supports',
      label: 'tall ratio >0.3 (no large island) → warning',
    },
    // Directional concentration → warning
    {
      input: makeSupportResult({
        difficulty: 'easy', supportFaceCount: 10,
        supportRegions: [region(10, 100, 0)],
        largestRegionRatio: 1, tallSupportRatio: 0.1,
        directionality: 0.85,
      }),
      expectedStatus: 'warning',
      expectedReasonHint: 'Directionally concentrated',
      label: 'directionality >0.7 → warning',
    },
  ];

  for (const { input, expectedStatus, expectedReasonHint, label } of CASES) {
    it(label, () => {
      const result = deriveSupportStatus(input);
      expect(result.status).toBe(expectedStatus);
      if (expectedReasonHint) {
        expect(result.reasons.some(r => r.includes(expectedReasonHint))).toBe(true);
      }
    });
  }

  // ── Invariant: determinism ──────────────────────────────────────────────
  it('same input always returns same status, reasons, confidence', () => {
    for (const { input } of CASES) {
      const a = deriveSupportStatus(input);
      const b = deriveSupportStatus(input);
      expect(a.status).toBe(b.status);
      expect(a.reasons).toEqual(b.reasons);
      expect(a.confidence).toBe(b.confidence);
    }
  });
});
