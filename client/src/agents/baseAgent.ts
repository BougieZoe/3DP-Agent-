import type * as THREE from 'three';
import type { AgentId, AgentOutput, AgentVerdict, RiskMarker } from '@shared/domain/agent';
import type { AgentResultWithExplanation } from './types';
import type { UnifiedAnalysis } from '@/analysis';
import type { Material } from '@/lib/materialState';
import { DEFAULT_MATERIAL } from '@/lib/materialState';
import { getAgentLabel } from './types';

export interface AgentContext {
  geometry: THREE.BufferGeometry;
  unifiedAnalysis: UnifiedAnalysis;
  vertexPositions: Float32Array;
  vertexNormals: Float32Array;
  modelSize: { x: number; y: number; z: number };
  visionAnalysis?: string;
  previousOutputs: Map<AgentId, AgentOutput>;
  fileName: string;
  material: Material;
}

export interface AgentCapabilities {
  supportsVision: boolean;
  requiresVision: boolean;
  timeoutMs: number;
}

export abstract class BaseAgent {
  public readonly agentId: AgentId;
  public readonly agentName: string;
  public readonly capabilities: AgentCapabilities;

  constructor(agentId: AgentId, capabilities: AgentCapabilities) {
    this.agentId = agentId;
    this.agentName = getAgentLabel(agentId);
    this.capabilities = capabilities;
  }

  async execute(ctx: AgentContext): Promise<AgentResultWithExplanation> {
    const startTime = performance.now();

    try {
      const output = await this.analyze(ctx);
      const durationMs = Math.round(performance.now() - startTime);

      return {
        agentId: output.agentId,
        agentName: output.agentName,
        score: output.score,
        confidence: output.confidence,
        verdict: output.verdict,
        explanation: output.explanation,
        details: output.details as Record<string, unknown>,
        markers: output.markers,
        durationMs,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      const message = error instanceof Error ? error.message : 'Unknown agent error';

      return {
        agentId: this.agentId,
        agentName: this.agentName,
        score: 0,
        confidence: 0,
        verdict: 'inconclusive',
        explanation: `Agent failed: ${message}`,
        details: { error: message },
        markers: [],
        durationMs,
      };
    }
  }

  review(ctx: AgentContext, otherOutputs: AgentOutput[]): { scoreAdjustment: number; notes: string } {
    return { scoreAdjustment: 0, notes: '' };
  }

  protected abstract analyze(ctx: AgentContext): Promise<AgentOutput>;

  protected makeOutput(
    score: number,
    confidence: number,
    verdict: AgentVerdict,
    explanation: string,
    details: Record<string, unknown>,
    markers: RiskMarker[] = [],
  ): AgentOutput {
    return {
      agentId: this.agentId,
      agentName: this.agentName,
      score: Math.max(0, Math.min(100, score)),
      confidence: Math.max(0, Math.min(1, confidence)),
      verdict,
      explanation,
      details,
      markers,
    };
  }

  public computeVerdict(score: number): AgentVerdict {
    if (score >= 70) return 'pass';
    if (score >= 40) return 'warning';
    return 'fail';
  }
}
