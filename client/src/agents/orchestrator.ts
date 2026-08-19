import type * as THREE from 'three';
import type { AgentId, AgentOutput, AgentConsensus, DebateRound } from '@shared/domain/agent';
import { calculateAgreementDelta, computeConsensusVerdict } from '@shared/domain/agent';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import type { UnifiedAnalysis } from '@/analysis';
import type { MetricsResult } from '@/analysis/types';
import type { Material } from '@shared/domain/material';
import { DEFAULT_MATERIAL } from '@shared/domain/material';
import { fromThreeBufferGeometry } from '@/analysis/geometryConversion';
import { extractVertexData } from '@/analysis/geometryData';
import { BaseAgent, type AgentContext } from './baseAgent';
import { GeometryAnalyst } from './geometryAnalyst';
import { PrintabilityScorer } from './printabilityScorer';
import { FailurePredictor } from './failurePredictor';
import { OptimizationAdvisor } from './optimizationAdvisor';
import { visionProvider, type VisionAnalysisResult } from './visionProvider';
import {
  getAgentLabel,
  DEFAULT_AGENT_CONFIGS,
  type AgentResultWithExplanation,
  type AgentRunSummary,
  type VotingRecord,
  type AgentStageConfig,
} from './types';
import { getLLMProvider } from '@/lib/llmAccess';

/**
 * Time budget for the optional vision capture step, aligned with the
 * vision-capable agents' default timeoutMs (geometry_analyst / failure_predictor).
 */
const VISION_TIMEOUT_MS = 15_000;

/**
 * Build the geometry summary handed to the vision LLM from the rule-engine
 * mesh metrics — the single authoritative source. The eye sees the render,
 * the text carries the SAME numbers the rest of the stack shows: exact
 * signed-tetrahedron volume and exact surface area. No bounding-box
 * multiplication that could silently disagree with the analysis panels.
 */
function buildVisionGeometrySummary(
  metrics: MetricsResult,
  triangleCount: number,
  fileName: string,
  language: ContentLang = 'en',
): string {
  return translate(CONTENT, 'vision.geometrySummary', language, {
    file: fileName,
    triangles: triangleCount,
    area: metrics.surfaceAreaMm2.toFixed(1),
    volume: metrics.meshVolumeMm3.toFixed(1),
  });
}

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
      const vision = await this.captureVisionAnalysis(vertexData, unifiedAnalysis.metrics.result, fileName, language);
      if (vision) {
        ctx.visionAnalysis = vision.raw;
        ctx.visionResult = vision;
      }
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

    const initialScores = new Map<AgentId, number>(
      initialResults.map(result => [result.agentId, result.score]),
    );

    const debateResults = await this.runDebatePhase(ctx, enabledAgents, initialResults);

    const consensus = this.computeConsensus(initialResults, debateResults, language ?? 'en');
    const votingRecords = this.buildVotingRecords(initialResults, debateResults, initialScores);
    const totalDurationMs = Math.round(performance.now() - startTime);

    return {
      results: initialResults,
      consensus,
      votingRecords,
      totalDurationMs,
      usedVision: !!ctx.visionAnalysis,
      analysisSource: 'rules',
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
    initialScores: Map<AgentId, number>,
  ): VotingRecord[] {
    return results.map(result => {
      const config = this.configs.get(result.agentId);
      const lastRound = debateRounds[debateRounds.length - 1];
      const initialScore = initialScores.get(result.agentId) ?? result.score;
      const adjustedScore = lastRound?.adjustedScores[result.agentId] ?? result.score;

      return {
        agentId: result.agentId,
        initialScore,
        adjustedScore,
        weight: config?.weight ?? 0.25,
        confidence: result.confidence,
      };
    });
  }

  private async captureVisionAnalysis(
    vertexData: { triangleCount: number },
    metrics: MetricsResult,
    fileName: string,
    language?: ContentLang,
  ): Promise<(Pick<VisionAnalysisResult, 'qualitativeAssessment' | 'observedIssues' | 'confidence'> & { raw: string }) | undefined> {
    const llm = getLLMProvider();
    if (!llm || llm.provider === 'amd-cloud') return undefined;

    const screenshot = await visionProvider.captureScene();
    if (!screenshot) return undefined;

    // A hung vision provider must not block the whole rule analysis. Abort
    // after the same time budget the vision-capable agents use (15s), and
    // actually terminate the in-flight request so we don't leak connections
    // or keep burning tokens in the background.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
    try {
      const summary = buildVisionGeometrySummary(metrics, vertexData.triangleCount, fileName, language ?? 'en');

      const result = await visionProvider.analyzeWithAI(screenshot, summary, {
        provider: llm.provider,
        apiKey: llm.key,
      }, language, controller.signal);

      return {
        raw: result.rawResponse,
        qualitativeAssessment: result.qualitativeAssessment,
        observedIssues: result.observedIssues,
        confidence: result.confidence,
      };
    } finally {
      clearTimeout(timer);
    }
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
