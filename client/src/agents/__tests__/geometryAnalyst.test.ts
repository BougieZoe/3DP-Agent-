import { describe, it, expect } from 'vitest';
import { GeometryAnalyst } from '../geometryAnalyst';
import {
  buildAgentContext,
  buildMockUnifiedAnalysis,
  thinWallMetrics,
  overhangMetrics,
  criticalBothMetrics,
  nonManifoldTopology,
  mockMaterial,
  normalMetrics,
} from './testAgentFixtures';

describe('GeometryAnalyst', () => {
  const analyst = new GeometryAnalyst();

  it('passes a normal mesh', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis(),
      modelSize: { x: 50, y: 20, z: 10 },
    });
    const output = await analyst.execute(ctx);
    expect(output.score).toBeGreaterThanOrEqual(70);
    expect(output.verdict).toBe('pass');
    expect(output.markers.length).toBe(0);
  });

  it('warns on thin walls', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: thinWallMetrics() }),
    });
    const output = await analyst.execute(ctx);
    expect(output.score).toBeLessThan(70);
    expect(output.verdict).toBe('warning');
    const details = output.details as Record<string, unknown>;
    expect((details.wallThickness as Record<string, unknown>).status).toBe('critical');
  });

  it('fails on combined thin walls and overhangs', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: criticalBothMetrics() }),
      material: mockMaterial({ overhangThreshold: 45 }),
    });
    const output = await analyst.execute(ctx);
    expect(output.score).toBeLessThan(40);
    expect(output.verdict).toBe('fail');
    expect(output.markers.length).toBeGreaterThan(0);
  });

  it('generates overhang markers when overhangs exist', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: overhangMetrics() }),
    });
    const output = await analyst.execute(ctx);
    const overhangMarkers = output.markers.filter(m => m.type === 'overhang');
    expect(overhangMarkers.length).toBeGreaterThan(0);
  });

  it('handles non-manifold topology', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ topology: nonManifoldTopology() }),
    });
    const output = await analyst.execute(ctx);
    const details = output.details as Record<string, unknown>;
    expect(details.isManifold).toBe(false);
  });

  it('returns low confidence for low tri count', async () => {
    const lowTriTopo = {
      ...nonManifoldTopology(),
      triangleCount: 10,
    };
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ topology: lowTriTopo }),
    });
    const output = await analyst.execute(ctx);
    expect(output.confidence).toBeLessThan(0.5);
  });

  it('produces markers for thin walls', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: thinWallMetrics() }),
    });
    const output = await analyst.execute(ctx);
    const thinWallMarkers = output.markers.filter(m => m.type === 'thin_wall');
    expect(thinWallMarkers.length).toBeGreaterThan(0);
  });

  it('computes aspect ratio from model size', async () => {
    const ctx = buildAgentContext({
      modelSize: { x: 10, y: 10, z: 100 },
      unifiedAnalysis: buildMockUnifiedAnalysis(),
    });
    const output = await analyst.execute(ctx);
    const details = output.details as Record<string, unknown>;
    expect(details.aspectRatio).toBeGreaterThan(5);
  });

  it('handles empty findings gracefully', async () => {
    const emptyM = normalMetrics();
    emptyM.overhang = {
      faceCount: 0, totalFaceCount: 50, ratio: 0, severity: 'none',
      breakdownByAngleDeg: [],
    };
    emptyM.thinWallCount = 0;
    emptyM.thinWallRatio = 0;
    emptyM.wallThicknessSamples = [];
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: emptyM }),
    });
    const output = await analyst.execute(ctx);
    expect(output.score).toBeGreaterThanOrEqual(70);
    expect(output.verdict).toBe('pass');
  });

  it('returns inconclusive on agent error', async () => {
    const agent = new GeometryAnalyst();
    const badCtx = buildAgentContext();
    Object.defineProperty(badCtx, 'unifiedAnalysis', { get: () => { throw new Error('fail'); } });
    const output = await agent.execute(badCtx);
    expect(output.verdict).toBe('inconclusive');
    expect(output.score).toBe(0);
  });
});
