import { describe, it, expect } from 'vitest';
import { estimatePrintTime } from '../printTime';
import type { MetricsResult } from '../types';

function metricsWithDims(x: number, y: number, z: number): MetricsResult {
  return {
    meshVolumeMm3: 6000,
    surfaceAreaMm2: 8000,
    boundingBoxVolumeMm3: x * y * z,
    boundingBoxDimensionsMm: { x, y, z },
    minWallThicknessMm: 1,
    avgWallThicknessMm: 2,
    p1WallThicknessMm: 1,
    p5WallThicknessMm: 1,
    p10WallThicknessMm: 1,
    medianWallThicknessMm: 2,
    thinWallCount: 0,
    thinWallPercentage: 0,
    thinWallRatio: 0,
    averageConfidence: 1,
    wallThicknessSamples: [],
    thinnestWallSample: null,
    overhang: {
      faceCount: 0,
      totalFaceCount: 10,
      ratio: 0,
      severity: 'none',
      breakdownByAngleDeg: [],
      overhangAreaMm2: 0,
      totalAreaMm2: 8000,
    },
  };
}

describe('estimatePrintTime layerCount', () => {
  it('uses the Z height, not the longest dimension', () => {
    // Wide flat model: X=60 dominates, but layers stack along Z=28.
    const result = estimatePrintTime(metricsWithDims(60, 20, 28), 'bambu_x1c', 0.2);
    expect(result.result.layerCount).toBe(140);
  });

  it('matches ceil(z / layerHeight) for a tall model', () => {
    const result = estimatePrintTime(metricsWithDims(28, 20, 60), 'bambu_x1c', 0.2);
    expect(result.result.layerCount).toBe(300);
  });
});
