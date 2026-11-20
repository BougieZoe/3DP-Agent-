import { describe, it, expect } from 'vitest';
import { BaseAgent } from '../baseAgent';
import { recalibrateFlaggedAgents } from '../jevRecalibrator';
import type { AnomalyReport } from '../jevAnomalyDetector';
import type { AgentResultWithExplanation } from '../types';
import type { JevDecision } from '@/lib/jevClient';
import { buildAgentContext } from './testAgentFixtures';

class FixedScoreAgent extends BaseAgent {
  constructor(private readonly score: number) {
    super('geometry_analyst', {
      supportsVision: false,
      requiresVision: false,
      timeoutMs: 1000,
    });
  }

  protected async analyze() {
    return this.makeOutput(this.score, 0.9, 'pass', 'recalibrated', {});
  }
}

describe('recalibrateFlaggedAgents', () => {
  it('logs the real before/after scores after mutating the result', async () => {
    const original: AgentResultWithExplanation = {
      agentId: 'geometry_analyst',
      agentName: 'Geometry Analyst',
      score: 80,
      confidence: 0.9,
      verdict: 'pass',
      explanation: 'original',
      details: {},
      markers: [],
      durationMs: 1,
    };
    const anomaly: AnomalyReport = {
      agentId: 'geometry_analyst',
      reason: 'score_deviation',
      severity: 0.2,
      jevContext: 'agent 80 vs jev 50',
    };
    const jevDecision = {
      jevScore: 50,
      topRisk: 'wall thickness',
      primaryAction: 'thicken wall',
    } as JevDecision;

    const results = await recalibrateFlaggedAgents(
      [anomaly],
      new Map([['geometry_analyst', new FixedScoreAgent(50)]]),
      buildAgentContext(),
      [original],
      jevDecision,
    );

    expect(results).toHaveLength(1);
    expect(results[0].originalScore).toBe(80);
    expect(results[0].recalibratedScore).toBe(50);
    expect(results[0].blendedScore).toBe(68);
    expect(original.score).toBe(68);
    expect(original.explanation).toContain('from 80 to 68');
    expect(original.explanation).not.toContain('from 68 to 68');
  });
});
