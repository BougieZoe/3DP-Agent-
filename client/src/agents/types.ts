import type { AgentId, AgentOutput, AgentVerdict, RiskMarker } from '@shared/domain/agent';

export interface AgentStageConfig {
  agentId: AgentId;
  enabled: boolean;
  weight: number;
  useVision: boolean;
  timeoutMs: number;
}

export const DEFAULT_AGENT_CONFIGS: AgentStageConfig[] = [
  { agentId: 'geometry_analyst', enabled: true, weight: 0.30, useVision: true, timeoutMs: 15000 },
  { agentId: 'printability_scorer', enabled: true, weight: 0.30, useVision: false, timeoutMs: 10000 },
  { agentId: 'failure_predictor', enabled: true, weight: 0.25, useVision: true, timeoutMs: 15000 },
  { agentId: 'optimization_advisor', enabled: true, weight: 0.15, useVision: true, timeoutMs: 20000 },
];

export interface AgentResultWithExplanation {
  agentId: AgentId;
  agentName: string;
  score: number;
  confidence: number;
  verdict: AgentVerdict;
  explanation: string;
  details: Record<string, unknown>;
  markers: RiskMarker[];
  durationMs: number;
}

export interface VotingRecord {
  agentId: AgentId;
  initialScore: number;
  adjustedScore: number;
  weight: number;
  confidence: number;
}

export interface AgentRunSummary {
  results: AgentResultWithExplanation[];
  consensus: {
    overallScore: number;
    verdict: AgentVerdict;
    summary: string;
    agreementDelta: number;
  };
  votingRecords: VotingRecord[];
  totalDurationMs: number;
  usedVision: boolean;
}

export function getAgentLabel(agentId: AgentId): string {
  const labels: Record<AgentId, string> = {
    geometry_analyst: 'Geometry Analyst',
    printability_scorer: 'Printability Scorer',
    failure_predictor: 'Failure Predictor',
    optimization_advisor: 'Optimization Advisor',
  };
  return labels[agentId];
}

export function getAgentDescription(agentId: AgentId): string {
  const descriptions: Record<AgentId, string> = {
    geometry_analyst: 'Analyzes mesh geometry, wall thickness, overhangs, and features',
    printability_scorer: 'Scores overall printability based on weighted geometry metrics',
    failure_predictor: 'Identifies potential failure modes during printing',
    optimization_advisor: 'Suggests geometry improvements and orientation changes',
  };
  return descriptions[agentId];
}
