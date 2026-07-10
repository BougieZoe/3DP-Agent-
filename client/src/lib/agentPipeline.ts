// client/src/lib/agentPipeline.ts
//
// Sequential 5-agent pipeline for 3DP Agent, built for AMD ACT II.
// Calls your own AMD Cloud (Qwen3-30B on MI300X via vLLM) through the
// existing callAI() in apiKeys.ts — no Band platform dependency.
//
// Core concept: this is not 5 independently running agents. It's 1 function
// calling the AI 5 times in sequence, swapping the system prompt each time,
// and feeding the previous step's JSON output as context into the next step.

import { callAI, getActiveProvider, getKey } from './apiKeys';

export interface AgentStepResult {
  agentName: string;
  raw: string;            // Raw text returned by the AI
  parsed: unknown | null; // Result of JSON.parse(raw), or null if parsing failed
}

export interface PipelineResult {
  steps: AgentStepResult[];
  finalScore: unknown | null; // Printability Scorer's final structured output
}

// ---- The 5 system prompts ----

const GEOMETRY_ANALYST_PROMPT = `You are the 3DP Geometry Analyst. Your job is pure geometric measurement only: wall thickness below the minimum printable threshold, overhang angles exceeding 45° that require support, whether the mesh is watertight (closed), and whether normals are consistently oriented. Report only measured geometric facts and concrete numeric values, including how many faces/triangles your measurement is based on (field name: sample_faces). Do not predict print failures or suggest fixes — that is the job of other agents. Respond in JSON format only, no markdown fences, no extra text.`;

const FAILURE_PREDICTOR_PROMPT = `You are the 3DP Failure Predictor. Based on the geometric data provided by the Geometry Analyst, predict the specific types of print failure likely to occur (e.g. warping, layer shifting, support collapse, overhang sagging), the severity of each (low/medium/high), and roughly which stage or layer of the print it is likely to occur at. If you disagree with the Geometry Analyst's measurement (e.g. the sample size looks too small, or a number looks physically implausible), say so explicitly before giving your prediction. Do not perform geometric measurement, and do not suggest parameter fixes — prediction only. Respond in JSON format only, no markdown fences, no extra text.`;

const OPTIMIZATION_ADVISOR_PROMPT = `You are the 3DP Optimization Advisor. Based on the Geometry Analyst's measurements and the Failure Predictor's failure predictions, provide specific, actionable fixes: recommended layer height, support density, print orientation, material choice, and how the geometry itself should be modified (e.g. "increase this wall from 1.2mm to 2mm"). If you think the Failure Predictor's severity assessment seems inconsistent with the geometry data, say so. Do not perform geometric measurement or failure prediction — solutions only. Respond in JSON format only, no markdown fences, no extra text.`;

const PRINTABILITY_SCORER_PROMPT = `You are the 3DP Printability Scorer. Aggregate all upstream analysis results and produce a printability_score (0-100) along with a summary report. Your score MUST be consistent with the severity of any issues reported upstream — do not give a high score (80+) if a high-severity failure was predicted. Respond in JSON format only, no markdown fences, no extra text, and always include a numeric printability_score field.`;

const ORCHESTRATOR_SUMMARY_PROMPT = `You are the 3DP Orchestrator. You have received the complete analysis results from the Geometry Analyst, Failure Predictor, Optimization Advisor, and Printability Scorer. Turn these four technical reports into a short, human-readable summary (3-5 sentences) — the kind of concise advice a 3D printing engineer would actually say to a client. If any agents disagreed with each other along the way, mention that disagreement briefly. Do not restate raw JSON fields; speak in plain language.`;

// ---- Critic prompts for the two high-risk checkpoints ----
// (Geometry Analyst = only agent touching raw data; Printability Scorer =
// final number the user sees. Failure Predictor / Optimization Advisor are
// reasoning agents and are allowed to disagree in their own prompts instead.)

const GEOMETRY_CRITIC_PROMPT = `You are a strict fact-checker reviewing a Geometry Analyst's report. Check ONLY these two things: (1) is the sample_faces count at least 100? If not, that measurement is unreliable. (2) is wall_thickness_mm a positive number? If zero or negative, that's physically impossible. Respond in JSON format only: {"passed": true} if both checks pass, or {"passed": false, "feedback": "<specific, actionable instruction for what to fix>"} if either check fails.`;

