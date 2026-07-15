import { describe, it, expect } from 'vitest';
import { FailurePredictor } from '../failurePredictor';
import {
  buildAgentContext,
  buildMockUnifiedAnalysis,
  normalMetrics,
  thinWallMetrics,
  overhangMetrics,
  criticalBothMetrics,
  mockMaterial,
} from './testAgentFixtures';

describe('FailurePredictor', () => {
  const predictor = new FailurePredictor();

  it('passes a normal model', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      modelSize: { x: 50, y: 20, z: 10 },
    });
    const output = await predictor.execute(ctx);
    expect(output.score).toBeGreaterThanOrEqual(70);
    expect(output.verdict).toBe('pass');
    const details = output.details as Record<string, unknown>;
    expect(details.risks).toBeDefined();
    expect((details.risks as unknown[]).length).toBe(0);
  });

  it('predicts overhang failures on excessive overhangs', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: overhangMetrics() }),
    });
    const output = await predictor.execute(ctx);
    expect(['fail', 'warning']).toContain(output.verdict);
    const details = output.details as Record<string, unknown>;
    const risks = details.risks as unknown[];
    const ohRisks = risks.filter(r => (r as Record<string, unknown>).type === 'overhang_failure');
    expect(ohRisks.length).toBeGreaterThan(0);
    expect((ohRisks[0] as Record<string, unknown>).severity).toBe('critical');
  });

  it('predicts wall failures on thin walls', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: thinWallMetrics() }),
    });
    const output = await predictor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const risks = details.risks as unknown[];
    const wallRisks = risks.filter(r => (r as Record<string, unknown>).type === 'wall_failure');
    expect(wallRisks.length).toBeGreaterThan(0);
  });

  it('produces overhang markers for critical overhangs', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: overhangMetrics() }),
      material: mockMaterial({ overhangThreshold: 45 }),
    });
    const output = await predictor.execute(ctx);
    const supportMarkers = output.markers.filter(m => m.type === 'support_needed');
    expect(supportMarkers.length).toBeGreaterThan(0);
  });

  it('considers support feedback when support analysis exists', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({
        metrics: overhangMetrics(),
        support: {
          totalSupportVolumeMm3: 50000,
          supportFaceCount: 100,
          difficulty: 'very_difficult',
          supportRegions: [{ faceCount: 60 }],
        },
      }),
    });
    const output = await predictor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const risks = details.risks as unknown[];
    const supportRisks = risks.filter(r =>
      (r as Record<string, unknown>).type === 'support_collapse' ||
      (r as Record<string, unknown>).type === 'support_removal'
    );
    expect(supportRisks.length).toBeGreaterThan(0);
  });

  it('predicts warping for large models', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      modelSize: { x: 250, y: 200, z: 30 },
    });
    const output = await predictor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const risks = details.risks as unknown[];
    const warping = risks.filter(r => (r as Record<string, unknown>).type === 'warping');
    expect(warping.length).toBeGreaterThan(0);
  });

  it('predicts delamination for tall models', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      modelSize: { x: 50, y: 50, z: 250 },
    });
    const output = await predictor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const risks = details.risks as unknown[];
    const delam = risks.filter(r => (r as Record<string, unknown>).type === 'delamination');
    expect(delam.length).toBeGreaterThan(0);
  });

  it('fails on critical combined issues', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: criticalBothMetrics() }),
      modelSize: { x: 300, y: 200, z: 30 },
    });
    const output = await predictor.execute(ctx);
    expect(output.verdict).toBe('fail');
    expect(output.score).toBeLessThan(40);
  });

  it('generates wall markers for thin walls', async () => {
    const positions = new Float32Array(300).fill(1);
    const norms = new Float32Array(300).fill(1);
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: thinWallMetrics() }),
      vertexPositions: positions,
      vertexNormals: norms,
    });
    const output = await predictor.execute(ctx);
    const thinMarkers = output.markers.filter(m => m.type === 'thin_wall');
    expect(thinMarkers.length).toBeGreaterThan(0);
  });

  it('handles empty metrics gracefully', async () => {
    const empty = normalMetrics();
    empty.surfaceAreaMm2 = 0;
    empty.meshVolumeMm3 = 0;
    empty.overhang = {
      faceCount: 0, totalFaceCount: 0, ratio: 0, severity: 'none',
      breakdownByAngleDeg: [],
    };
    empty.thinWallCount = 0;
    empty.thinWallRatio = 0;
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: empty }),
      modelSize: { x: 10, y: 10, z: 10 },
    });
    const output = await predictor.execute(ctx);
    expect(output.score).toBe(100);
    expect(output.verdict).toBe('pass');
  });
});
