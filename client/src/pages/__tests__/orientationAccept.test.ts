// Orientation ACCEPT → the AGENTS tab must show the new pose, at zero LLM cost.
// The paid paths of runFullAnalysis go through /api/jev → OpenRouter: for a
// signed-in user the relay uses the server key (getJevApiKey() returns ''), for
// anonymous users a BYOK key. Mock the whole module with spies so any paid call
// is observable and never actually fired.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const jev = vi.hoisted(() => ({
  callJev: vi.fn(async () => ({
    answers: {},
    usage: { input_tokens: 0, output_tokens: 0, cost: 0 },
    latencyMs: 1,
  })),
  runJevConsensus: vi.fn(async () => null),
}));

vi.mock('@/lib/jevClient', () => ({
  callJev: jev.callJev,
  runJevConsensus: jev.runJevConsensus,
}));

vi.mock('@/lib/authStore', () => ({
  // Signed-in user snapshot: getJevApiKey() takes the token branch.
  getAuthSnapshot: () => ({ user: null, profile: null, loading: false, token: 'test-token' }),
}));

import { AgentOrchestrator } from '@/agents/orchestrator';
import { getAgentRegistry } from '@/agents/core/agentRegistry';
import { handleOrientationAccept } from '@/pages/Home';
import { MATERIALS } from '@shared/domain/material';
import type { UploadedModel } from '@/components/STLUploadHandler';
import { buildMockUnifiedAnalysis, normalMetrics, mockGeometry } from '@/agents/__tests__/testAgentFixtures';

function acceptedModel(): UploadedModel {
  return {
    geometry: mockGeometry(),
    fileName: 'rotated.stl',
    unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
  } as unknown as UploadedModel;
}

describe('orientation ACCEPT', () => {
  beforeEach(() => {
    jev.callJev.mockClear();
    jev.runJevConsensus.mockClear();
  });

  it('refreshes the agent run and material recs on the accepted model', () => {
    const updated = acceptedModel();
    const runAgentAnalysis = vi.fn(async () => ({}));
    const recomputeMaterialRecs = vi.fn();
    const commitModel = vi.fn();
    const setQuickReport = vi.fn();

    handleOrientationAccept(updated, {
      commitModel,
      setQuickReport,
      runAgentAnalysis,
      recomputeMaterialRecs,
      material: MATERIALS.PLA,
      language: 'en',
    });

    expect(commitModel).toHaveBeenCalledWith(updated);
    // The AGENTS tab reads agentRun — refreshed only by re-running the analysis
    // on the accepted pose. Without the re-run call this assertion fails.
    expect(runAgentAnalysis).toHaveBeenCalledTimes(1);
    expect(runAgentAnalysis).toHaveBeenCalledWith(updated);
    // Material Recommendations must score the ROTATED geometry — otherwise the
    // panel keeps judging the pre-accept pose ("Overhangs may need support"
    // even when the new pose has no overhang faces).
    expect(recomputeMaterialRecs).toHaveBeenCalledTimes(1);
    expect(recomputeMaterialRecs).toHaveBeenCalledWith(updated.geometry);
    expect(setQuickReport).toHaveBeenCalled();
  });

  it('runFullAnalysis with llm:false never touches the paid Jev relay', async () => {
    const orch = new AgentOrchestrator();
    const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });

    const summary = await orch.runFullAnalysis(
      mockGeometry(), ua, 'probe.stl', null, 'en', MATERIALS.PLA, { llm: false },
    );

    // Without the llm flag the signed-in path would call callJev (early triage)
    // and runJevConsensus (decision) — both paid calls.
    expect(jev.callJev).not.toHaveBeenCalled();
    expect(jev.runJevConsensus).not.toHaveBeenCalled();
    expect(summary.results.length).toBe(4);
    expect(summary.votingRecords.length).toBe(4);
    expect(summary.consensus.jev).toBeUndefined();
    expect(summary.consensus.overallScore).toBeGreaterThan(0);
    expect(summary.analysisSource).toBe('rules');
  });

  it('control: the default path still invokes Jev for a signed-in user', async () => {
    const registry = getAgentRegistry();
    const weightBefore = registry.get('geometry_analyst')?.weight ?? 0.25;
    try {
      const orch = new AgentOrchestrator();
      const ua = buildMockUnifiedAnalysis({ metrics: normalMetrics() });

      await orch.runFullAnalysis(mockGeometry(), ua, 'probe.stl', null, 'en', MATERIALS.PLA);

      // Proves the mock wiring really reaches the Jev path — the llm:false
      // assertion above is not vacuous. (Early triage never fires for signed-in
      // users: getJevApiKey() returns '' and `!apiKey` skips it — pre-existing.)
      expect(jev.runJevConsensus).toHaveBeenCalled();
    } finally {
      // Early triage may bump an agent weight on the shared registry — restore.
      registry.updateWeight('geometry_analyst', weightBefore);
    }
  });
});
