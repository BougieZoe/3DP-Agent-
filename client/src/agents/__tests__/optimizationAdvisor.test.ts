import { describe, it, expect } from 'vitest';
import { OptimizationAdvisor } from '../optimizationAdvisor';
import {
  buildAgentContext,
  buildMockUnifiedAnalysis,
  normalMetrics,
  thinWallMetrics,
  overhangMetrics,
  criticalBothMetrics,
  mockMaterial,
} from './testAgentFixtures';
import type { AgentOutput } from '@shared/domain/agent';

describe('OptimizationAdvisor', () => {
  const advisor = new OptimizationAdvisor();

  it('returns high score for a well-optimized model', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
    });
    const output = await advisor.execute(ctx);
    expect(output.score).toBeGreaterThanOrEqual(70);
    const details = output.details as Record<string, unknown>;
    expect(details.suggestions).toBeDefined();
  });

  it('suggests wall thickening for thin walls', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: thinWallMetrics() }),
    });
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const suggestions = details.suggestions as unknown[];
    const wallSugs = suggestions.filter(s =>
      (s as Record<string, unknown>).type === 'wall_thickening'
    );
    expect(wallSugs.length).toBeGreaterThan(0);
    const sug = wallSugs[0] as Record<string, unknown>;
    expect(sug.priority).toBe('critical');
  });

  it('suggests orientation change and supports for overhangs', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: overhangMetrics() }),
      material: mockMaterial({ overhangThreshold: 50 }),
    });
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const suggestions = details.suggestions as unknown[];
    const orientSugs = suggestions.filter(s =>
      (s as Record<string, unknown>).type === 'orientation_change'
    );
    const supportSugs = suggestions.filter(s =>
      (s as Record<string, unknown>).type === 'support_addition'
    );
    expect(orientSugs.length).toBeGreaterThan(0);
    expect(supportSugs.length).toBeGreaterThan(0);
  });

  it('suggests bridging redesign for extreme aspect ratio', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      modelSize: { x: 10, y: 10, z: 200 },
    });
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const suggestions = details.suggestions as unknown[];
    const bridgeSugs = suggestions.filter(s =>
      (s as Record<string, unknown>).type === 'bridging_redesign'
    );
    expect(bridgeSugs.length).toBeGreaterThan(0);
  });

  it('recommends materials based on model size and thickness', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      modelSize: { x: 200, y: 150, z: 30 },
    });
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const materials = details.recommendedMaterials as unknown[];
    expect(materials.length).toBeGreaterThanOrEqual(2);
    const first = materials[0] as Record<string, unknown>;
    expect(first.material).toBeDefined();
    expect(first.process).toBeDefined();
  });

  it('integrates previous agent outputs when available', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
    });
    ctx.previousOutputs.set('geometry_analyst', {
      agentId: 'geometry_analyst',
      agentName: 'Geometry Analyst',
      score: 45,
      confidence: 0.6,
      verdict: 'warning',
      details: {},
      explanation: '',
      markers: [],
    });
    ctx.previousOutputs.set('failure_predictor', {
      agentId: 'failure_predictor',
      agentName: 'Failure Predictor',
      score: 40,
      confidence: 0.7,
      verdict: 'warning',
      details: { risks: [{ type: 'overhang_failure', severity: 'high' }] },
      explanation: '',
      markers: [],
    });
    const output = await advisor.execute(ctx);
    expect(output.score).toBeGreaterThanOrEqual(0);
    expect(output.details).toBeDefined();
  });

  it('suggests hole_fill for low polygon count', async () => {
    const lowPolyMetrics = normalMetrics();
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: lowPolyMetrics }),
      modelSize: { x: 50, y: 20, z: 10 },
    });
    ctx.unifiedAnalysis.topology.result.triangleCount = 50;
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const suggestions = details.suggestions as unknown[];
    const fillSugs = suggestions.filter(s =>
      (s as Record<string, unknown>).type === 'hole_fill'
    );
    expect(fillSugs.length).toBeGreaterThan(0);
  });

  it('handles critical combined issues with low score', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: criticalBothMetrics() }),
    });
    const output = await advisor.execute(ctx);
    expect(output.score).toBeLessThan(70);
    expect(['fail', 'warning']).toContain(output.verdict);
  });
});
