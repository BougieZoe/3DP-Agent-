// client/src/lib/jevClient.ts
//
// Jev Decision Engine client — calls /api/jev relay which forwards to OpenRouter.
// Jev answers typed questions about a state with calibrated probabilities.
// Cost: ~$0.00003 per call, latency: ~40ms.
//
// For signed-in users: server uses OPENROUTER_API_KEY from env.
// For anonymous users: they provide their own key (BYOK).

import { getAuthSnapshot } from './authStore';

const JEV_ENDPOINT = '/api/jev';
const JEV_MODEL = '~typesafe/jev-latest';

export interface JevQuestion {
  type: 'noul' | 'choice' | 'score';
  instructions: string;
  criteria?: Record<string, string> | string[];
  true_when?: string;
  false_when?: string;
}

export interface JevAnswers {
  [questionId: string]:
    | { type: 'noul'; noul: number }
    | { type: 'choice'; choice: string }
    | { type: 'score'; score: number };
}

export interface JevResult {
  answers: JevAnswers;
  usage: { input_tokens: number; output_tokens: number; cost: number };
  latencyMs: number;
}

export interface JevDecision {
  overallScore: number;
  verdict: 'pass' | 'warning' | 'fail' | 'inconclusive';
  confidence: number;
  topRisk: string;
  primaryAction: string;
  agentTrustAdjustments: Record<string, number>;
  raw: JevResult;
  jevUsed: boolean;
  jevScore: number;
  jevVerdict: 'pass' | 'warning' | 'fail' | 'inconclusive';
  jevConfidence: number;
  jevLatencyMs: number;
  jevCostUsd: number;
  jevQuestionCount: number;
}

/**
 * Build the Jev state from agent results and context.
 * This is the structured input Jev makes decisions about.
 */
export function buildJevState(
  agentResults: Array<{
    agentId: string;
    score: number;
    confidence: number;
    verdict: string;
    markers?: Array<{ type: string; severity: number; description: string }>;
  }>,
  context: {
    triangleCount: number;
    volumeMm3: number;
    surfaceAreaMm2: number;
    dims: { x: number; y: number; z: number };
    material: string;
    historyCount?: number;
    historyFailureCount?: number;
    agreementDelta?: number;
  },
): string {
  const agentSummary = agentResults
    .map(
      (r) =>
        `- ${r.agentId}: score=${r.score}, confidence=${r.confidence}, verdict=${r.verdict}` +
        (r.markers?.length
          ? `, issues=[${r.markers.map((m) => m.description).join(', ')}]`
          : ''),
    )
    .join('\n');

  const historyLine = context.historyCount
    ? `Prior analyses: ${context.historyCount} (failures: ${context.historyFailureCount ?? 0})`
    : 'No prior history';

  return [
    `Model: ${context.triangleCount} triangles, ${context.volumeMm3.toFixed(0)}mm³, ${context.surfaceAreaMm2.toFixed(0)}mm²`,
    `Dimensions: ${context.dims.x.toFixed(1)} × ${context.dims.y.toFixed(1)} × ${context.dims.z.toFixed(1)} mm`,
    `Material: ${context.material}`,
    `Agreement delta: ${(context.agreementDelta ?? 0).toFixed(1)}`,
    historyLine,
    '',
    'Agent results:',
    agentSummary,
  ].join('\n');
}

/**
 * Define the Jev questions for 3D printability consensus.
 */
