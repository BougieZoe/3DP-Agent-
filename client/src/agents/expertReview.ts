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
// Personas are selected by material family (FDM filament / SLA-DLP resin /
// FGF large-format pellet), and the object-context axis (general / structural /
// large / detailed) weights what the expert should care about.

import { callAI } from '@/lib/apiKeys';
import { getLLMProvider } from '@/lib/llmAccess';
import type { Material } from '@shared/domain/material';
import type { ModelData } from '@/lib/ruleEngine';
import type { ObjectContext } from '@/analysis/context';

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
    default: return 'general-purpose';
  }
}

/** Human label for a material family, for the LLM prompt. */
function materialFamilyLabel(tech: Material['technology']): string {
  switch (tech) {
    case 'sla': return 'SLA/DLP resin (VAT photopolymerization)';
    case 'fgf': return 'FGF large-format pellet extrusion';
    default: return 'FDM/FFF filament extrusion';
  }
}

/**
 * The expert's domain knowledge, per material family. These are the real
 * physical failure mechanisms each process cares about — the prompt tells the
 * model what to look for so the plain-language output is actually about the
 * right failure modes for the chosen process.
 */
export function buildExpertSystemPrompt(tech: Material['technology'], objectContext: ObjectContext): string {
  const persona = (() => {
    switch (tech) {
      case 'sla':
        return [
          'You are a senior SLA/DLP resin printing expert. You know how UV-cured photopolymer really behaves:',
          '- suction forces on the FEP film from large horizontal cross-sections (peeling/lifting the part off the plate)',
          '- floating islands — disconnected regions not touching the build plate that print into mid-air and fall',
          '- enclosed cavities that need drain holes, otherwise uncured resin is trapped and can crack',
          '- over-curing on thin/high-surface-area regions, and the inherent brittleness of cured resin',
          '- part orientation to minimize cross-sectional area, so less peel force and fewer supports',
        ].join('\n');
      case 'fgf':
        return [
          'You are a senior FGF (large-format pellet extrusion) printing expert for furniture- and construction-scale parts. You know:',
          '- warpage from thermal contraction across large horizontal surfaces — big parts curl at the corners',
          '- delamination between thick layers, especially on tall vertical walls, from uneven layer cooling',
          '- slenderness: tall-narrow parts risk buckling under their own weight and layer-time effects',
          '- shrinkage and dimensional drift at scale; support and hold-down strategy for meter-scale parts',
          '- that pellet material is cheap per kg, so material choice is a smaller cost lever than print time',
        ].join('\n');
      default:
        return [
          'You are a senior FDM/FFF filament printing expert. You know how fused filament really behaves:',
          '- overhang angles beyond the material threshold sag without support',
          '- warping from uneven cooling and thermal contraction (corners lifting), and first-layer bed adhesion',
          '- layer adhesion strength and where delamination is likely under load',
          '- thin walls below ~2x nozzle diameter print poorly (under-extrusion, weak walls)',
          '- elephant foot, stringing, and support strategy for the given geometry',
        ].join('\n');
    }
  })();

  const focus = (() => {
    switch (objectContext) {
      case 'structural': return 'The part is load-bearing/structural — weight STRENGTH issues (thin walls, layer adhesion, material limits) highest.';
      case 'large': return 'The part is large/construction-scale — weight WARPAGE, delamination at scale, and slenderness highest.';
      case 'detailed': return 'The part has fine detail — weight surface finish, thin features, over-cure/overhang detail loss highest.';
      default: return 'The part is general-purpose — treat strength and geometry risks evenly.';
    }
  })();

  return [
    persona,
    '',
    focus,
    '',
    'Your job: take the deterministic measurements given to you and translate them into plain-language advice a BEGINNER 3D printer user understands. Do not just restate the numbers — explain what they mean, how risky they are, and what to actually do.',
    '',
    'CRITICAL — rule engine priority: the measurements are authoritative and were computed by real geometry analysis. Your verdict MUST be consistent with them: if the wall thickness or overhang status is "critical", never say the part is ready to print. Treat the measured status as ground truth and your expert judgement as the interpretation layer.',
    '',
    'Respond in JSON only, no markdown fences, no extra text, with exactly this shape:',
    '{"verdict":"pass|warning|fail","plain":"2-4 plain-language sentences explaining the key risks in beginner terms, citing concrete numbers","findings":[{"what":"...","why":"...","severity":"low|medium|high"}],"actions":[{"do":"...","impact":"low|medium|high","effort":"low|medium|high"}]}',
  ].join('\n');
}

/** Deterministic numbers → compact context for the expert. */
export function buildExpertContext(
  model: ModelData,
  material: Material,
  objectContext: ObjectContext,
  materialMetrics?: string,
): string {
  const wt = model.wallThickness;
  const oh = model.overhang;
  const minWall = wt.minThickness != null ? `${wt.minThickness.toFixed(2)} mm` : 'not measured';
  const p5Wall = wt.p5Thickness != null ? `${wt.p5Thickness.toFixed(2)} mm` : 'not measured';

  return [
    `FileName: ${model.fileName}`,
    `Dimensions(mm): ${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)}`,
    `Volume(mm3): ${model.volume.toFixed(0)}`,
    `WallThickness: min=${minWall}, p5=${p5Wall}, thinWallRatio=${wt.thinWallRatio.toFixed(3)}, status=${wt.status}`,
    `Overhang: ${oh.areas} faces beyond ${oh.angle}°, status=${oh.status}`,
    `Material: ${material.name} (${materialFamilyLabel(material.technology)}), overhangThreshold=${material.overhangThreshold}°`,
    `ObjectContext: ${objectContextLabel(objectContext)}`,
    materialMetrics ? `MaterialSpecificMetrics:\n${materialMetrics}` : 'MaterialSpecificMetrics: (none — running generic analysis)',
  ].join('\n');
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
