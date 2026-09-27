export {
  AgentIdSchema,
  AgentVerdictSchema,
  RiskMarkerSchema,
  Vector3ValueSchema,
  GeometryAnalystDetailsSchema,
  ScoringBreakdownSchema,
  PredictedRiskSchema,
  FailurePredictorDetailsSchema,
  OptimizedGeometrySuggestionSchema,
  MaterialRecommendationSchema,
  OptimizationAdvisorDetailsSchema,
} from './agentSchemas';

export type {
  AgentId,
  AgentVerdict,
  RiskMarker,
  GeometryAnalystDetails,
  ScoringBreakdown,
  PredictedRisk,
  FailurePredictorDetails,
  OptimizedGeometrySuggestion,
  MaterialRecommendation,
  OptimizationAdvisorDetails,
} from './agentSchemas';

import type {
  AgentId,
  AgentVerdict,
  RiskMarker,
} from './agentSchemas';

export interface AgentOutput<THelpers = Record<string, unknown>> {
  agentId: AgentId;
  agentName: string;
  score: number;
  confidence: number;
  verdict: AgentVerdict;
  details: THelpers;
  explanation: string;
  markers: RiskMarker[];
}

export interface DebateRound {
  roundNumber: number;
  votes: Record<AgentId, number>;
  adjustedScores: Record<AgentId, number>;
  agreementDelta: number;
}

export interface JevDecisionData {
  /** Whether Jev was called and returned a result */
  jevUsed: boolean;
  /** Jev's overall score (0-100, mapped from 0-5) */
  jevScore: number;
  /** Jev's verdict */
  jevVerdict: AgentVerdict;
  /** Jev's confidence in its own answer (0-1) */
  jevConfidence: number;
  /** Single most critical risk identified by Jev */
  topRisk: string;
  /** Most valuable next action recommended by Jev */
  primaryAction: string;
  /** Latency of Jev call in ms */
  jevLatencyMs: number;
  /** Cost of Jev call in USD */
  jevCostUsd: number;
  /** Number of questions Jev answered */
  jevQuestionCount: number;
  /** Agent trust adjustments from Jev (agentId -> adjustment multiplier) */
  agentTrustAdjustments: Record<string, number>;
}

export interface AgentConsensus {
  overallScore: number;
  agreementDelta: number;
  verdict: AgentVerdict;
  summary: string;
  round: number;
  totalRounds: number;
  agentScores: Record<AgentId, number>;
  agentVerdicts: Record<AgentId, AgentVerdict>;
  jev?: JevDecisionData;
}

export function calculateAgreementDelta(scores: number[]): number {
  if (scores.length === 0) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length;
  return Math.sqrt(variance);
}

/**
 * Agent-consensus verdict boundaries.
 *
 * Owned here rather than in client/src/analysis/thresholds.ts because the
 * shared layer must not import client code. The client mirrors both values in
 * `thresholds.ruling` (consensusPassMinScore / consensusWarningMinScore) so the
 * whole ruling rule set stays auditable in one place — see RULE_VERSION there.
 * Changing either value changes rulings: treat it as a rule-set change.
 */
export const CONSENSUS_PASS_MIN_SCORE = 70;
export const CONSENSUS_WARNING_MIN_SCORE = 40;

export function computeConsensusVerdict(overallScore: number): AgentVerdict {
  if (overallScore >= CONSENSUS_PASS_MIN_SCORE) return 'pass';
  if (overallScore >= CONSENSUS_WARNING_MIN_SCORE) return 'warning';
  return 'fail';
}

export interface AgentContextSnapshot {
  triangleCount: number;
  boundingBoxVolumeMm3: number;
  surfaceAreaMm2: number;
  wallThicknessStatus: string;
  overhangStatus: string;
  findingCount: number;
}
