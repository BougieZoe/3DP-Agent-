import type { AgentResultWithExplanation } from './types';
import type { AgentContext } from './baseAgent';
import type { JevDecision } from '@/lib/jevClient';
import type { AnomalyReport } from './jevAnomalyDetector';
import { BaseAgent } from './baseAgent';

const ORIGINAL_WEIGHT = 0.6;
const RECALIBRATED_WEIGHT = 0.4;
const MAX_RECALIBRATIONS_PER_CYCLE = 1;

export interface RecalibrationResult {
  agentId: string;
  originalScore: number;
  recalibratedScore: number;
  blendedScore: number;
  reason: string;
  durationMs: number;
}

export async function recalibrateFlaggedAgents(
  flaggedAgents: AnomalyReport[],
  agentMap: Map<string, BaseAgent>,
  ctx: AgentContext,
  originalResults: AgentResultWithExplanation[],
  jevDecision: JevDecision,
): Promise<RecalibrationResult[]> {
  if (flaggedAgents.length === 0) return [];

  const toRecalibrate = flaggedAgents.slice(0, MAX_RECALIBRATIONS_PER_CYCLE);
  const results: RecalibrationResult[] = [];

  for (const anomaly of toRecalibrate) {
    const agent = agentMap.get(anomaly.agentId);
    if (!agent) continue;

    const original = originalResults.find(r => r.agentId === anomaly.agentId);
    if (!original) continue;

    const correctiveCtx: AgentContext = {
      ...ctx,
      jevCorrection: {
        jevScore: jevDecision.jevScore,
        topRisk: jevDecision.topRisk,
        primaryAction: jevDecision.primaryAction,
        flaggedFinding: anomaly.jevContext,
      },
    };

    const startTime = performance.now();
    try {
      const recalibrated = await agent.execute(correctiveCtx);
      const durationMs = Math.round(performance.now() - startTime);

      const blendedScore = Math.round(
        original.score * ORIGINAL_WEIGHT + recalibrated.score * RECALIBRATED_WEIGHT,
      );

      results.push({
        agentId: anomaly.agentId,
        originalScore: original.score,
        recalibratedScore: recalibrated.score,
        blendedScore,
        reason: anomaly.reason,
        durationMs,
      });

      original.score = blendedScore;
      original.verdict = agent.computeVerdict(blendedScore);
      original.explanation += `\n\n[Jev Recalibration] ${anomaly.jevContext} → Score adjusted from ${original.score} to ${blendedScore}`;
    } catch {
      results.push({
        agentId: anomaly.agentId,
        originalScore: original.score,
        recalibratedScore: original.score,
        blendedScore: original.score,
        reason: `recalibration_failed: ${anomaly.reason}`,
        durationMs: Math.round(performance.now() - startTime),
      });
    }
  }

  return results;
}
