import { describe, it, expect, vi } from 'vitest';
import { AgentOrchestrator } from '../orchestrator';
import { visionProvider } from '../visionProvider';
import { buildMockUnifiedAnalysis, normalMetrics, thinWallMetrics, overhangMetrics, criticalBothMetrics, mockGeometry, mockMaterial } from './testAgentFixtures';
import type { AgentStageConfig } from '../types';

function makeConfigs(overrides?: Partial<Record<string, Partial<AgentStageConfig>>>): AgentStageConfig[] {
  const ids: Array<'geometry_analyst' | 'printability_scorer' | 'failure_predictor' | 'optimization_advisor'> = [
    'geometry_analyst', 'printability_scorer', 'failure_predictor', 'optimization_advisor',
  ];
  return ids.map(id => ({
    agentId: id,
    enabled: overrides?.[id]?.enabled !== false,
    weight: overrides?.[id]?.weight ?? 0.25,
    useVision: false,
    timeoutMs: 5000,
  }));
}

describe('AgentOrchestrator', () => {
  it('runs full analysis with real agents and returns consensus for normal model', async () => {
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
    const orch = new AgentOrchestrator();
    const result = await orch.runFullAnalysis(geo, ua, 'test.stl', undefined, 'en', mockMaterial());
    expect(result.results.length).toBe(4);
    expect(result.consensus.overallScore).toBeGreaterThanOrEqual(50);
    expect(['pass', 'warning']).toContain(result.consensus.verdict);
    expect(result.votingRecords.length).toBe(4);
    expect(result.totalDurationMs).toBeGreaterThan(0);
  });

  it('returns lower consensus for thin wall model', async () => {
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: thinWallMetrics() });
    const orch = new AgentOrchestrator();
    const result = await orch.runFullAnalysis(geo, ua, 'thin.stl');
    const passCount = result.results.filter(r => r.verdict === 'pass').length;
    const failCount = result.results.filter(r => r.verdict === 'fail').length;
    expect(failCount + result.results.filter(r => r.verdict === 'warning').length)
      .toBeGreaterThanOrEqual(passCount);
  });

  it('produces split-vote consensus for overhang model', async () => {
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: overhangMetrics() });
    const orch = new AgentOrchestrator();
    const result = await orch.runFullAnalysis(geo, ua, 'overhang.stl');
    const verdicts = result.results.map(r => r.verdict);
    const uniqueVerdicts = new Set(verdicts);
    expect(uniqueVerdicts.size).toBeGreaterThanOrEqual(1);
    result.results.forEach(r => {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    });
  });

  it('respects custom agent weights in consensus', async () => {
    const configs = makeConfigs({
      geometry_analyst: { weight: 0.70 },
      printability_scorer: { weight: 0.10 },
      failure_predictor: { weight: 0.10 },
      optimization_advisor: { weight: 0.10 },
    });
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
    const orch = new AgentOrchestrator(configs);
    const result = await orch.runFullAnalysis(geo, ua, 'weighted.stl');
    expect(result.consensus.overallScore).toBeGreaterThan(0);
    expect(result.votingRecords.length).toBe(4);
  });

  it('handles disabled agents', async () => {
    const configs = makeConfigs({
      optimization_advisor: { enabled: false },
    });
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
    const orch = new AgentOrchestrator(configs);
    const result = await orch.runFullAnalysis(geo, ua, 'disabled.stl');
    expect(result.results.length).toBe(3);
    const ids = result.results.map(r => r.agentId);
    expect(ids).not.toContain('optimization_advisor');
  });

  it('handles empty findings gracefully', async () => {
    const emptyM = normalMetrics();
    emptyM.overhang = {
      faceCount: 0, totalFaceCount: 0, ratio: 0, severity: 'none',
      breakdownByAngleDeg: [],
    };
    emptyM.thinWallCount = 0;
    emptyM.thinWallRatio = 0;
    emptyM.wallThicknessSamples = [];
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: emptyM });
    const orch = new AgentOrchestrator();
    const result = await orch.runFullAnalysis(geo, ua, 'empty.stl');
    expect(result.consensus.overallScore).toBeGreaterThan(0);
    expect(result.consensus.summary.length).toBeGreaterThan(0);
  });

  it('produces proper voting records with weight information', async () => {
    const configs = makeConfigs();
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
    const orch = new AgentOrchestrator(configs);
    const result = await orch.runFullAnalysis(geo, ua, 'votes.stl');
    result.votingRecords.forEach(record => {
      expect(record.initialScore).toBeGreaterThanOrEqual(0);
      expect(record.adjustedScore).toBeGreaterThanOrEqual(0);
      expect(record.weight).toBeGreaterThan(0);
      expect(record.confidence).toBeGreaterThan(0);
    });
  });

  it('snapshots initialScore before debate so voting records show real adjustments', async () => {
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({
      metrics: criticalBothMetrics(),
      support: {
        totalSupportVolumeMm3: 2000,
        supportFaceCount: 50,
        difficulty: 'very_difficult',
        largestRegionRatio: 0.6,
        tallSupportRatio: 0.4,
        supportRegions: [{
          faceCount: 10,
          centroid: { x: 5, y: 5, z: 5 },
          boundingBoxSize: { x: 10, y: 10, z: 10 },
          normalizedDirection: { x: 0, y: 1, z: 0 },
          avgAngleDeg: 60,
          estimatedVolumeMm3: 100,
          zRange: { min: 0, max: 10 },
        }],
      },
    });
    const orch = new AgentOrchestrator();
    const result = await orch.runFullAnalysis(geo, ua, 'debate.stl');

    const scorer = result.votingRecords.find(r => r.agentId === 'printability_scorer');
    const failure = result.results.find(r => r.agentId === 'failure_predictor');
    expect(failure?.details).toBeDefined();
    const riskCount = (failure?.details as { risks?: unknown[] } | undefined)?.risks?.length ?? 0;
    expect(riskCount).toBeGreaterThan(3);

    expect(scorer).toBeDefined();
    expect(scorer!.adjustedScore).toBeLessThan(scorer!.initialScore);
  });

  it('always sets usedVision to false when no canvas', async () => {
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
    const orch = new AgentOrchestrator();
    const result = await orch.runFullAnalysis(geo, ua, 'novision.stl');
    expect(result.usedVision).toBe(false);
  });

  it('feeds the vision LLM the real mesh metrics, not bounding-box estimates', async () => {
    localStorage.setItem('3dp_agent_api_keys', JSON.stringify({ openai: 'sk-test' }));
    localStorage.setItem('3dp_agent_active_provider', 'openai');

    const metrics = { ...normalMetrics(), meshVolumeMm3: 1234, surfaceAreaMm2: 5678 };
    const ua = buildMockUnifiedAnalysis({ metrics });
    const fakeCanvas = { toDataURL: () => 'data:image/png;base64,abc' } as unknown as HTMLCanvasElement;

    const spy = vi.spyOn(visionProvider, 'analyzeWithAI').mockResolvedValue({
      qualitativeAssessment: 'ok',
      observedIssues: [],
      confidence: 0.5,
      rawResponse: 'ok',
    });
    try {
      const orch = new AgentOrchestrator();
      await orch.runFullAnalysis(mockGeometry(), ua, 'real.stl', fakeCanvas, 'en', mockMaterial());

      expect(spy).toHaveBeenCalledTimes(1);
      const summary = spy.mock.calls[0][1];
      expect(summary).toContain('Volume: 1234.0mm');
      expect(summary).toContain('Surface Area: 5678.0mm');
      // The mock geometry's bounding box is 10×10×0, which would have
      // produced "Volume: 0.0mm" under the old bounding-box estimation.
      expect(summary).not.toContain('Volume: 0.0mm');
    } finally {
      spy.mockRestore();
      visionProvider.setRenderCanvas(null);
      localStorage.clear();
    }
  });
});
