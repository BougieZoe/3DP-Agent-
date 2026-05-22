import { describe, expect, it } from 'vitest';
import { modelAnalysisToModelData, toModelAnalysis } from '../modelAnalysisAdapters';
import type { AnalysisResult } from '../stlLoader';

const analysis: AnalysisResult = {
  wallThickness: {
    minThickness: 1.25,
    areas: 6,
    status: 'warning',
  },
  overhang: {
    angle: 45,
    areas: 12,
    status: 'warning',
  },
  volume: 24000,
  surfaceArea: 3200,
  triangleCount: 80,
  bounds: {
    min: { x: 0, y: -5, z: 2 } as any,
    max: { x: 20, y: 15, z: 32 } as any,
  },
};

describe('model analysis adapters', () => {
  it('maps current STL analysis into the shared ModelAnalysis contract', () => {
    const modelAnalysis = toModelAnalysis({
      fileName: 'bracket.stl',
      fileSizeBytes: 1234,
      analysis,
    });

    expect(modelAnalysis.source).toEqual({
      id: 'bracket.stl',
      fileName: 'bracket.stl',
      fileSizeBytes: 1234,
      fileType: 'stl',
    });
    expect(modelAnalysis.metrics.bounds.size).toEqual({ x: 20, y: 20, z: 30 });
    expect(modelAnalysis.metrics.boundingBoxVolumeMm3).toBe(24000);
    expect(modelAnalysis.metrics.surfaceAreaMm2).toBe(3200);
    expect(modelAnalysis.metrics.triangleCount).toBe(80);
    expect(modelAnalysis.findings).toHaveLength(2);
    expect(modelAnalysis.legacy.wallThickness.minThicknessMm).toBe(1.25);
    expect(modelAnalysis.legacy.overhang.affectedFaces).toBe(12);
  });

  it('does not leak runtime vector ownership into ModelAnalysis', () => {
    const sourceAnalysis: AnalysisResult = {
      ...analysis,
      bounds: {
        min: { x: 1, y: 2, z: 3 } as any,
        max: { x: 4, y: 6, z: 8 } as any,
      },
    };

    const modelAnalysis = toModelAnalysis({
      fileName: 'isolated.stl',
      analysis: sourceAnalysis,
    });

    sourceAnalysis.bounds.min.x = 999;
    sourceAnalysis.bounds.max.z = 999;

    expect(modelAnalysis.metrics.bounds.min).toEqual({ x: 1, y: 2, z: 3 });
    expect(modelAnalysis.metrics.bounds.max).toEqual({ x: 4, y: 6, z: 8 });
    expect(JSON.parse(JSON.stringify(modelAnalysis))).toEqual(modelAnalysis);
  });

  it('maps ModelAnalysis back to the existing UI ModelData shape', () => {
    const modelData = modelAnalysisToModelData(toModelAnalysis({
      fileName: 'bracket.stl',
      analysis,
    }));

    expect(modelData).toEqual({
      fileName: 'bracket.stl',
      wallThickness: {
        minThickness: 1.25,
        areas: 6,
        status: 'warning',
      },
      overhang: {
        angle: 45,
        areas: 12,
        status: 'warning',
      },
      volume: 24000,
      surfaceArea: 3200,
      dims: { x: 20, y: 20, z: 30 },
    });
  });
});
