export { AgentOrchestrator } from './orchestrator';
export { BaseAgent, type AgentContext } from './baseAgent';
export { GeometryAnalyst } from './geometryAnalyst';
export { PrintabilityScorer } from './printabilityScorer';
export { FailurePredictor } from './failurePredictor';
export { OptimizationAdvisor } from './optimizationAdvisor';
export { VisionProvider, visionProvider } from './visionProvider';
export { runDeepAnalysis } from './deepAnalysis';
export { runExpertReview, parseExpertReview, buildExpertContext, objectContextLabel, EXPERT_REVIEW_TIMEOUT_MS } from './expertReview';
export type { ExpertReview, ExpertFinding, ExpertAction, ExpertVerdict } from './expertReview';
export type { AgentResultWithExplanation, AgentRunSummary, AgentStageConfig, VotingRecord, RecalibrationEvent } from './types';
export { getAgentLabel, getAgentDescription, DEFAULT_AGENT_CONFIGS } from './types';
export type { AgentConsensus, AgentOutput, AgentId, RiskMarker } from '@shared/domain/agent';

// Core FPGA modules
export { AgentRegistry, getAgentRegistry, type AgentSlot } from './core/agentRegistry';
export { AgentBus, getAgentBus, type AgentMessage, type AgentMessageType } from './core/agentBus';
export { TelemetryHub, getTelemetryHub, type AgentTelemetry, type AgentStatus } from './core/agentTelemetry';
export { PipelineFactory, type PipelineConfig } from './core/pipelineFactory';
