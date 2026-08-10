import type * as THREE from 'three';
import type { AgentId, AgentOutput, AgentConsensus, DebateRound } from '@shared/domain/agent';
import { calculateAgreementDelta, computeConsensusVerdict } from '@shared/domain/agent';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import type { UnifiedAnalysis } from '@/analysis';
import type { Material } from '@/lib/materialState';
import { DEFAULT_MATERIAL } from '@/lib/materialState';
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
    language?: ContentLang,
    material: Material = DEFAULT_MATERIAL,
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
      material,
      language: language ?? 'en',
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

    const consensus = this.computeConsensus(finalResults, debateResults, language ?? 'en');
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
        this.timeout(timeoutMs, agent.agentId, ctx.language),
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
        currentResult.verdict = agent.computeVerdict(adjustedScore);
        if (adjustment !== 0) {
          currentResult.explanation += `\n\n[${translate(CONTENT, 'agent.debateRound', ctx.language, { round })}] ${reviewResult.notes}`;
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
    language: ContentLang = 'en',
  ): AgentConsensus {
    if (results.length === 0) {
      return {
        overallScore: 0,
        agreementDelta: 0,
        verdict: 'inconclusive',
        summary: translate(CONTENT, 'orchestrator.noResults', language),
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
      summaryParts.push(translate(CONTENT, 'orchestrator.agentLine', language, {
        name: getAgentLabel(result.agentId, language),
        score: Math.round(result.score),
        verdict: result.verdict,
      }));
    }

    const agreementLabel =
      agreementDelta < 10
        ? translate(CONTENT, 'orchestrator.agreement.strong', language)
        : agreementDelta < 20
          ? translate(CONTENT, 'orchestrator.agreement.moderate', language)
          : translate(CONTENT, 'orchestrator.agreement.disagreement', language);

    let summary = translate(CONTENT, 'orchestrator.consensusScore', language, {
      score: overallScore,
      verdict: consensusVerdict.toUpperCase(),
    });
    summary += `\n${translate(CONTENT, 'orchestrator.agreementDelta', language, {
      delta: agreementDelta.toFixed(1),
      label: agreementLabel,
    })}`;
    summary += `\n${translate(CONTENT, 'orchestrator.debateRounds', language, { rounds: totalRounds })}\n\n`;
    summary += summaryParts.join('\n');

    if (consensusVerdict === 'pass') {
      summary += `\n\n${translate(CONTENT, 'orchestrator.verdict.pass', language)}`;
    } else if (consensusVerdict === 'warning') {
      summary += `\n\n${translate(CONTENT, 'orchestrator.verdict.warning', language)}`;
    } else {
      summary += `\n\n${translate(CONTENT, 'orchestrator.verdict.fail', language)}`;
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
    language?: ContentLang,
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

    const summary = translate(CONTENT, 'vision.geometrySummary', language ?? 'en', {
      file: fileName,
      triangles: vertexData.triangleCount,
      area: surfaceArea.toFixed(1),
      volume: volume.toFixed(1),
    });

    const result = await visionProvider.analyzeWithAI(screenshot, summary, {
      provider: activeProvider,
      apiKey: 'configured',
    }, language);

    return result.rawResponse;
  }

  private timeout(
    ms: number,
    agentId: AgentId,
    language: ContentLang = 'en',
  ): Promise<AgentResultWithExplanation> {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          agentId,
          agentName: getAgentLabel(agentId, language),
          score: 0,
          confidence: 0,
          verdict: 'inconclusive',
          explanation: translate(CONTENT, 'orchestrator.timedOut', language, { ms }),
          details: { error: 'timeout' },
          markers: [],
          durationMs: ms,
        });
      }, ms);
    });
  }
}