export function buildJevQuestions() {
  return {
    overall_score: {
      type: 'score' as const,
      instructions:
        'Overall printability score from 0-100 based on all agent findings, geometry data, and history.',
      criteria: [
        '0-20: Critical defects, impossible to print',
        '20-40: Major issues, needs significant repair',
        '40-60: Moderate issues, repairable with effort',
        '60-80: Minor issues, printable with adjustments',
        '80-100: Ready to print or near-ready',
      ],
    },
    verdict: {
      type: 'choice' as const,
      instructions: 'Final manufacturing recommendation.',
      criteria: {
        pass: 'Safe to print with minor or no changes',
        warning: 'Printable but needs attention (supports/orientation/material)',
        fail: 'High risk of failure, redesign or repair recommended',
        inconclusive: 'Insufficient data to make a reliable judgment',
      },
    },
    confidence: {
      type: 'noul' as const,
      instructions:
        'Is the available geometric data sufficient for a reliable judgment? True when measurements are unambiguous and cover all critical regions.',
      true_when:
        'Mesh metrics are complete, wall thickness and overhang data are available, and no borderline measurements exist',
      false_when:
        'Missing measurements, extreme aspect ratios, unusual geometry, or borderline thresholds',
    },
    top_risk: {
      type: 'choice' as const,
      instructions: 'The single most critical risk for this model.',
      criteria: {
        watertight: 'Mesh is not watertight, has holes or non-manifold edges',
        wall_thickness: 'Some regions are thinner than minimum printable thickness',
        overhang: 'Large overhang areas requiring extensive support',
        dimensional: 'Dimensions are too small or too large for reliable printing',
        aspect_ratio: 'Extreme aspect ratio makes the part fragile or unstable',
        none: 'No significant risks detected',
      },
    },
    primary_action: {
      type: 'choice' as const,
      instructions: 'The single most valuable next action.',
      criteria: {
        seal_mesh: 'Close holes and fix non-manifold geometry',
        thicken_walls: 'Increase wall thickness in critical regions',
        add_supports: 'Add or optimize support structures',
        reorient: 'Change print orientation to reduce overhangs',
        change_material: 'Switch to a more suitable material',
        proceed: 'Proceed to slice and print',
      },
    },
  };
}

/**
 * Call the Jev Decision Engine via /api/jev relay.
 * Returns structured decisions with calibrated probabilities.
 */
export async function callJev(
  apiKey: string,
  state: string,
  questions: Record<string, JevQuestion>,
  signal?: AbortSignal,
): Promise<JevResult> {
  const startTime = performance.now();
  const token = getAuthSnapshot().token;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(JEV_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      apiKey,
      body: {
        model: JEV_MODEL,
        state,
        questions,
      },
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`Jev API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const latencyMs = Math.round(performance.now() - startTime);

  return {
    answers: data.answers ?? {},
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
      cost: data.usage?.cost ?? 0,
    },
    latencyMs,
  };
}

/**
 * Parse Jev answers into a typed decision object.
 */
export function parseJevDecision(result: JevResult): JevDecision {
  const { answers } = result;

  // Score: Jev returns 0-5 scale, map to 0-100
  const rawScore =
    answers.overall_score?.type === 'score' ? answers.overall_score.score : 2.5;
  const overallScore = Math.round(Math.min(5, Math.max(0, rawScore)) * 20);

  // Verdict
  const verdictRaw =
    answers.verdict?.type === 'choice' ? answers.verdict.choice : 'inconclusive';
  const verdict = (
    ['pass', 'warning', 'fail', 'inconclusive'].includes(verdictRaw)
      ? verdictRaw
      : 'inconclusive'
  ) as JevDecision['verdict'];

  // Confidence (noul: 0-1)
  const confidence =
    answers.confidence?.type === 'noul' ? answers.confidence.noul : 0.5;

  // Top risk
  const topRisk =
    answers.top_risk?.type === 'choice' ? answers.top_risk.choice : 'none';

  // Primary action
  const primaryAction =
    answers.primary_action?.type === 'choice'
      ? answers.primary_action.choice
      : 'proceed';

  // Trust adjustments: not from Jev yet, default to equal
  const agentTrustAdjustments: Record<string, number> = {};

  return {
    overallScore,
    verdict,
    confidence,
    topRisk,
    primaryAction,
    agentTrustAdjustments,
    raw: result,
    jevUsed: true,
    jevScore: overallScore,
    jevVerdict: verdict,
    jevConfidence: confidence,
    jevLatencyMs: result.latencyMs,
    jevCostUsd: result.usage.cost,
    jevQuestionCount: Object.keys(answers).length,
  };
}

/**
 * High-level: run Jev consensus on agent results.
 * Falls back to null on any error (network, CORS, API key missing).
 */
export async function runJevConsensus(
  apiKey: string,
  agentResults: Array<{
    agentId: string;
    score: number;
    confidence: number;
    verdict: string;
    markers?: Array<{ type: string; severity: number; description: string }>;
  }>,
  context: {
    triangleCount: number;
    volumeMm3: number;
    surfaceAreaMm2: number;
    dims: { x: number; y: number; z: number };
    material: string;
    historyCount?: number;
    historyFailureCount?: number;
    agreementDelta?: number;
  },
  signal?: AbortSignal,
): Promise<JevDecision | null> {
  try {
    const state = buildJevState(agentResults, context);
    const questions = buildJevQuestions();
    const result = await callJev(apiKey, state, questions, signal);
    return parseJevDecision(result);
  } catch {
    return null;
  }
}
