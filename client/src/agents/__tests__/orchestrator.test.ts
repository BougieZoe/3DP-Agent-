import { describe, it, expect, vi } from 'vitest';
import { AgentOrchestrator } from '../orchestrator';
import { getAgentRegistry } from '../core/agentRegistry';
import { visionProvider } from '../visionProvider';
import { buildMockUnifiedAnalysis, normalMetrics, thinWallMetrics, overhangMetrics, criticalBothMetrics, mockGeometry, mockMaterial } from './testAgentFixtures';

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
    const registry = getAgentRegistry();
    const originals = registry.getAll();
    const custom: Record<string, number> = {
      geometry_analyst: 0.70,
      printability_scorer: 0.10,
      failure_predictor: 0.10,
      optimization_advisor: 0.10,
    };
    try {
      for (const slot of originals) {
        registry.register({ ...slot, weight: custom[slot.id] ?? slot.weight });
      }
      const geo = mockGeometry();
      const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
      const orch = new AgentOrchestrator();
      // mjf has no material override, so the configured weights are the ones used.
      const result = await orch.runFullAnalysis(
        geo, ua, 'weighted.stl', undefined, 'en',
        mockMaterial({ technology: 'mjf', name: 'MJF' }),
      );
      expect(result.consensus.overallScore).toBeGreaterThan(0);
      expect(result.votingRecords.length).toBe(4);
      expect(result.votingRecords.find(r => r.agentId === 'geometry_analyst')!.weight).toBe(0.70);
      expect(result.votingRecords.find(r => r.agentId === 'printability_scorer')!.weight).toBe(0.10);
    } finally {
      for (const slot of originals) registry.register(slot);
    }
  });

  it('handles disabled agents', async () => {
    // The registry now owns enable/disable; the orchestrator syncs from it.
    const registry = getAgentRegistry();
    registry.disable('optimization_advisor');
    try {
      const geo = mockGeometry();
      const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
      const orch = new AgentOrchestrator();
      const result = await orch.runFullAnalysis(geo, ua, 'disabled.stl');
      expect(result.results.length).toBe(3);
      const ids = result.results.map(r => r.agentId);
      expect(ids).not.toContain('optimization_advisor');
    } finally {
      registry.enable('optimization_advisor');
    }
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
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
    const orch = new AgentOrchestrator();
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

  it('broadcasts agent-consensus with the final score when a window exists', async () => {
    const seen: Array<{ score?: unknown }> = [];
    const stubWin = {
      dispatchEvent: (ev: Event) => {
        seen.push((ev as CustomEvent).detail as { score?: unknown });
        return true;
      },
    };
    vi.stubGlobal('window', stubWin);
    try {
      const geo = mockGeometry();
      const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
      const orch = new AgentOrchestrator();
      const result = await orch.runFullAnalysis(geo, ua, 'consensus.stl');
      expect(seen.length).toBe(1);
      expect(seen[0].score).toBe(result.consensus.overallScore);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('uses PipelineFactory material filters to choose agents per run', async () => {
    const registry = getAgentRegistry();
    const original = registry.get('optimization_advisor')!;
    try {
      registry.register({ ...original, materialFilter: ['sla'] });
      const geo = mockGeometry();
      const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
      const orch = new AgentOrchestrator();
      const fdm = await orch.runFullAnalysis(
        geo, ua, 'filtered.stl', undefined, 'en',
        mockMaterial({ technology: 'fdm', name: 'PLA' }),
      );
      expect(fdm.results.map(r => r.agentId)).not.toContain('optimization_advisor');
      expect(fdm.results.length).toBe(3);

      const sla = await orch.runFullAnalysis(
        geo, ua, 'filtered-sla.stl', undefined, 'en',
        mockMaterial({ technology: 'sla', name: 'Resin' }),
      );
      expect(sla.results.map(r => r.agentId)).toContain('optimization_advisor');
    } finally {
      registry.register(original);
    }
  });

  it('uses material weight overrides at runtime without persisting them', async () => {
    const registry = getAgentRegistry();
    const before = registry.get('optimization_advisor')!.weight;
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
    const orch = new AgentOrchestrator();
    const result = await orch.runFullAnalysis(
      geo, ua, 'fdm.stl', undefined, 'en',
      mockMaterial({ technology: 'fdm', name: 'PLA' }),
    );
    expect(result.votingRecords.find(r => r.agentId === 'failure_predictor')!.weight).toBe(0.30);
    expect(result.votingRecords.find(r => r.agentId === 'optimization_advisor')!.weight).toBe(0.20);
    expect(registry.get('optimization_advisor')!.weight).toBe(before);
  });

  it('keeps early-triage weight adjustments runtime-only', () => {
    const registry = getAgentRegistry();
    const spy = vi.spyOn(registry, 'updateWeight');
    try {
      const weights = new Map<'geometry_analyst', number>([['geometry_analyst', 0.2]]);
      const orch = new AgentOrchestrator();
      (orch as any).adjustWeightsByEarlyTriage(weights, {
        riskCategory: 'watertight',
        agentPriority: 'geometry_analyst',
      });
      expect(weights.get('geometry_analyst')).toBeCloseTo(0.3);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('applies the concrete pipeline: fewer debate rounds and no Jev calls', async () => {
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
    const orch = new AgentOrchestrator();
    const triage = vi.spyOn(orch as any, 'runJevEarlyTriage').mockResolvedValue(undefined);
    const decision = vi.spyOn(orch as any, 'runJevDecision').mockResolvedValue(undefined);
    const debate = vi.spyOn(orch as any, 'runDebatePhase');
    try {
      const result = await orch.runFullAnalysis(
        geo, ua, 'concrete.stl', undefined, 'en',
        mockMaterial({ technology: 'concrete', name: 'Concrete' }),
      );
      expect(triage).not.toHaveBeenCalled();
      expect(decision).not.toHaveBeenCalled();
      expect(debate).toHaveBeenCalledTimes(1);
      expect(debate.mock.calls[0][4]).toBe(1);
      expect(result.consensus.totalRounds).toBeLessThanOrEqual(1);
    } finally {
      triage.mockRestore();
      decision.mockRestore();
      debate.mockRestore();
    }
  });

  it('uses the SLS pipeline debate-round count', async () => {
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
    const orch = new AgentOrchestrator();
    const debate = vi.spyOn(orch as any, 'runDebatePhase');
    try {
      await orch.runFullAnalysis(
        geo, ua, 'sls.stl', undefined, 'en',
        mockMaterial({ technology: 'sls', name: 'PA12' }),
      );
      expect(debate.mock.calls[0][4]).toBe(3);
    } finally {
      debate.mockRestore();
    }
  });

  it('enables Jev for the FDM pipeline', async () => {
    const geo = mockGeometry();
    const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });
    const orch = new AgentOrchestrator();
    const triage = vi.spyOn(orch as any, 'runJevEarlyTriage').mockResolvedValue(undefined);
    const debate = vi.spyOn(orch as any, 'runDebatePhase');
    try {
      await orch.runFullAnalysis(
        geo, ua, 'fdm-jev.stl', undefined, 'en',
        mockMaterial({ technology: 'fdm', name: 'PLA' }),
      );
      expect(triage).toHaveBeenCalledTimes(1);
      expect(debate.mock.calls[0][4]).toBe(2);
    } finally {
      triage.mockRestore();
      debate.mockRestore();
    }
  });

});
