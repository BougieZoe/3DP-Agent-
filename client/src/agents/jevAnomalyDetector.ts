import type { AgentId, DebateRound } from '@shared/domain/agent';
import type { JevDecision } from '@/lib/jevClient';
import type { AgentResultWithExplanation } from './types';

export type AnomalyReason = 'low_trust' | 'score_deviation' | 'overconfident';

export interface AnomalyReport {
  agentId: AgentId;
  reason: AnomalyReason;
  severity: number;
  jevContext: string;
}

const TRUST_THRESHOLD = 0.7;
const SCORE_DEVIATION_THRESHOLD = 30;
const LOW_CONFIDENCE_THRESHOLD = 0.4;
const HIGH_SCORE_THRESHOLD = 70;

export function detectAnomalies(
  results: AgentResultWithExplanation[],
  jevDecision: JevDecision,
  _debateRounds: DebateRound[],
): AnomalyReport[] {
  const reports: AnomalyReport[] = [];

  for (const result of results) {
    const trust = jevDecision.agentTrustAdjustments[result.agentId] ?? 1.0;

    if (trust < TRUST_THRESHOLD) {
      reports.push({
        agentId: result.agentId,
        reason: 'low_trust',
        severity: 1 - trust,
        jevContext: `Jev trust: ${(trust * 100).toFixed(0)}%`,
      });
      continue;
    }

    const scoreDelta = Math.abs(result.score - jevDecision.jevScore);
    if (scoreDelta > SCORE_DEVIATION_THRESHOLD) {
      reports.push({
        agentId: result.agentId,
        reason: 'score_deviation',
        severity: scoreDelta / 100,
        jevContext: `Agent: ${result.score}, Jev: ${jevDecision.jevScore}, delta: ${scoreDelta}`,
      });
      continue;
    }

    if (result.confidence < LOW_CONFIDENCE_THRESHOLD && result.score > HIGH_SCORE_THRESHOLD) {
      reports.push({
        agentId: result.agentId,
        reason: 'overconfident',
        severity: (1 - result.confidence) * (result.score / 100),
        jevContext: `Low confidence (${(result.confidence * 100).toFixed(0)}%) with high score (${result.score})`,
      });
    }
  }

  return reports.sort((a, b) => b.severity - a.severity);
}
