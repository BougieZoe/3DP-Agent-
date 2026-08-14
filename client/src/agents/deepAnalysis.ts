import { runAgentPipeline, type AgentStepResult, type PipelineResult } from '@/lib/agentPipeline';
import type { ModelData } from '@/lib/ruleEngine';
import type { Material } from '@/lib/materialState';
import { DEFAULT_MATERIAL } from '@/lib/materialState';
import { getActiveProvider, getKey } from '@/lib/apiKeys';
import type { AgentRunSummary } from './types';
import { getAgentLabel } from './types';
import type { AgentId, AgentVerdict } from '@shared/domain/agent';

// ---------------------------------------------------------------------------
// Deep LLM analysis layer.
//
// The rule engine (AgentOrchestrator + per-agent subclasses) is deterministic,
// instant and free — it stays as the primary result. This module is the
// optional *second opinion*: a real 5-step LLM pipeline (geometry analyst →
// failure predictor → optimization advisor → printability scorer → summary)
// with critic verification and retries, built on agentPipeline.ts.
//
// It deliberately returns the SAME AgentRunSummary shape the UI already
// renders, so integration is a one-line change in Home.tsx. When the LLM is
// unavailable (no API key, timeout, provider error) it returns null and the
// caller keeps the rule-engine result — no UX regression, no spinner stuck.
// ---------------------------------------------------------------------------

const DEEP_ANALYSIS_TIMEOUT_MS = 90_000;

/** Build a compact, provider-agnostic geometry summary for the LLM pipeline. */
export function buildModelDataSummary(model: ModelData, material: Material): string {
  const wt = model.wallThickness;
  const oh = model.overhang;
  const minWall = wt.minThickness != null ? `${wt.minThickness.toFixed(2)} mm` : 'unknown';
  const p5Wall = wt.p5Thickness != null ? `${wt.p5Thickness.toFixed(2)} mm` : 'unknown';
  const dims = `${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)} mm`;

  return [
    `FileName: ${model.fileName}`,
    `Dimensions(mm): ${dims}`,
    `Volume(mm3): ${model.volume.toFixed(0)}`,
    `SurfaceArea(mm2): ${model.surfaceArea.toFixed(0)}`,
    `WallThickness: min=${minWall}, p5=${p5Wall}, thinWallCount=${wt.thinWallCount}, thinWallRatio=${wt.thinWallRatio.toFixed(3)}, status=${wt.status}`,
    `Overhang: facesBeyondThreshold=${oh.areas}, status=${oh.status}`,
    `Material: ${material.name} (overhangThreshold=${material.overhangThreshold}°, density=${material.densityGPerCm3} g/cm3)`,
  ].join('\n');
}

/** 0–100 score inferred from the LLM scorer's structured output, or null. */
export function scoreFromParsed(parsed: unknown): number | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const raw = record.printability_score;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function verdictForScore(score: number): AgentVerdict {
  if (score >= 70) return 'pass';
  if (score >= 40) return 'warning';
  return 'fail';
}

/** Map an LLM step onto the deterministic dataset: score+confidence+verdict. */
export function mapStepToResult(
  step: AgentStepResult,
  agentId: AgentId,
  language: string,
): AgentRunSummary['results'][number] {
  const score = scoreFromParsed(step.parsed) ?? 50;
  const stepConf = step.confidence;
  const confidence = stepConf === 'high' ? 0.85 : stepConf === 'low_after_retries' ? 0.45 : 0.6;

  let extra = '';
  if (step.parsed && typeof step.parsed === 'object') {
    try {
      extra = '\n```json\n' + JSON.stringify(step.parsed, null, 2) + '\n```';
    } catch {
      extra = '';
    }
  }

  return {
    agentId,
    agentName: getAgentLabel(agentId, language as 'en' | 'ja' | 'zh'),
    score,
    confidence,
    verdict: verdictForScore(score),
    explanation: step.raw + extra,
    details: (step.parsed && typeof step.parsed === 'object'
      ? step.parsed
      : { raw: step.raw }) as Record<string, unknown>,
    markers: [],
    durationMs: 0,
  };
}

const STEP_TO_AGENT: Array<{ agentId: AgentId; weight: number }> = [
  { agentId: 'geometry_analyst', weight: 0.30 },
  { agentId: 'failure_predictor', weight: 0.25 },
  { agentId: 'optimization_advisor', weight: 0.15 },
  { agentId: 'printability_scorer', weight: 0.30 },
];

/**
 * Run the deep LLM pipeline and map its output onto the AgentRunSummary
 * contract the UI renders. Returns null when the LLM path is unavailable so
 * callers fall back to the deterministic rule engine untouched.
 */
export async function runDeepAnalysis(
  model: ModelData,
  language: string = 'en',
  onStepComplete?: (step: AgentStepResult, index: number) => void,
  material: Material = DEFAULT_MATERIAL,
): Promise<AgentRunSummary | null> {
  const startedAt = performance.now();
  const provider = getActiveProvider();
  if (!provider || provider === 'amd-cloud') return null;

  const summaryText = buildModelDataSummary(model, material);
  const results: AgentRunSummary['results'] = [];
  const votingRecords: AgentRunSummary['votingRecords'] = [];

  let pipeline: PipelineResult;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEP_ANALYSIS_TIMEOUT_MS);
  try {
    // The signal is threaded down to every fetch call, so a timeout genuinely
    // cancels in-flight requests instead of merely letting the caller move on
    // while the pipeline keeps consuming tokens/connections in the background.
    pipeline = await runAgentPipeline(summaryText, language, onStepComplete, material, controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  const steps = pipeline.steps;
  // The 5-step pipeline maps onto the 4-agent UI contract: the final summary
  // step becomes the consensus text; the four analysis steps become results.
  const analysisSteps = steps.slice(0, 4);
  const summaryStep = steps[4];

  analysisSteps.forEach((step, i) => {
    const { agentId, weight } = STEP_TO_AGENT[i] ?? { agentId: 'printability_scorer' as AgentId, weight: 0.25 };
    const result = mapStepToResult(step, agentId, language);
    results.push(result);
    votingRecords.push({
      agentId,
      initialScore: result.score,
      adjustedScore: result.score,
      weight,
      confidence: result.confidence,
    });
  });

  // Consensus: weighted mean of the four analysis steps, with the LLM
  // summary as the human-readable verdict.
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < results.length; i++) {
    const w = votingRecords[i]?.weight ?? 0.25;
    weightedSum += results[i].score * w;
    totalWeight += w;
  }
  const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  const verdict = verdictForScore(overallScore);
  const summary = summaryStep
    ? summaryStep.raw
    : `${verdict.toUpperCase()} — deep analysis completed without a summary step.`;

  const agreementDelta = computeAgreementDelta(results.map(r => r.score));

  const runSummary: AgentRunSummary = {
    results,
    consensus: {
      overallScore,
      verdict,
      summary,
      agreementDelta,
    },
    votingRecords,
    totalDurationMs: Math.round(performance.now() - startedAt),
    usedVision: false,
    analysisSource: 'llm',
  };

  void getKey(provider); // re-affirm key presence (getActiveProvider already checked it)
  return runSummary;
}

function computeAgreementDelta(scores: number[]): number {
  if (scores.length === 0) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length;
  return Math.sqrt(variance);
}
