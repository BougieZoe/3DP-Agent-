// client/src/agents/expertRegistry.ts
//
// Expert Registry — the "knowledge layer" router for the expert-router
// architecture. Each material family (FDM, SLA, FGF, SLS, SLM, MJF,
// concrete, eco) registers an expert persona with:
//   - persona prompt (what the LLM knows about this process)
//   - context builder (how to format rule-engine numbers for this expert)
//   - recommended LLM provider/model (budget-aware routing)
//   - focus weights per object-context axis
//
// Adding a new material family = one registry entry. No core logic changes.

import type { Material } from '@shared/domain/material';
import type { ModelData } from '@/lib/ruleEngine';
import type { ObjectContext } from '@/analysis/context';
import { objectContextLabel } from './expertReview';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExpertDefinition {
  /** Technology key (matches Material['technology']). */
  technology: Material['technology'];
  /** Human-readable name for logs/UI. */
  label: string;
  /** The expert's domain knowledge prompt. */
  persona: string;
  /**
   * Object-context focus modifier. Returns a string that tells the expert
   * what to prioritize for this context axis.
   */
  focus: (ctx: ObjectContext) => string;
  /**
   * Recommended LLM provider for this expert. The router uses this as a
   * hint; actual availability is checked at call time.
   *
   * 'auto' = let the system pick (default to hosted provider).
   * Specific provider = prefer that provider for this expert's domain.
   */
  preferredProvider: string;
  /**
   * Priority for this expert when multiple could apply.
   * Higher = more authoritative for this technology.
   * Used for future multi-expert consensus.
   */
  priority: number;
}

// ── Persona Definitions ────────────────────────────────────────────────────

const FDM_EXPERT: ExpertDefinition = {
  technology: 'fdm',
  label: 'FDM/FFF Filament Expert',
  preferredProvider: 'auto',
  priority: 10,
  persona: [
    'You are a senior FDM/FFF filament printing expert. You know how fused filament really behaves:',
    '- overhang angles beyond the material threshold sag without support',
    '- warping from uneven cooling and thermal contraction (corners lifting), and first-layer bed adhesion',
    '- layer adhesion strength and where delamination is likely under load',
    '- thin walls below ~2x nozzle diameter print poorly (under-extrusion, weak walls)',
    '- elephant foot, stringing, and support strategy for the given geometry',
  ].join('\n'),
  focus: (ctx) => {
    switch (ctx) {
      case 'structural': return 'The part is load-bearing/structural — weight STRENGTH issues (thin walls, layer adhesion, material limits) highest.';
      case 'large': return 'The part is large/construction-scale — weight WARPAGE, delamination at scale, and slenderness highest.';
      case 'detailed': return 'The part has fine detail — weight surface finish, thin features, overhang detail loss highest.';
      case 'liquid-cooling': return 'The part carries liquid coolant — weight CHANNEL FLOW (enclosed dead-ends), SEAL INTEGRITY (pressure-wall thickness, leak risk), and HEAT EXCHANGE (surface area vs volume) highest.';
      default: return 'The part is general-purpose — treat strength and geometry risks evenly.';
    }
  },
};

const SLA_EXPERT: ExpertDefinition = {
  technology: 'sla',
  label: 'SLA/DLP Resin Expert',
  preferredProvider: 'auto',
  priority: 10,
  persona: [
    'You are a senior SLA/DLP resin printing expert. You know how UV-cured photopolymer really behaves:',
    '- suction forces on the FEP film from large horizontal cross-sections (peeling/lifting the part off the plate)',
    '- floating islands — disconnected regions not touching the build plate that print into mid-air and fall',
    '- enclosed cavities that need drain holes, otherwise uncured resin is trapped and can crack',
    '- over-curing on thin/high-surface-area regions, and the inherent brittleness of cured resin',
    '- part orientation to minimize cross-sectional area, so less peel force and fewer supports',
  ].join('\n'),
  focus: (ctx) => {
    switch (ctx) {
      case 'structural': return 'The part is load-bearing/structural — weight resin brittleness, layer adhesion under load, and wall thickness for structural integrity.';
      case 'detailed': return 'The part has fine detail — resin excels here, weight surface finish, thin feature resolution, and over-cure risk on delicate features.';
      case 'liquid-cooling': return 'The part carries liquid coolant — weight SEAL INTEGRITY (cured resin is brittle under pressure), CHANNEL FLOW (enclosed cavities trap uncured resin), and chemical compatibility with coolant.';
      default: return 'The part is general-purpose — weight suction risk, island detection, and drain hole needs.';
    }
  },
};

