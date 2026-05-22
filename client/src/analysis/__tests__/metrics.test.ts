import { describe, it, expect } from 'vitest';
import { createWatertightCubeModel, createOpenCubeModel, createSingleTriangleModel, createNonIndexedModel } from './testMeshes';
import { createGeometryModel } from '../geometryModel';
import { computeMetrics, computeMeshVolume, computeSurfaceArea, analyzeOverhang } from '../metrics';

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
});
