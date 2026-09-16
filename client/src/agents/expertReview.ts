// client/src/agents/expertReview.ts
//
// Expert LLM review — the "knowledge layer" of the expert-router architecture.
// The deterministic rule engine (AgentOrchestrator) computes the numbers; this
// module hands those numbers to a MATERIAL-DOMAIN EXPERT persona and asks it to
// translate them into plain-language advice a beginner understands.
//
// One LLM call, on-demand. Returns null when the LLM path is unavailable, so
// callers keep the deterministic result untouched — same contract as the deep
// analysis pipeline.
//
// Personas are now managed by the ExpertRegistry (expertRegistry.ts).
// This module delegates prompt building to the registry and handles the
// LLM call + response parsing.

import { callAI } from '@/lib/apiKeys';
import { getLLMProvider } from '@/lib/llmAccess';
import type { Material } from '@shared/domain/material';
import type { ModelData } from '@/lib/ruleEngine';
import type { ObjectContext } from '@/analysis/context';
import {
  getExpertForTechnology,
  getExpertSystemPrompt as registryGetExpertSystemPrompt,
  buildExpertContextForTech,
} from './expertRegistry';

export const EXPERT_REVIEW_TIMEOUT_MS = 90_000;

export type ExpertVerdict = 'pass' | 'warning' | 'fail';

export interface ExpertFinding {
  what: string;
  why: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ExpertAction {
  do: string;
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
}

export interface ExpertReview {
  /** Overall plain-language verdict, aligned with the deterministic status. */
  verdict: ExpertVerdict;
  /** The numbers, translated into advice a non-expert understands. */
  plain: string;
  findings: ExpertFinding[];
  actions: ExpertAction[];
}

/** Human label for the object-context axis, for the LLM prompt. */
export function objectContextLabel(ctx: ObjectContext): string {
  switch (ctx) {
    case 'structural': return 'structural / load-bearing (furniture)';
    case 'large': return 'large / construction-scale';
    case 'detailed': return 'detailed / fine-feature (jewelry, dental, miniatures)';
    case 'liquid-cooling': return 'liquid-cooling / heat-exchanger (cold plates, water blocks)';
    default: return 'general-purpose';
  }
}

/**
 * Build the expert system prompt for a material technology + object context.
 * Delegates to the ExpertRegistry — the persona definitions live there.
 */
export function buildExpertSystemPrompt(tech: Material['technology'], objectContext: ObjectContext): string {
  return registryGetExpertSystemPrompt(tech, objectContext);
}

/**
 * Build compact context for the expert from rule-engine numbers.
 * Delegates to the ExpertRegistry.
 */
export function buildExpertContext(
  model: ModelData,
  material: Material,
  objectContext: ObjectContext,
  materialMetrics?: string,
): string {
  return buildExpertContextForTech(model, material, objectContext, materialMetrics);
}

/** Extract the JSON object out of an LLM response, tolerating stray text. */
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

const VERDICTS: ExpertVerdict[] = ['pass', 'warning', 'fail'];

function clampVerdict(v: unknown): ExpertVerdict {
  return typeof v === 'string' && (VERDICTS as string[]).includes(v)
    ? (v as ExpertVerdict)
    : 'warning';
}

function asSeverity(v: unknown): 'low' | 'medium' | 'high' {
  return v === 'low' || v === 'high' ? v : 'medium';
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[] : [];
}

/** Validate + normalize the LLM's raw output into a typed ExpertReview. */
export function parseExpertReview(raw: string): ExpertReview | null {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const rec = parsed as Record<string, unknown>;
  const plain = typeof rec.plain === 'string' && rec.plain.trim().length > 0
    ? rec.plain.trim()
    : null;
  if (!plain) return null;

  const findings = asArray(rec.findings).map((f) => ({
    what: typeof f.what === 'string' ? f.what : 'Unnamed issue',
    why: typeof f.why === 'string' ? f.why : '',
    severity: asSeverity(f.severity),
  }));
  const actions = asArray(rec.actions).map((a) => ({
    do: typeof a.do === 'string' ? a.do : 'Review the geometry',
    impact: asSeverity(a.impact),
    effort: asSeverity(a.effort),
  }));

  return {
    verdict: clampVerdict(rec.verdict),
    plain,
    findings,
    actions,
  };
}

export interface ExpertReviewInput {
  model: ModelData;
  material: Material;
  objectContext: ObjectContext;
  /** Per-family deterministic metrics (resin suction/islands, FGF warpage/delamination). */
  materialMetrics?: string;
  language?: string;
  signal?: AbortSignal;
}

/**
 * Run one expert LLM review. Returns null when no LLM path is available or the
 * call fails — callers keep the deterministic result untouched.
 */
export async function runExpertReview(input: ExpertReviewInput): Promise<ExpertReview | null> {
  const llm = getLLMProvider();
  if (!llm || llm.provider === 'amd-cloud') return null;

  const system = buildExpertSystemPrompt(input.material.technology, input.objectContext);
  const user = buildExpertContext(input.model, input.material, input.objectContext, input.materialMetrics);

  // Caller-provided signal wins; otherwise the timeout aborts the in-flight call.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXPERT_REVIEW_TIMEOUT_MS);
  const signal = input.signal ?? controller.signal;
  try {
    const raw = await callAI(llm.provider, llm.key, system, user, input.language, signal);
    return parseExpertReview(raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