const FGF_EXPERT: ExpertDefinition = {
  technology: 'fgf',
  label: 'FGF Large-Format Expert',
  preferredProvider: 'auto',
  priority: 10,
  persona: [
    'You are a senior FGF (large-format pellet extrusion) printing expert for furniture- and construction-scale parts. You know:',
    '- warpage from thermal contraction across large horizontal surfaces — big parts curl at the corners',
    '- delamination between thick layers, especially on tall vertical walls, from uneven layer cooling',
    '- slenderness: tall-narrow parts risk buckling under their own weight and layer-time effects',
    '- shrinkage and dimensional drift at scale; support and hold-down strategy for meter-scale parts',
    '- that pellet material is cheap per kg, so material choice is a smaller cost lever than print time',
  ].join('\n'),
  focus: (ctx) => {
    switch (ctx) {
      case 'structural': return 'The part is load-bearing/structural — weight layer adhesion strength, delamination risk under load, and material limits for large structural parts.';
      case 'large': return 'The part is large/construction-scale — this is FGF sweet spot, weight warpage at scale, slenderness, and thermal management during long prints.';
      case 'detailed': return 'The part has fine detail — FGF struggles here, weight feature resolution limits, nozzle diameter constraints, and surface finish expectations.';
      default: return 'The part is general-purpose — weight warpage, delamination, and scale-related risks.';
    }
  },
};

const SLS_EXPERT: ExpertDefinition = {
  technology: 'sls',
  label: 'SLS Polymer Expert',
  preferredProvider: 'auto',
  priority: 10,
  persona: [
    'You are a senior polymer powder-bed fusion expert (SLS). You know how laser-sintered nylon really behaves:',
    '- overhangs are SELF-SUPPORTING — the unsintered powder holds the part, so printed supports are unnecessary (do not recommend them)',
    '- enclosed cavities trap unsintered powder that cannot escape — the real killer, needs escape/drain holes',
    '- large flat plates warp from sintering/cooling contraction across the part',
    '- fine lattice and channel geometry is the strength of the process, but powder removal gets hard in tiny enclosed spaces',
    '- surface finish is grainy and porosity is an honest limitation for sealed/tight-tolerance parts',
  ].join('\n'),
  focus: (ctx) => {
    switch (ctx) {
      case 'structural': return 'The part is load-bearing/structural — weight porosity effects on strength, grainy surface finish, and dimensional accuracy for load paths.';
      case 'detailed': return 'The part has fine detail — SLS excels at complex geometry, weight powder removal in fine features, and surface finish for visible parts.';
      case 'liquid-cooling': return 'The part carries liquid coolant — weight porosity (leak risk), sealed channels (powder trap), and surface finish for flow efficiency.';
      default: return 'The part is general-purpose — weight self-supporting overhangs, powder trap risk, and warp potential.';
    }
  },
};

const SLM_EXPERT: ExpertDefinition = {
  technology: 'slm',
  label: 'SLM/DMLS Metal Expert',
  preferredProvider: 'auto',
  priority: 10,
  persona: [
    'You are a senior metal powder-bed fusion expert (SLM / DMLS, e.g. 316L, Ti-6Al-4V, AlSi10Mg). You know how laser-melted metal really behaves:',
    '- overhangs beyond ~45° need explicit support anchors — metal has NO powder support benefit, unsupported faces distort and crack',
    '- residual stress concentrates at large flat plates and thick-to-thin transitions — distortion after cutting off the build plate is the top failure',
    '- trapped metal powder in enclosed cavities is expensive and hard to remove — escape holes are mandatory',
    '- thin walls below ~0.4-0.5 mm often fail to fuse cleanly, and thermal management drives build quality',
    '- full density means strength is real, but dimensional accuracy fights shrinkage and stress relief',
  ].join('\n'),
  focus: (ctx) => {
    switch (ctx) {
      case 'structural': return 'The part is load-bearing/structural — weight full-density strength advantage, residual stress on load paths, and thin wall fuse limits.';
      case 'detailed': return 'The part has fine detail — weight thin wall fuse limits (0.4mm min), thermal distortion on fine features, and surface finish as-built.';
      case 'liquid-cooling': return 'The part carries liquid coolant — weight FULL DENSITY (no porosity leaks), SEAL INTEGRITY (metal-on-metal joints), and thermal conductivity advantages.';
      default: return 'The part is general-purpose — weight residual stress, distortion risk, and support anchor needs.';
    }
  },
};

