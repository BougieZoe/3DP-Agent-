import type * as THREE from 'three';
import type { AgentId, AgentOutput, AgentConsensus, DebateRound } from '@shared/domain/agent';
import { calculateAgreementDelta, computeConsensusVerdict } from '@shared/domain/agent';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import type { UnifiedAnalysis } from '@/analysis';
import type { MetricsResult } from '@/analysis/types';
import type { Material, MaterialTechnology } from '@shared/domain/material';
import { DEFAULT_MATERIAL } from '@shared/domain/material';
import { fromThreeBufferGeometry } from '@/analysis/geometryConversion';
import { extractVertexData } from '@/analysis/geometryData';
import { BaseAgent, type AgentContext } from './baseAgent';
import { visionProvider, type VisionAnalysisResult } from './visionProvider';
import {
  getAgentLabel,
  type AgentResultWithExplanation,
  type AgentRunSummary,
  type VotingRecord,
} from './types';
import { getLLMProvider } from '@/lib/llmAccess';
import { runJevConsensus, type JevDecision } from '@/lib/jevClient';
import { getAgentStateManager } from './agentState';
import { getAuthSnapshot } from '@/lib/authStore';
import { getKey as getApiKey } from '@/lib/apiKeys';
import { detectAnomalies, type AnomalyReport } from './jevAnomalyDetector';
import { recalibrateFlaggedAgents, type RecalibrationResult } from './jevRecalibrator';
import { getAgentRegistry, type AgentSlot } from './core/agentRegistry';
import { getAgentBus } from './core/agentBus';
import { getTelemetryHub } from './core/agentTelemetry';
import { PipelineFactory } from './core/pipelineFactory';

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
  private registry = getAgentRegistry();
  private bus = getAgentBus();
  private telemetry = getTelemetryHub();

  constructor() {
    this.syncFromRegistry();
    this.registry.subscribe(() => this.syncFromRegistry());
  }

  private syncFromRegistry(): void {
    const newAgents = this.registry.instantiate();
    this.agents.clear();
    for (const agent of newAgents) {
      this.agents.set(agent.agentId, agent);
      this.telemetry.update(agent.agentId, { status: 'idle', currentPhase: 'ready', progress: 0 });
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
    const stateManager = getAgentStateManager();
    stateManager.reset();

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

    const pipeline = PipelineFactory.build(material.technology as MaterialTechnology);
    const enabledAgents = Array.from(this.agents.values());

    this.bus.publish({ from: 'orchestrator', to: 'broadcast', type: 'telemetry', payload: { phase: 'analysis_start', agents: enabledAgents.map(a => a.agentId) } });

    // Run agents and Jev Early Triage in parallel
    const dims = unifiedAnalysis.metrics.result.boundingBoxDimensionsMm ?? { x: 0, y: 0, z: 0 };
    const earlyTriagePromise = this.runJevEarlyTriage(unifiedAnalysis, material);

    const initialResults = await this.runAgentsParallel(ctx, enabledAgents);

    // Get Early Triage results to adjust agent weights
    const earlyTriage = await earlyTriagePromise;
    if (earlyTriage) {
      this.adjustWeightsByEarlyTriage(initialResults, earlyTriage);
    }

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

    const jevDecision = await this.runJevDecision(initialResults, unifiedAnalysis, debateResults, material) ?? undefined;

    // Phase 2: Anomaly Detection — flag agents whose scores Jev finds untrustworthy
    let anomalies: AnomalyReport[] = [];
    let recalibrationResults: RecalibrationResult[] = [];

    if (jevDecision?.jevUsed) {
      anomalies = detectAnomalies(initialResults, jevDecision, debateResults);

      // Phase 3: Targeted Recalibration — re-run only the worst offender
      if (anomalies.length > 0) {
        recalibrationResults = await recalibrateFlaggedAgents(
          anomalies, this.agents, ctx, initialResults, jevDecision,
        );
      }
    }

    const consensus = this.computeConsensus(initialResults, debateResults, language ?? 'en', jevDecision);
    const votingRecords = this.buildVotingRecords(initialResults, debateResults, initialScores);
    const totalDurationMs = Math.round(performance.now() - startTime);

    return {
      results: initialResults,
      consensus,
      votingRecords,
      totalDurationMs,
      usedVision: !!ctx.visionAnalysis,
      analysisSource: 'rules',
      ...(recalibrationResults.length > 0 ? { recalibrations: recalibrationResults } : {}),
    };
  }

  private async runAgentsParallel(
    ctx: AgentContext,
    agents: BaseAgent[],
  ): Promise<AgentResultWithExplanation[]> {
    const stateManager = getAgentStateManager();

    const tasks = agents.map(async (agent) => {
      const slot = this.registry.get(agent.agentId);
      const timeoutMs = slot?.timeoutMs ?? 15000;

      stateManager.setAgentStatus(agent.agentId, 'running');
      this.telemetry.update(agent.agentId, { status: 'running', currentPhase: 'analyzing', progress: 0 });
      this.bus.publish({ from: agent.agentId, to: 'broadcast', type: 'telemetry', payload: { status: 'running' } });

      try {
        const result = await Promise.race([
          agent.execute(ctx),
          this.timeout(timeoutMs, agent.agentId, ctx.language),
        ]);

        stateManager.setAgentStatus(agent.agentId, 'done');
        this.telemetry.update(agent.agentId, {
          status: 'done',
          currentPhase: 'complete',
          progress: 1,
          score: result.score,
          confidence: result.confidence,
          markers: result.markers,
          durationMs: result.durationMs,
        });
        this.bus.publish({ from: agent.agentId, to: 'broadcast', type: 'score', payload: { score: result.score, verdict: result.verdict } });
        return result;
      } catch (err) {
        stateManager.setAgentStatus(agent.agentId, 'error');
        this.telemetry.update(agent.agentId, { status: 'error', currentPhase: 'failed' });
        throw err;
      }
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
        const slot = this.registry.get(agent.agentId);

        const adjustedScore = Math.max(0, Math.min(100, currentResult.score + adjustment));
        votes[agent.agentId] = slot?.weight ?? 0.25;
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

  private async runJevDecision(
    results: AgentResultWithExplanation[],
    unifiedAnalysis: UnifiedAnalysis,
    debateRounds: DebateRound[],
    material: Material,
  ): Promise<JevDecision | undefined> {
    const apiKey = this.getJevApiKey();
    if (apiKey === undefined) return undefined; // No key available

    const agentResults = results.map((r) => ({
      agentId: r.agentId,
      score: r.score,
      confidence: r.confidence,
      verdict: r.verdict,
      markers: r.markers,
    }));

    const lastRound = debateRounds[debateRounds.length - 1];
    const dims = unifiedAnalysis.metrics.result.boundingBoxDimensionsMm ?? { x: 0, y: 0, z: 0 };

    const context = {
      triangleCount: unifiedAnalysis.topology.result.triangleCount,
      volumeMm3: unifiedAnalysis.metrics.result.meshVolumeMm3,
      surfaceAreaMm2: unifiedAnalysis.metrics.result.surfaceAreaMm2,
      dims: { x: dims.x, y: dims.y, z: dims.z },
      material: material.technology.toUpperCase(),
      agreementDelta: lastRound?.agreementDelta ?? 0,
    };

    const result = await runJevConsensus(apiKey, agentResults, context);
    return result === null ? undefined : result;
  }

  private async runJevEarlyTriage(
    unifiedAnalysis: UnifiedAnalysis,
    material: Material,
  ): Promise<{ riskCategory: string; agentPriority: string } | undefined> {
    const apiKey = this.getJevApiKey();
    if (!apiKey) return undefined;

    const dims = unifiedAnalysis.metrics.result.boundingBoxDimensionsMm ?? { x: 0, y: 0, z: 0 };
    const state = [
      `Model: ${unifiedAnalysis.topology.result.triangleCount} triangles, ${unifiedAnalysis.metrics.result.meshVolumeMm3.toFixed(0)}mm³`,
      `Dimensions: ${dims.x.toFixed(1)} × ${dims.y.toFixed(1)} × ${dims.z.toFixed(1)} mm`,
      `Material: ${material.technology.toUpperCase()}`,
    ].join('\n');

    const questions = {
      risk_category: {
        type: 'choice' as const,
        instructions: 'Primary risk category for this model',
        criteria: {
          watertight: 'Mesh has holes or non-manifold edges',
          wall_thickness: 'Regions thinner than minimum printable thickness',
          overhang: 'Large overhang areas requiring support',
          dimensional: 'Dimensions too small or too large',
          none: 'No significant risks detected',
        },
      },
      agent_priority: {
        type: 'choice' as const,
        instructions: 'Which agent should be weighted most heavily',
        criteria: {
          geometry_analyst: 'Mesh integrity issues detected',
          printability_scorer: 'Print settings are critical',
          failure_predictor: 'Failure risk is high',
          optimization_advisor: 'Orientation/material optimization needed',
        },
      },
    };

    try {
      const { callJev } = await import('@/lib/jevClient');
      const response = await callJev(apiKey, state, questions);
      const riskCategory = response.answers.risk_category?.type === 'choice'
        ? response.answers.risk_category.choice
        : 'none';
      const agentPriority = response.answers.agent_priority?.type === 'choice'
        ? response.answers.agent_priority.choice
        : 'geometry_analyst';
      return { riskCategory, agentPriority };
    } catch {
      return undefined;
    }
  }

  private adjustWeightsByEarlyTriage(
    results: AgentResultWithExplanation[],
    triage: { riskCategory: string; agentPriority: string },
  ): void {
    const priorityMap: Record<string, AgentId> = {
      geometry_analyst: 'geometry_analyst',
      printability_scorer: 'printability_scorer',
      failure_predictor: 'failure_predictor',
      optimization_advisor: 'optimization_advisor',
    };

    const priorityAgent = priorityMap[triage.agentPriority];
    if (priorityAgent) {
      const slot = this.registry.get(priorityAgent);
      if (slot) {
        this.registry.updateWeight(priorityAgent, Math.min(0.5, slot.weight * 1.5));
      }
    }
  }

  private getJevApiKey(): string | undefined {
    const token = getAuthSnapshot().token;
    if (token) return '';
    return getApiKey('openrouter');
  }

  private computeConsensus(
    results: AgentResultWithExplanation[],
    debateRounds: DebateRound[],
    language: ContentLang = 'en',
    jevDecision?: JevDecision,
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
      const slot = this.registry.get(result.agentId);
      const weight = slot?.weight ?? 0.25;
      agentScores[result.agentId] = result.score;
      agentVerdicts[result.agentId] = result.verdict;
      weightedSum += result.score * weight;
      totalWeight += weight;
    }

    const weightedAverage = Math.round(weightedSum / Math.max(0.001, totalWeight));
    const lastRound = debateRounds[debateRounds.length - 1];
    const agreementDelta = lastRound?.agreementDelta ?? 0;
    const totalRounds = debateRounds.length;

    const overallScore = jevDecision?.jevUsed ? jevDecision.jevScore : weightedAverage;
    const consensusVerdict = jevDecision?.jevUsed ? jevDecision.jevVerdict : computeConsensusVerdict(overallScore);

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
      jev: jevDecision?.jevUsed ? {
        jevUsed: true,
        jevScore: jevDecision.jevScore,
        jevVerdict: jevDecision.jevVerdict,
        jevConfidence: jevDecision.jevConfidence,
        topRisk: jevDecision.topRisk,
        primaryAction: jevDecision.primaryAction,
        jevLatencyMs: jevDecision.raw.latencyMs,
        jevCostUsd: jevDecision.raw.usage.cost,
        jevQuestionCount: Object.keys(jevDecision.raw.answers).length,
        agentTrustAdjustments: jevDecision.agentTrustAdjustments,
      } : undefined,
    };
  }

  private buildVotingRecords(
    results: AgentResultWithExplanation[],
    debateRounds: DebateRound[],
    initialScores: Map<AgentId, number>,
  ): VotingRecord[] {
    return results.map(result => {
      const slot = this.registry.get(result.agentId);
      const lastRound = debateRounds[debateRounds.length - 1];
      const initialScore = initialScores.get(result.agentId) ?? result.score;
      const adjustedScore = lastRound?.adjustedScores[result.agentId] ?? result.score;

      return {
        agentId: result.agentId,
        initialScore,
        adjustedScore,
        weight: slot?.weight ?? 0.25,
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
