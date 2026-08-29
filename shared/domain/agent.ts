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

export interface AgentConsensus {
  overallScore: number;
  agreementDelta: number;
  verdict: AgentVerdict;
  summary: string;
  round: number;
  totalRounds: number;
  agentScores: Record<AgentId, number>;
  agentVerdicts: Record<AgentId, AgentVerdict>;
}

export function calculateAgreementDelta(scores: number[]): number {
  if (scores.length === 0) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length;
  return Math.sqrt(variance);
}

export function computeConsensusVerdict(overallScore: number): AgentVerdict {
  if (overallScore >= 70) return 'pass';
  if (overallScore >= 40) return 'warning';
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