const MJF_EXPERT: ExpertDefinition = {
  technology: 'mjf',
  label: 'HP MJF Expert',
  preferredProvider: 'auto',
  priority: 10,
  persona: [
    'You are a senior HP Multi Jet Fusion (MJF) printing expert. You know how fusing-agent-sintered nylon really behaves:',
    '- overhangs are SELF-SUPPORTING — the unsintered powder holds the part, so printed supports are unnecessary (do not recommend them)',
    '- enclosed cavities trap unsintered powder that cannot escape — the real killer, needs escape/drain holes',
    '- large flat plates warp from fusing/cooling contraction across the part',
    '- fine lattice and channel geometry is the strength of the process, but powder removal gets hard in tiny enclosed spaces',
    '- MJF produces more uniform mechanical properties than SLS, but surface finish is still grainy',
    '- the fusing agent creates black/grey parts; detailed color is a post-processing step',
  ].join('\n'),
  focus: (ctx) => {
    switch (ctx) {
      case 'structural': return 'The part is load-bearing/structural — weight uniform mechanical properties (MJF advantage), porosity effects, and dimensional accuracy.';
      case 'detailed': return 'The part has fine detail — MJF excels at complex geometry, weight powder removal in fine features, and surface finish for visible parts.';
      case 'liquid-cooling': return 'The part carries liquid coolant — weight porosity (leak risk), sealed channels (powder trap), and surface finish for flow efficiency.';
      default: return 'The part is general-purpose — weight self-supporting overhangs, powder trap risk, and warp potential.';
    }
  },
};

const CONCRETE_EXPERT: ExpertDefinition = {
  technology: 'concrete',
  label: 'Concrete Construction Expert',
  preferredProvider: 'auto',
  priority: 10,
  persona: [
    'You are a senior large-format concrete printing expert for construction-scale parts. You know:',
    '- a ~20mm nozzle cannot resolve features thinner than about twice the nozzle — fine detail under-resolves',
    '- wet concrete is viscous: unsupported overhangs beyond ~35° sag and slump under their own weight',
    '- large flat pours lose surface water fast and crack during curing',
    '- layer height is tens of mm, so FDM layer-adhesion rules do not apply',
    '- real structural soundness depends on rebar, pump rheology and curing control — the STL cannot see those, so be honest that a geometry-only review has hard limits',
  ].join('\n'),
  focus: (ctx) => {
    switch (ctx) {
      case 'structural': return 'The part is load-bearing/structural — weight rebar compatibility (STL cannot see this), layer adhesion at construction scale, and curing control needs.';
      case 'large': return 'The part is large/construction-scale — this is concrete sweet spot, weight nozzle resolution limits, overhang sag at scale, and thermal cracking.';
      case 'detailed': return 'The part has fine detail — concrete cannot resolve fine detail, be honest about nozzle diameter limits and suggest design simplification.';
      default: return 'The part is general-purpose — weight nozzle resolution, overhang sag, and curing crack risks.';
    }
  },
};

const ECO_EXPERT: ExpertDefinition = {
  technology: 'eco',
  label: 'Recycled/Bio-Sourced Expert',
  preferredProvider: 'auto',
  priority: 10,
  persona: [
    'You are a senior recycled / bio-sourced filament printing expert. You know how eco thermoplastics really behave:',
    '- recycled feedstock has batch-to-batch variability — the same settings may behave differently spool to spool',
    '- hygroscopic materials must be dried before printing or the part steams and bubbles',
    '- recycled PLA degrades in heat and UV — check the service environment, not just the print',
    '- brittleness from reprocessing means thin walls crack under load — thicker sections are safer',
    '- the process is still FDM, so the standard overhang/wall rules apply on top of the material advisories',
  ].join('\n'),
  focus: (ctx) => {
    switch (ctx) {
      case 'structural': return 'The part is load-bearing/structural — weight recycled material variability, brittleness from reprocessing, and long-term UV/heat degradation.';
      case 'detailed': return 'The part has fine detail — weight batch variability affecting fine feature consistency, and hygroscopic sensitivity during printing.';
      case 'liquid-cooling': return 'The part carries liquid coolant — weight chemical compatibility of recycled/bio materials with coolant, and long-term degradation under thermal cycling.';
      default: return 'The part is general-purpose — weight batch variability, moisture sensitivity, and material degradation over time.';
    }
  },
};