const SCORER_CRITIC_PROMPT = `You are a strict fact-checker reviewing a Printability Scorer's report. You will be given the scorer's JSON output AND a summary of what upstream agents found. Check: does the printability_score make sense given the severity of issues mentioned upstream? A score of 80+ alongside any "high severity" issue is a contradiction. Respond in JSON format only: {"passed": true} if consistent, or {"passed": false, "feedback": "<specific, actionable instruction for what to fix>"} if inconsistent.`;

// ---- Generic helpers ----

function extractJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function callAgent(
  systemPrompt: string,
  userContext: string,
  language?: string
): Promise<AgentStepResult> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error('No active AI provider. Please configure an API key (or select AMD Cloud) first.');
  }
  const apiKey = getKey(provider) ?? ''; // amd-cloud doesn't require a key
  const raw = await callAI(provider, apiKey, systemPrompt, userContext, language);
  const parsed = extractJson(raw);
  return { agentName: systemPrompt.slice(0, 30), raw, parsed };
}

async function callAgentWithCritic(
  agentPrompt: string,
  criticPrompt: string,
  userContext: string,
  language: string | undefined,
  buildCriticContext: (agentRaw: string) => string
): Promise<AgentStepResult & { confidence: 'high' | 'low_after_retries' }> {
  const MAX_RETRIES = 2;
  let feedback: string | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const contextWithFeedback = feedback
      ? `${userContext}\n\n[Previous attempt was rejected: ${feedback}. Please correct this.]`
      : userContext;

    const result = await callAgent(agentPrompt, contextWithFeedback, language);

    if (result.parsed === null) {
      feedback = 'Your response was not valid JSON. Return ONLY a JSON object.';
      if (attempt > MAX_RETRIES) {
        return { ...result, confidence: 'low_after_retries' };
      }
      continue;
    }

    const criticContext = buildCriticContext(result.raw);
    const criticResult = await callAgent(criticPrompt, criticContext, language);
    const verdict = criticResult.parsed as { passed?: boolean; feedback?: string } | null;

    if (verdict?.passed) {
      return { ...result, confidence: 'high' };
    }

    feedback = verdict?.feedback ?? 'The critic rejected this without specific feedback.';
    if (attempt > MAX_RETRIES) {
      return { ...result, confidence: 'low_after_retries' };
    }
  }

  throw new Error('callAgentWithCritic exited without returning');
}

// ---- Main pipeline ----

export async function runAgentPipeline(
  modelDataSummary: string,
  language?: string,
  onStepComplete?: (step: AgentStepResult, index: number) => void
): Promise<PipelineResult> {
  const steps: AgentStepResult[] = [];

  const geoResult = await callAgentWithCritic(
    GEOMETRY_ANALYST_PROMPT,
    GEOMETRY_CRITIC_PROMPT,
    `Model data: ${modelDataSummary}`,
    language,
    (agentRaw) => `Geometry Analyst reported: ${agentRaw}`
  );
  steps.push(geoResult);
  onStepComplete?.(geoResult, 0);

  const failureResult = await callAgent(
    FAILURE_PREDICTOR_PROMPT,
    `Geometry Analyst's findings: ${geoResult.raw}`,
    language
  );
  steps.push(failureResult);
  onStepComplete?.(failureResult, 1);

  const optResult = await callAgent(
    OPTIMIZATION_ADVISOR_PROMPT,
    `Geometry analysis: ${geoResult.raw}\n\nFailure prediction: ${failureResult.raw}`,
    language
  );
  steps.push(optResult);
  onStepComplete?.(optResult, 2);

  const scoreResult = await callAgentWithCritic(
    PRINTABILITY_SCORER_PROMPT,
    SCORER_CRITIC_PROMPT,
    `Geometry analysis: ${geoResult.raw}\n\nFailure prediction: ${failureResult.raw}\n\nOptimization advice: ${optResult.raw}`,
    language,
    (agentRaw) =>
      `Scorer output: ${agentRaw}\n\nUpstream context (for consistency check): Failure prediction was: ${failureResult.raw}`
  );
  steps.push(scoreResult);
  onStepComplete?.(scoreResult, 3);

  const summaryResult = await callAgent(
    ORCHESTRATOR_SUMMARY_PROMPT,
    `Geometry: ${geoResult.raw}\nFailure prediction: ${failureResult.raw}\nOptimization advice: ${optResult.raw}\nScore: ${scoreResult.raw}`,
    language
  );
  steps.push(summaryResult);
  onStepComplete?.(summaryResult, 4);

  return {
    steps,
    finalScore: scoreResult.parsed,
  };
}