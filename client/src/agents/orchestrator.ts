import type * as THREE from 'three';
import type { AgentId, AgentOutput, AgentConsensus, DebateRound } from '@shared/domain/agent';
import { calculateAgreementDelta, computeConsensusVerdict } from '@shared/domain/agent';
import type { UnifiedAnalysis } from '@/analysis';
import { fromThreeBufferGeometry } from '@/analysis/geometryConversion';
import { extractVertexData } from '@/analysis/geometryData';
import { BaseAgent, type AgentContext } from './baseAgent';
import { GeometryAnalyst } from './geometryAnalyst';
import { PrintabilityScorer } from './printabilityScorer';
import { FailurePredictor } from './failurePredictor';
import { OptimizationAdvisor } from './optimizationAdvisor';
import { visionProvider } from './visionProvider';
import {
  getAgentLabel,
  DEFAULT_AGENT_CONFIGS,
  type AgentResultWithExplanation,
  type AgentRunSummary,
  type VotingRecord,
  type AgentStageConfig,
} from './types';
import { getActiveProvider } from '@/lib/apiKeys';
import { AI_PROVIDER_METADATA } from '@shared/domain/providers';

export class AgentOrchestrator {
  private agents: Map<AgentId, BaseAgent> = new Map();
  private configs: Map<AgentId, AgentStageConfig> = new Map();

  constructor(configs?: AgentStageConfig[]) {
    const stageConfigs = configs ?? DEFAULT_AGENT_CONFIGS;

    const agentInstances: BaseAgent[] = [
      new GeometryAnalyst(),
      new PrintabilityScorer(),
      new FailurePredictor(),
      new OptimizationAdvisor(),
    ];

    for (const agent of agentInstances) {
      this.agents.set(agent.agentId, agent);
      const config = stageConfigs.find(c => c.agentId === agent.agentId);
      this.configs.set(agent.agentId, config ?? {
        agentId: agent.agentId,
        enabled: true,
        weight: 0.25,
        useVision: false,
        timeoutMs: 15000,
      });
    }
  }

  async runFullAnalysis(
    geometry: THREE.BufferGeometry,
    unifiedAnalysis: UnifiedAnalysis,
    fileName: string,
    visionCanvas?: HTMLCanvasElement | null,
    language?: string,
  ): Promise<AgentRunSummary> {
    const startTime = performance.now();

    const model = fromThreeBufferGeometry(geometry);
    const vertexData = extractVertexData(model);
    const ctx: AgentContext = {
      geometry,
      unifiedAnalysis,
      vertexPositions: vertexData.positions,
      vertexNormals: vertexData.normals,
      modelSize: vertexData.size,
      previousOutputs: new Map(),
      fileName,
    };

    if (visionCanvas) {
      visionProvider.setRenderCanvas(visionCanvas);
    }

    if (visionCanvas) {
      ctx.visionAnalysis = await this.captureVisionAnalysis(vertexData, fileName, language);
    }

    const enabledAgents = Array.from(this.agents.values())
      .filter(a => this.configs.get(a.agentId)?.enabled !== false);

    const initialResults = await this.runAgentsParallel(ctx, enabledAgents);

    for (const result of initialResults) {
      const agentId = result.agentId;
      ctx.previousOutputs.set(agentId, {
        agentId,
        agentName: result.agentName,
        score: result.score,
        confidence: result.confidence,
        verdict: result.verdict,
        details: result.details,
        explanation: result.explanation,
        markers: result.markers,
      });
    }

    const debateResults = await this.runDebatePhase(ctx, enabledAgents, initialResults);
    const finalResults = this.applyDebateAdjustments(initialResults, debateResults);

    const consensus = this.computeConsensus(finalResults, debateResults);
    const votingRecords = this.buildVotingRecords(finalResults, debateResults);
    const totalDurationMs = Math.round(performance.now() - startTime);

    return {
      results: finalResults,
      consensus,
      votingRecords,
      totalDurationMs,
      usedVision: !!ctx.visionAnalysis,
    };
  }

  private async runAgentsParallel(
    ctx: AgentContext,
    agents: BaseAgent[],
  ): Promise<AgentResultWithExplanation[]> {
    const tasks = agents.map(async (agent) => {
      const config = this.configs.get(agent.agentId);
      const timeoutMs = config?.timeoutMs ?? 15000;

      const result = await Promise.race([
        agent.execute(ctx),
        this.timeout(timeoutMs, agent.agentId),
      ]);

      return result;
    });

    return Promise.all(tasks);
  }

  private async runDebatePhase(
    ctx: AgentContext,
    agents: BaseAgent[],
    currentResults: AgentResultWithExplanation[],
  ): Promise<DebateRound[]> {
    const rounds: DebateRound[] = [];
    const MAX_ROUNDS = 2;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const otherOutputs = Array.from(ctx.previousOutputs.values());
      const votes: Record<AgentId, number> = {} as Record<AgentId, number>;
      const adjustedScores: Record<AgentId, number> = {} as Record<AgentId, number>;

      for (const agent of agents) {
        const currentResult = currentResults.find(r => r.agentId === agent.agentId);
        if (!currentResult) continue;

        const reviewResult = agent.review(ctx, otherOutputs);
        const adjustment = reviewResult.scoreAdjustment;
        const config = this.configs.get(agent.agentId);

        const adjustedScore = Math.max(0, Math.min(100, currentResult.score + adjustment));
        votes[agent.agentId] = config?.weight ?? 0.25;
        adjustedScores[agent.agentId] = adjustedScore;

        currentResult.score = adjustedScore;
        currentResult.verdict = adjustedScore >= 70 ? 'pass' : adjustedScore >= 40 ? 'warning' : 'fail';
        if (adjustment !== 0) {
          currentResult.explanation += `\n\n[Debate Round ${round}] ${reviewResult.notes}`;
        }
      }

      const scoreValues = Object.values(adjustedScores);
      const agreementDelta = scoreValues.length > 0 ? calculateAgreementDelta(scoreValues) : 0;

      rounds.push({
        roundNumber: round,
        votes,
        adjustedScores,
        agreementDelta,
      });

      if (agreementDelta < 10) break;
    }