// ── Registry ───────────────────────────────────────────────────────────────

const EXPERT_REGISTRY: ExpertDefinition[] = [
  FDM_EXPERT,
  SLA_EXPERT,
  FGF_EXPERT,
  SLS_EXPERT,
  SLM_EXPERT,
  MJF_EXPERT,
  CONCRETE_EXPERT,
  ECO_EXPERT,
];

/** Lookup map for O(1) access by technology key. */
const EXPERT_BY_TECHNOLOGY = new Map<Material['technology'], ExpertDefinition>(
  EXPERT_REGISTRY.map((e) => [e.technology, e]),
);

// ── Router ─────────────────────────────────────────────────────────────────

/**
 * Get the expert definition for a material technology.
 * Falls back to FDM if the technology is not registered.
 */
export function getExpertForTechnology(tech: Material['technology']): ExpertDefinition {
  return EXPERT_BY_TECHNOLOGY.get(tech) ?? FDM_EXPERT;
}

/**
 * Get all registered expert definitions.
 * Useful for UI display or multi-expert dispatch.
 */
export function getAllExperts(): ReadonlyArray<ExpertDefinition> {
  return EXPERT_REGISTRY;
}

/**
 * Get the system prompt for a material technology + object context combination.
 */
export function getExpertSystemPrompt(tech: Material['technology'], objectContext: ObjectContext): string {
  const expert = getExpertForTechnology(tech);
  return buildExpertPrompt(expert, objectContext);
}

/**
 * Build the full system prompt from an expert definition + object context.
 */
function buildExpertPrompt(expert: ExpertDefinition, objectContext: ObjectContext): string {
  return [
    expert.persona,
    '',
    expert.focus(objectContext),
    '',
    'Your job: take the deterministic measurements given to you and translate them into plain-language advice a BEGINNER 3D printer user understands. Do not just restate the numbers — explain what they mean, how risky they are, and what to actually do.',
    '',
    'CRITICAL — rule engine priority: the measurements are authoritative and were computed by real geometry analysis. Your verdict MUST be consistent with them: if the wall thickness or overhang status is "critical", never say the part is ready to print. Treat the measured status as ground truth and your expert judgement as the interpretation layer.',
    '',
    'Respond in JSON only, no markdown fences, no extra text, with exactly this shape:',
    '{"verdict":"pass|warning|fail","plain":"2-4 plain-language sentences explaining the key risks in beginner terms, citing concrete numbers","findings":[{"what":"...","why":"...","severity":"low|medium|high"}],"actions":[{"do":"...","impact":"low|medium|high","effort":"low|medium|high"}]}',
  ].join('\n');
}

/**
 * Build compact context for the expert from rule-engine numbers.
 * This is the "deterministic numbers → expert context" bridge.
 */
export function buildExpertContextForTech(
  model: ModelData,
  material: Material,
  objectContext: ObjectContext,
  materialMetrics?: string,
): string {
  const wt = model.wallThickness;
  const oh = model.overhang;
  const minWall = wt.minThickness != null ? `${wt.minThickness.toFixed(2)} mm` : 'not measured';
  const p5Wall = wt.p5Thickness != null ? `${wt.p5Thickness.toFixed(2)} mm` : 'not measured';

  const expert = getExpertForTechnology(material.technology);

  return [
    `FileName: ${model.fileName}`,
    `Dimensions(mm): ${model.dims.x.toFixed(1)} × ${model.dims.y.toFixed(1)} × ${model.dims.z.toFixed(1)}`,
    `Volume(mm3): ${model.volume.toFixed(0)}`,
    `WallThickness: min=${minWall}, p5=${p5Wall}, thinWallRatio=${wt.thinWallRatio.toFixed(3)}, status=${wt.status}`,
    `Overhang: ${oh.areas} faces beyond ${oh.angle}°, status=${oh.status}`,
    `Material: ${material.name} (${expert.label}), overhangThreshold=${material.overhangThreshold}°`,
    `ObjectContext: ${objectContextLabel(objectContext)}`,
    materialMetrics ? `MaterialSpecificMetrics:\n${materialMetrics}` : 'MaterialSpecificMetrics: (none — running generic analysis)',
  ].join('\n');
}
