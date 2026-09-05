/**
 * Semantic Diagnostic Layer
 *
 * Translates already-computed structured geometric facts into a readable
 * diagnosis. This module does NOT compute any values — it only accepts
 * them as input from the caller (ruleEngine / wallThickness / confidence).
 *
 * The model's only job is to turn structured facts into prose. If the
 * model's output contains a numeric claim that doesn't trace back to a
 * value actually passed into its prompt, that's a bug in this layer.
 *
 * Provider modes:
 *   - "none"  (default): module is skipped, pipeline unchanged
 *   - "local": OpenAI-compatible endpoint (Lemonade, Ollama, etc.)
 *   - "cloud": through /api/llm relay with user's key
 */

import {
  getSemanticLayerProvider,
  SEMANTIC_LAYER_LOCAL_ENDPOINT,
  SEMANTIC_LAYER_TIMEOUT_MS,
  LLM_PROXY_ENDPOINT,
} from './config';
import { getAuthSnapshot } from './authStore';

// ── Types ───────────────────────────────────────────────────────────────────

export interface DiagnosticInput {
  wallThicknessDistribution: {
    min: number | null;
    max: number | null;
    mean: number | null;
    belowThresholdPercent: number;
  };
  watertightStatus: {
    isWatertight: boolean;
    boundaryEdgeCount: number;
    nonManifoldEdgeCount: number;
  };
  confidenceScore: number;
  thresholdsApplied: Record<string, number>;
}

export interface DiagnosticOutput {
  summary: string | null;
  citedFacts: string[];
  modelUsed: string | 'unavailable';
}

// ── Prompt construction ─────────────────────────────────────────────────────

/**
 * Build the LLM prompt from DiagnosticInput.
 * Serializes exact numeric values — no paraphrase, no rounding.
 * Exported for testing.
 */
export function buildDiagnosticPrompt(input: DiagnosticInput): string {
  const { wallThicknessDistribution: wt, watertightStatus: ws, confidenceScore, thresholdsApplied } = input;

  const thresholdLines = Object.entries(thresholdsApplied)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join('\n');

  return [
    'You are a 3D printing manufacturing analyst. Given the following geometric facts about a part,',
    'write a concise diagnostic summary (2-4 sentences) identifying the most critical printability',
    'issues and recommending next steps.',
    '',
    'FACTS (use these exact values, do not invent new numbers):',
    '',
    'Wall Thickness:',
    `  - minimum: ${wt.min ?? 'null'} mm`,
    `  - maximum: ${wt.max ?? 'null'} mm`,
    `  - mean: ${wt.mean ?? 'null'} mm`,
    `  - below threshold: ${wt.belowThresholdPercent}%`,
    '',
    'Watertight Status:',
    `  - isWatertight: ${ws.isWatertight}`,
    `  - boundaryEdgeCount: ${ws.boundaryEdgeCount}`,
    `  - nonManifoldEdgeCount: ${ws.nonManifoldEdgeCount}`,
    '',
    `Confidence Score: ${confidenceScore}`,
    '',
    'Thresholds Applied:',
    thresholdLines,
    '',
    'Write the diagnostic now. Reference specific numbers from the facts above.',
  ].join('\n');
}

// ── Fact grounding check ────────────────────────────────────────────────────

/**
 * Extract all numeric values from the DiagnosticInput.
 * Used to verify the model's output doesn't invent facts.
 */
function extractInputNumbers(input: DiagnosticInput): Set<number> {
  const numbers = new Set<number>();
  const { wallThicknessDistribution: wt, watertightStatus: ws, confidenceScore, thresholdsApplied } = input;

  if (wt.min != null) numbers.add(wt.min);
  if (wt.max != null) numbers.add(wt.max);
  if (wt.mean != null) numbers.add(wt.mean);
  numbers.add(wt.belowThresholdPercent);
  numbers.add(Number(ws.isWatertight));
  numbers.add(ws.boundaryEdgeCount);
  numbers.add(ws.nonManifoldEdgeCount);
  numbers.add(confidenceScore);
  for (const v of Object.values(thresholdsApplied)) {
    numbers.add(v);
  }
  return numbers;
}

/**
 * Check if the model's summary references only facts present in the input.
 * Returns cited fact descriptions and flags invented numbers.
 *
 * This is a heuristic check — it looks for numeric patterns in the summary
 * and verifies they appear in the input values.
 */
export function checkGrounding(summary: string, input: DiagnosticInput): {
  citedFacts: string[];
  inventedNumbers: number[];
} {
  const inputNumbers = extractInputNumbers(input);
  const citedFacts: string[] = [];
  const inventedNumbers: number[] = [];

  // Find all numbers in the summary (integers and decimals like 0.8, 12.5, 3.7)
  const numberPattern = /\d+\.?\d*/g;
  const matches = summary.match(numberPattern) ?? [];

  for (const match of matches) {
    const num = parseFloat(match);
    if (inputNumbers.has(num)) {
      citedFacts.push(match);
    } else {
      inventedNumbers.push(num);
    }
  }

  return { citedFacts, inventedNumbers };
}

// ── LLM call ────────────────────────────────────────────────────────────────

async function callLocalProvider(prompt: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(SEMANTIC_LAYER_LOCAL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'local',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.3,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Local provider returned ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callCloudProvider(prompt: string, signal: AbortSignal): Promise<string> {
  const auth = getAuthSnapshot();
  const response = await fetch(LLM_PROXY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    body: JSON.stringify({
      provider: 'openai',
      body: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3,
      },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Cloud provider returned ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? data.text ?? '';
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Run semantic diagnostic on pre-computed geometric facts.
 *
 * Returns null summary when:
 *   - Provider is "none" (default)
 *   - API key missing / endpoint unreachable / timeout
 *   - Model returns empty response
 *
 * Never throws — failures return { summary: null, citedFacts: [], modelUsed: "unavailable" }.
 */
export async function runSemanticDiagnostic(
  input: DiagnosticInput,
  signal?: AbortSignal,
): Promise<DiagnosticOutput> {
  const provider = getSemanticLayerProvider();

  if (provider === 'none') {
    return { summary: null, citedFacts: [], modelUsed: 'unavailable' };
  }

  const prompt = buildDiagnosticPrompt(input);
  const timeoutSignal = AbortSignal.timeout(SEMANTIC_LAYER_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  try {
    const text = provider === 'local'
      ? await callLocalProvider(prompt, combinedSignal)
      : await callCloudProvider(prompt, combinedSignal);

    if (!text.trim()) {
      return { summary: null, citedFacts: [], modelUsed: 'unavailable' };
    }

    const { citedFacts, inventedNumbers } = checkGrounding(text, input);

    // If the model invented more than 2 numbers, treat as unreliable
    if (inventedNumbers.length > 2) {
      return { summary: null, citedFacts: [], modelUsed: 'unavailable' };
    }

    return {
      summary: text.trim(),
      citedFacts,
      modelUsed: provider === 'local' ? 'local' : 'cloud',
    };
  } catch {
    return { summary: null, citedFacts: [], modelUsed: 'unavailable' };
  }
}
