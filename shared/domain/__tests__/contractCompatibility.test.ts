import { describe, expect, it } from 'vitest';
import { normalizeModelAnalysis, type ModelAnalysis } from '../analysis';
import type { AdvisorContext, AdvisorMessage } from '../advisor';
import type { WorkflowStageResult } from '../workflow';

describe('domain contract compatibility', () => {
  it('allows model analysis to flow into advisor context and workflow stage output', () => {
    const modelAnalysis: ModelAnalysis = {
      source: {
        id: 'fixture.stl',
        fileName: 'fixture.stl',
        fileType: 'stl',
      },
      metrics: {
        bounds: {
          min: { x: 0, y: 0, z: 0 },
          max: { x: 10, y: 20, z: 30 },
          size: { x: 10, y: 20, z: 30 },
        },
        triangleCount: 12,
        surfaceAreaMm2: 600,
        boundingBoxVolumeMm3: 6000,
      },
      findings: [],
      legacy: {
        wallThickness: {
          minThicknessMm: 5,
          p1ThicknessMm: null,
          p5ThicknessMm: null,
          p10ThicknessMm: null,
          medianThicknessMm: null,
          avgThicknessMm: null,
          thinWallCount: 0,
          thinWallPercentage: 0,
          averageConfidence: 0,
          lowConfidenceSampleCount: 0,
          affectedAreas: 0,
          status: 'good',
        },
        overhang: {
          thresholdDeg: 45,
          affectedFaces: 0,
          status: 'good',
        },
      },
    };

    const advisorContext: AdvisorContext = {
      modelAnalysis,
      language: 'en',
    };

    const advisorMessage: AdvisorMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Printable.',
      source: 'local',
    };

    const stageResult: WorkflowStageResult<ModelAnalysis> = {
      id: 'analyze_geometry',
      status: 'completed',
      output: modelAnalysis,
    };

    const normalized = normalizeModelAnalysis(modelAnalysis);

    expect(advisorContext.modelAnalysis.source.fileName).toBe('fixture.stl');
    expect(advisorMessage.source).toBe('local');
    expect(stageResult.output?.metrics.triangleCount).toBe(12);
    expect(JSON.parse(JSON.stringify(normalized))).toEqual(normalized);
  });
});
