import { describe, it, expect } from 'vitest';
import { PrintabilityScorer } from '../printabilityScorer';
import {
  buildAgentContext,
  buildMockUnifiedAnalysis,
  normalMetrics,
  thinWallMetrics,
  overhangMetrics,
  criticalBothMetrics,
} from './testAgentFixtures';
import type { AgentOutput } from '@shared/domain/agent';

describe('PrintabilityScorer', () => {
  const scorer = new PrintabilityScorer();

  it('scores normal model as excellent', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
    });
    const output = await scorer.execute(ctx);
    expect(output.score).toBeGreaterThanOrEqual(80);
    expect(output.verdict).toBe('pass');
    const breakdown = output.details as Record<string, unknown>;
    expect(breakdown.category).toBe('excellent');
  });

  it('scores thin wall model as fair or poor', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: thinWallMetrics() }),
      modelSize: { x: 100, y: 20, z: 10 },
    });
    const output = await scorer.execute(ctx);
    expect(output.score).toBeLessThan(60);
    const breakdown = output.details as Record<string, unknown>;
    expect(['fair', 'poor', 'critical']).toContain(breakdown.category);
  });

  it('penalizes overhangs heavily', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: overhangMetrics() }),
    });
    const output = await scorer.execute(ctx);
    const breakdown = output.details as Record<string, unknown>;
    expect(breakdown.overhangScore).toBeLessThan(60);
    expect(breakdown.wallThicknessScore).toBeGreaterThanOrEqual(80);
  });

  it('scores critical model as critical/poor', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: criticalBothMetrics() }),
    });
    const output = await scorer.execute(ctx);
    expect(output.score).toBeLessThan(40);
    const breakdown = output.details as Record<string, unknown>;
    expect(['poor', 'critical']).toContain(breakdown.category);
  });

  it('generates markers for low-scoring dimensions', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: thinWallMetrics() }),
    });
    const output = await scorer.execute(ctx);
    const thinWallMarkers = output.markers.filter(m => m.type === 'thin_wall');
    expect(thinWallMarkers.length).toBeGreaterThan(0);
  });

  it('review() adjusts score down when failure predictor finds many risks', () => {
    const ctx = buildAgentContext();
    const otherOutputs: AgentOutput[] = [{
      agentId: 'failure_predictor',
      agentName: 'Failure Predictor',
      score: 30,
      confidence: 0.8,
      verdict: 'fail',
      details: { risks: Array.from({ length: 5 }, (_, i) => ({ type: `risk_${i}` })) },
      explanation: '',
      markers: [],
    }];
    const result = scorer.review(ctx, otherOutputs);
    expect(result.scoreAdjustment).toBe(-10);
    expect(result.notes).toContain('Failure predictor');
  });

  it('review() does not adjust when other agents are normal', () => {
    const ctx = buildAgentContext();
    const otherOutputs: AgentOutput[] = [{
      agentId: 'failure_predictor',
      agentName: 'Failure Predictor',
      score: 80,
      confidence: 0.9,
      verdict: 'pass',
      details: { risks: [] },
      explanation: '',
      markers: [],
    }];
    const result = scorer.review(ctx, otherOutputs);
    expect(result.scoreAdjustment).toBe(0);
  });
});