    return rounds;
  }

  private applyDebateAdjustments(
    results: AgentResultWithExplanation[],
    _debateRounds: DebateRound[],
  ): AgentResultWithExplanation[] {
    return results;
  }

  private computeConsensus(
    results: AgentResultWithExplanation[],
    debateRounds: DebateRound[],
  ): AgentConsensus {
    if (results.length === 0) {
      return {
        overallScore: 0,
        agreementDelta: 0,
        verdict: 'inconclusive',
        summary: 'No agent results available',
        round: 0,
        totalRounds: 0,
        agentScores: {} as Record<AgentId, number>,
        agentVerdicts: {} as Record<AgentId, 'pass' | 'warning' | 'fail' | 'inconclusive'>,
      };
    }

    const agentScores: Record<AgentId, number> = {} as Record<AgentId, number>;
    const agentVerdicts: Record<AgentId, 'pass' | 'warning' | 'fail' | 'inconclusive'> =
      {} as Record<AgentId, 'pass' | 'warning' | 'fail' | 'inconclusive'>;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const result of results) {
      const config = this.configs.get(result.agentId);
      const weight = config?.weight ?? 0.25;
      agentScores[result.agentId] = result.score;
      agentVerdicts[result.agentId] = result.verdict;
      weightedSum += result.score * weight;
      totalWeight += weight;
    }

    const overallScore = Math.round(weightedSum / Math.max(0.001, totalWeight));
    const lastRound = debateRounds[debateRounds.length - 1];
    const agreementDelta = lastRound?.agreementDelta ?? 0;
    const totalRounds = debateRounds.length;

    const consensusVerdict = computeConsensusVerdict(overallScore);

    const summaryParts: string[] = [];
    for (const result of results) {
      summaryParts.push(`${result.agentName}: ${Math.round(result.score)}/100 (${result.verdict})`);
    }

    let summary = `Consensus Score: ${overallScore}/100 (${consensusVerdict.toUpperCase()})\n`;
    summary += `Agreement Delta: ${agreementDelta.toFixed(1)} (${agreementDelta < 10 ? 'strong agreement' : agreementDelta < 20 ? 'moderate agreement' : 'disagreement'})\n`;
    summary += `Debate Rounds: ${totalRounds}\n\n`;
    summary += summaryParts.join('\n');

    if (consensusVerdict === 'pass') {
      summary += '\n\nModel is print-ready. Minor optimizations may still improve quality.';
    } else if (consensusVerdict === 'warning') {
      summary += '\n\nModel has moderate issues. Review recommendations before printing.';
    } else {
      summary += '\n\nModel has critical issues. Significant modifications recommended before printing.';
    }

    return {
      overallScore,
      agreementDelta,
      verdict: consensusVerdict,
      summary,
      round: totalRounds,
      totalRounds,
      agentScores,
      agentVerdicts,
    };
  }

  private buildVotingRecords(
    results: AgentResultWithExplanation[],
    debateRounds: DebateRound[],
  ): VotingRecord[] {
    return results.map(result => {
      const config = this.configs.get(result.agentId);
      const lastRound = debateRounds[debateRounds.length - 1];
      const adjustedScore = lastRound?.adjustedScores[result.agentId] ?? result.score;

      return {
        agentId: result.agentId,
        initialScore: result.score,
        adjustedScore,
        weight: config?.weight ?? 0.25,
        confidence: result.confidence,
      };
    });
  }

  private async captureVisionAnalysis(
    vertexData: { triangleCount: number; size: { x: number; y: number; z: number } },
    fileName: string,
    language?: string,
  ): Promise<string | undefined> {
    const activeProvider = getActiveProvider();
    if (!activeProvider) return undefined;

    const metadata = AI_PROVIDER_METADATA[activeProvider];
    const screenshot = await visionProvider.captureScene();
    if (!screenshot) return undefined;

    const surfaceArea = vertexData.size.x * vertexData.size.y * 2
      + vertexData.size.x * vertexData.size.z * 2
      + vertexData.size.y * vertexData.size.z * 2;
    const volume = vertexData.size.x * vertexData.size.y * vertexData.size.z;

    const summary = `File: ${fileName}\nTriangles: ${vertexData.triangleCount}\nSurface Area: ${surfaceArea.toFixed(1)}mm²\nVolume: ${volume.toFixed(1)}mm³`;

    const result = await visionProvider.analyzeWithAI(screenshot, summary, {
      provider: activeProvider,
      apiKey: 'configured',
    }, language);

    return result.rawResponse;
  }

  private timeout(ms: number, agentId: AgentId): Promise<AgentResultWithExplanation> {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          agentId,
          agentName: getAgentLabel(agentId),
          score: 0,
          confidence: 0,
          verdict: 'inconclusive',
          explanation: `Agent timed out after ${ms}ms`,
          details: { error: 'timeout' },
          markers: [],
          durationMs: ms,
        });
      }, ms);
    });
  }
}
