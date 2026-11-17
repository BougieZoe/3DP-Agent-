/**
 * Analysis Record — the traceable manufacturing-intelligence unit (Phase 1).
 *
 * Links: Model → Analysis → Evidence → Decision → Recommended action → Outcome.
 *
 * Design rules (do not relax these):
 *  - Missing manufacturing context is `null`, never a fabricated default.
 *  - A model fingerprint (SHA-256 of the uploaded bytes) identifies a model for
 *    comparison and dedup. It does NOT anonymize it.
 *  - Findings are classified by epistemic kind so measured facts, rule-based
 *    assessments, context-dependent inferences, and unverified hypotheses are
 *    never conflated. An LLM/agent explanation is never measured evidence.
 *  - Outcomes start as 'not_tested'. Unknown/untested is never success.
 *  - Confidence values are source-reported (rule constants or LLM-reported),
 *    not statistically calibrated. Consumers must not present them as such.
 *
 * Persistence lives in analysisHistory.ts (IndexedDB, local-only). Nothing in
 * this module performs network I/O.
 */

import type {
  UnifiedAnalysis,
  Finding,
  FindingSeverity,
} from '@/analysis/types';
import { extractFindings } from '@/analysis/findingExtractor';
import { RULES_VERSION } from './auditTrail';
import { getTrafficLight } from '@/components/reportUtils';
import { buildDecisionBundle } from './decisionRecord';

// ── Schema version ───────────────────────────────────────────────────────────

/** Bump when the stored record shape changes incompatibly. */
export const ANALYSIS_RECORD_SCHEMA_VERSION = 3;

// ── Finding epistemic kinds ─────────────────────────────────────────────────

/**
 * A. measured — direct geometric measurement (dimensions, watertightness,
 *    wall-thickness statistics, overhang geometry).
 * B. rule_assessment — a measured condition violates a configured threshold.
 * C. engineering_inference — context-dependent prediction (warping, failure,
 *    cost/time estimates, family-specific process risks, ML inference).
 * D. unverified_hypothesis — LLM/agent-sourced explanation that has not been
 *    confirmed by a physical print or reliable historical evidence.
 */
export type FindingKind =
  | 'measured'
  | 'rule_assessment'
  | 'engineering_inference'
  | 'unverified_hypothesis';

/**
 * Deterministic module findings whose output is a measurement or a direct
 * threshold check over a measurement.
 */
const RULE_ASSESSMENT_MODULES = new Set([
  'validation',
  'topology',
  'metrics',
  'scaleGuard',
  'bedFit',
  'support',
]);

/** Findings produced by an LLM or agent consensus — never treated as evidence. */
const HYPOTHESIS_MODULES = new Set([
  'llm',
  'agent',
  'agents',
  'advisor',
  'orchestrator',
  'diagnosis',
  'aiSuggestions',
]);

/**
 * Everything else the pipeline emits (thermal, metal, printTime, resin, fgf,
 * pbf, concrete, eco, loop, mlAnalysis, …) is a context-dependent inference:
 * it only holds under particular material/machine/process assumptions.
 */
export function classifyFindingKind(finding: Finding): FindingKind {
  const src = finding.moduleSource;
  if (HYPOTHESIS_MODULES.has(src)) return 'unverified_hypothesis';
  if (RULE_ASSESSMENT_MODULES.has(src)) return 'rule_assessment';
  return 'engineering_inference';
}

/** How a finding's conclusion could be verified, when that is well-defined. */
const VERIFICATION_BY_KIND: Record<FindingKind, string | null> = {
  measured: 're-measure on the unmodified source mesh',
  rule_assessment: 'adjust geometry/settings and re-run analysis',
  engineering_inference: 'physical print under the stated material/machine/settings',
  unverified_hypothesis: 'physical print or reviewed historical outcome; LLM agreement is not verification',
};

export interface RecordedFinding extends Finding {
  kind: FindingKind;
  /** How this conclusion could be verified; null when not well-defined. */
  verification: string | null;
}

// ── Record shape ─────────────────────────────────────────────────────────────

export type ModelFormat = 'stl' | 'obj' | '3mf' | 'step' | 'unknown';

/** Manufacturing context. Every field is null when not provided — never guessed. */
export interface ManufacturingContext {
  material: string | null;
  materialFamily: string | null;
  printerId: string | null;
  layerHeightMm: number | null;
  process: string | null;
}

/** Measured geometry facts (kind A). Null when the module could not compute them. */
export interface GeometrySummary {
  dimensionsMm: { x: number; y: number; z: number } | null;
  volumeMm3: number | null;
  /** False means volumeMm3 is computed but NOT trustworthy (open shell). */
  volumeReliable: boolean | null;
  surfaceAreaMm2: number | null;
  isWatertight: boolean | null;
  holeCount: number | null;
  minWallThicknessMm: number | null;
  p5WallThicknessMm: number | null;
  thinWallRatio: number | null;
  overhangRatio: number | null;
}

export type OutcomeStatus =
  | 'not_tested'
  | 'success'
  | 'partial'
  | 'failure'
  | 'unknown';

/** Structured failure categories. Free-text detail still lives in notes. */
export const FAILURE_TYPES = [
  'warping',
  'layer_adhesion',
  'layer_shift',
  'stringing',
  'under_extrusion',
  'over_extrusion',
  'clog',
  'dimensional_accuracy',
  'surface_finish',
  'other',
] as const;

export type FailureType = (typeof FAILURE_TYPES)[number];

export interface OutcomeRecord {
  status: OutcomeStatus;
  recordedAt: string | null;
  /**
   * Layer number where the failure was observed (1-based), or null when the
   * user did not report one. Never inferred from a photo or a prediction.
   */
  failureLayer: number | null;
  /** Observed failure category, or null when unreported/unknown. */
  failureType: FailureType | null;
  /** Observed failure free-text mode, when the print failed or partially succeeded. */
  failureMode: string | null;
  /** Actual settings used, when they differed from the analyzed assumptions. */
  actualSettings: string | null;
  /** Material waste / rework / labor notes. */
  notes: string | null;
}

export interface EngineerDecision {
  decidedAt: string;
  /** Free-text decision, e.g. "print as-is", "thicken walls first". */
  decision: string;
  rationale: string | null;
}

export interface SlicerProvenance {
  source: 'slicer' | 'estimate';
  slicerId: string | null;
  printTimeMinutes: number | null;
  layerCount: number | null;
}

export interface RepairLink {
  /**
   * Record id of the analysis this one was repaired/modified from.
   * Null when the pre-repair run was never recorded (e.g. cache-hit upload)
   * — the comparison below is still valid; only the link is unknown.
   */
  derivedFromRecordId: string | null;
  note: string;
  /** Measured + inferred comparison against the pre-repair analysis. */
  comparison: AnalysisComparison;
}

export interface AnalysisRecord {
  schemaVersion: number;
  /** Stable id of THIS analysis run (not of the model). */
  id: string;
  createdAt: string;
  model: {
    fileName: string;
    /** SHA-256 hex of the uploaded file bytes. Identification, not confidentiality. */
    fileHash: string;
    format: ModelFormat;
    units: string | null;
    fileSizeBytes: number | null;
  };
  context: ManufacturingContext;
  analyzer: {
    /** Deduction-table version from auditTrail (RULES_VERSION). */
    rulesVersion: number;
    /**
     * Hash of the threshold config that produced the score, and the gate-relevant
     * input fingerprint. Both are copied from the decision bundle at build time
     * so an outcome can be tied to the exact rule set even after thresholds move.
     */
    thresholdsHash: string | null;
    inputHash: string | null;
  };
  geometry: GeometrySummary;
  findings: RecordedFinding[];
  score: { value: number; light: string; rulesVersion: number };
  /** Source-reported confidence (min across modules). Not calibrated. */
  overallConfidence: number;
  slicer: SlicerProvenance | null;
  repair: RepairLink | null;
  decision: EngineerDecision | null;
  outcome: OutcomeRecord;
}

// ── Builder ─────────────────────────────────────────────────────────────────

export interface BuildRecordInput {
  analysis: UnifiedAnalysis;
  fileName: string;
  /** SHA-256 hex of the file bytes. Required — identity is meaningless without it. */
  fileHash: string;
  fileSizeBytes?: number | null;
  units?: string | null;
  context?: Partial<ManufacturingContext>;
  slicer?: SlicerProvenance | null;
  repair?: { derivedFromRecordId: string | null; note: string; before: UnifiedAnalysis } | null;
  /** Injectable for tests; defaults to crypto.randomUUID / current time. */
  id?: string;
  createdAt?: string;
}

export function detectModelFormat(fileName: string): ModelFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.stl')) return 'stl';
  if (lower.endsWith('.obj')) return 'obj';
  if (lower.endsWith('.3mf')) return '3mf';
  if (lower.endsWith('.step') || lower.endsWith('.stp')) return 'step';
  return 'unknown';
}

function newRecordId(): string {
  // crypto.randomUUID is available in all supported browsers and Node ≥ 19.
  return crypto.randomUUID();
}

export function buildAnalysisRecord(input: BuildRecordInput): AnalysisRecord {
  const { analysis } = input;
  const m = analysis.metrics?.result ?? null;
  const v = analysis.validation?.result ?? null;
  const { light, score } = getTrafficLight(analysis);
  const decisionBundle = buildDecisionBundle(analysis);

  const findings: RecordedFinding[] = extractFindings(analysis).map((f) => {
    const kind = classifyFindingKind(f);
    return { ...f, kind, verification: VERIFICATION_BY_KIND[kind] };
  });

  const ctx = input.context ?? {};

  const record: AnalysisRecord = {
    schemaVersion: ANALYSIS_RECORD_SCHEMA_VERSION,
    id: input.id ?? newRecordId(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    model: {
      fileName: input.fileName,
      fileHash: input.fileHash,
      format: detectModelFormat(input.fileName),
      units: input.units ?? null,
      fileSizeBytes: input.fileSizeBytes ?? null,
    },
    context: {
      material: ctx.material ?? null,
      materialFamily: ctx.materialFamily ?? null,
      printerId: ctx.printerId ?? null,
      layerHeightMm: ctx.layerHeightMm ?? null,
      process: ctx.process ?? null,
    },
    analyzer: {
      rulesVersion: RULES_VERSION,
      thresholdsHash: decisionBundle.thresholdsHash,
      inputHash: decisionBundle.inputHash,
    },
    geometry: {
      dimensionsMm: m ? { ...m.boundingBoxDimensionsMm } : null,
      volumeMm3: m ? m.meshVolumeMm3 : null,
      volumeReliable: m ? m.volumeReliable : null,
      surfaceAreaMm2: m ? m.surfaceAreaMm2 : null,
      isWatertight: v ? v.isWatertight : null,
      holeCount: v ? v.holeCount : null,
      minWallThicknessMm: m?.minWallThicknessMm ?? null,
      p5WallThicknessMm: m?.p5WallThicknessMm ?? null,
      thinWallRatio: m?.thinWallRatio ?? null,
      overhangRatio: m ? m.overhang.ratio : null,
    },
    findings,
    score: { value: score, light, rulesVersion: RULES_VERSION },
    overallConfidence: analysis.overallConfidence,
    slicer: input.slicer ?? null,
    repair: input.repair
      ? {
          derivedFromRecordId: input.repair.derivedFromRecordId,
          note: input.repair.note,
          comparison: compareAnalyses(input.repair.before, analysis),
        }
      : null,
    decision: null,
    outcome: {
      status: 'not_tested',
      recordedAt: null,
      failureLayer: null,
      failureType: null,
      failureMode: null,
      actualSettings: null,
      notes: null,
    },
  };
  return record;
}

/** Two records describe the same model when their content fingerprints match. */
export function sameModel(a: AnalysisRecord, b: AnalysisRecord): boolean {
  return a.model.fileHash === b.model.fileHash;
}

// ── Before/after comparison ──────────────────────────────────────────────────

export interface MetricDelta {
  before: number | null;
  after: number | null;
  /** after - before; null when either side is unknown. */
  delta: number | null;
}

function delta(before: number | null, after: number | null): MetricDelta {
  return {
    before,
    after,
    delta: before !== null && after !== null ? after - before : null,
  };
}

export interface AnalysisComparison {
  /**
   * Measured geometric changes (kind A/B only). These are facts about the two
   * meshes, computed by the same deterministic pipeline.
   */
  measured: {
    dimensionsMm: { x: MetricDelta; y: MetricDelta; z: MetricDelta } | null;
    volumeMm3: MetricDelta;
    volumeReliableAfter: boolean | null;
    surfaceAreaMm2: MetricDelta;
    isWatertight: { before: boolean | null; after: boolean | null };
    holeCount: MetricDelta;
    minWallThicknessMm: MetricDelta;
    overhangRatio: MetricDelta;
  };
  /**
   * Inferred/predicted changes (kind C): heuristic score and finding sets.
   * A better score is a prediction, NOT evidence of manufacturing success.
   */
  inferred: {
    scoreBefore: number;
    scoreAfter: number;
    scoreDelta: number;
    findingsResolved: string[];
    findingsNew: string[];
    criticalBefore: number;
    criticalAfter: number;
  };
  /**
   * Verdict on the GEOMETRY ONLY: did the mesh itself get more valid/printable
   * by measured criteria. Says nothing about physical print outcomes.
   */
  geometricChange: 'improved' | 'regressed' | 'unchanged' | 'unknown';
  /** Explicit claim boundary, surfaced to consumers verbatim. */
  claimBoundary: string;
}

export const COMPARISON_CLAIM_BOUNDARY =
  'Measured changes describe the mesh only. Predicted printability improvement ' +
  'is a heuristic estimate, not evidence of manufacturing success. No physical ' +
  'print result is implied unless an outcome was explicitly recorded.';

export function compareAnalyses(
  before: UnifiedAnalysis,
  after: UnifiedAnalysis,
): AnalysisComparison {
  const bm = before.metrics?.result ?? null;
  const am = after.metrics?.result ?? null;
  const bv = before.validation?.result ?? null;
  const av = after.validation?.result ?? null;

  const beforeFindings = extractFindings(before);
  const afterFindings = extractFindings(after);
  const afterIds = new Set(afterFindings.map((f) => f.id));
  const beforeIds = new Set(beforeFindings.map((f) => f.id));

  const beforeScore = getTrafficLight(before).score;
  const afterScore = getTrafficLight(after).score;
  const countCritical = (fs: Finding[]) =>
    fs.filter((f) => f.severity === ('critical' as FindingSeverity)).length;

  // Geometric verdict from measured facts only.
  let geometricChange: AnalysisComparison['geometricChange'] = 'unknown';
  if (bv && av) {
    const holesFixed = bv.holeCount > av.holeCount;
    const holesAdded = bv.holeCount < av.holeCount;
    const watertightFixed = !bv.isWatertight && av.isWatertight;
    const watertightBroken = bv.isWatertight && !av.isWatertight;
    const wallsThinner =
      bm?.minWallThicknessMm != null &&
      am?.minWallThicknessMm != null &&
      am.minWallThicknessMm < bm.minWallThicknessMm;
    if (watertightBroken || holesAdded || wallsThinner) geometricChange = 'regressed';
    else if (watertightFixed || holesFixed) geometricChange = 'improved';
    else geometricChange = 'unchanged';
  }

  return {
    measured: {
      dimensionsMm:
        bm && am
          ? {
              x: delta(bm.boundingBoxDimensionsMm.x, am.boundingBoxDimensionsMm.x),
              y: delta(bm.boundingBoxDimensionsMm.y, am.boundingBoxDimensionsMm.y),
              z: delta(bm.boundingBoxDimensionsMm.z, am.boundingBoxDimensionsMm.z),
            }
          : null,
      volumeMm3: delta(bm?.meshVolumeMm3 ?? null, am?.meshVolumeMm3 ?? null),
      volumeReliableAfter: am?.volumeReliable ?? null,
      surfaceAreaMm2: delta(bm?.surfaceAreaMm2 ?? null, am?.surfaceAreaMm2 ?? null),
      isWatertight: {
        before: bv?.isWatertight ?? null,
        after: av?.isWatertight ?? null,
      },
      holeCount: delta(bv?.holeCount ?? null, av?.holeCount ?? null),
      minWallThicknessMm: delta(
        bm?.minWallThicknessMm ?? null,
        am?.minWallThicknessMm ?? null,
      ),
      overhangRatio: delta(bm?.overhang.ratio ?? null, am?.overhang.ratio ?? null),
    },
    inferred: {
      scoreBefore: beforeScore,
      scoreAfter: afterScore,
      scoreDelta: afterScore - beforeScore,
      findingsResolved: beforeFindings.filter((f) => !afterIds.has(f.id)).map((f) => f.id),
      findingsNew: afterFindings.filter((f) => !beforeIds.has(f.id)).map((f) => f.id),
      criticalBefore: countCritical(beforeFindings),
      criticalAfter: countCritical(afterFindings),
    },
    geometricChange,
    claimBoundary: COMPARISON_CLAIM_BOUNDARY,
  };
}

// ── Outcome helpers ─────────────────────────────────────────────────────────

/**
 * The ONLY statuses that may be reported as a successful print.
 * 'not_tested', 'unknown', 'partial', and 'failure' are never success.
 */
export function isSuccessfulOutcome(status: OutcomeStatus): boolean {
  return status === 'success';
}

export interface OutcomeSummary {
  total: number;
  tested: number;
  success: number;
  partial: number;
  failure: number;
  /** Records with no real result — excluded from any success rate. */
  notTested: number;
  unknown: number;
  /** success / tested; null when nothing has been tested. */
  successRate: number | null;
}

export function summarizeOutcomes(records: AnalysisRecord[]): OutcomeSummary {
  const s: OutcomeSummary = {
    total: records.length,
    tested: 0,
    success: 0,
    partial: 0,
    failure: 0,
    notTested: 0,
    unknown: 0,
    successRate: null,
  };
  for (const r of records) {
    switch (r.outcome.status) {
      case 'success':
        s.success++;
        s.tested++;
        break;
      case 'partial':
        s.partial++;
        s.tested++;
        break;
      case 'failure':
        s.failure++;
        s.tested++;
        break;
      case 'unknown':
        s.unknown++;
        break;
      case 'not_tested':
        s.notTested++;
        break;
    }
  }
  s.successRate = s.tested > 0 ? s.success / s.tested : null;
  return s;
}

// ── Normalization (legacy / malformed-safe reads) ────────────────────────────

function asObj(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
}

function asStr(x: unknown): string | null {
  return typeof x === 'string' ? x : null;
}

function asNum(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

const OUTCOME_STATUSES: ReadonlySet<string> = new Set([
  'not_tested',
  'success',
  'partial',
  'failure',
  'unknown',
]);

const FAILURE_TYPE_SET: ReadonlySet<string> = new Set(FAILURE_TYPES);

function normalizeFailureLayer(x: unknown): number | null {
  const n = asNum(x);
  return n !== null && Number.isInteger(n) && n >= 1 ? n : null;
}

function normalizeFailureType(x: unknown): FailureType | null {
  const s = asStr(x);
  return s !== null && FAILURE_TYPE_SET.has(s) ? (s as FailureType) : null;
}

function normalizeOutcome(x: unknown): OutcomeRecord {
  const o = asObj(x);
  const status = asStr(o?.status);
  return {
    status: (OUTCOME_STATUSES.has(status ?? '') ? status : 'not_tested') as OutcomeStatus,
    recordedAt: asStr(o?.recordedAt),
    failureLayer: normalizeFailureLayer(o?.failureLayer),
    failureType: normalizeFailureType(o?.failureType),
    failureMode: asStr(o?.failureMode),
    actualSettings: asStr(o?.actualSettings),
    notes: asStr(o?.notes),
  };
}

/**
 * Read a stored record defensively. Returns null when the value is not a
 * usable record at all; otherwise fills missing/unknown fields with honest
 * nulls/defaults. Unknown schema versions are read best-effort (additive
 * fields ignored) rather than rejected.
 */
export function normalizeAnalysisRecord(raw: unknown): AnalysisRecord | null {
  const r = asObj(raw);
  if (!r) return null;
  const model = asObj(r.model);
  if (!model || typeof model.fileHash !== 'string' || model.fileHash.length === 0) {
    return null; // without a fingerprint the record cannot anchor identity
  }
  if (typeof r.id !== 'string' || r.id.length === 0) return null;

  const ctx = asObj(r.context);
  const geo = asObj(r.geometry);
  const score = asObj(r.score);
  const decision = asObj(r.decision);
  const dims = asObj(geo?.dimensionsMm);

  return {
    schemaVersion: asNum(r.schemaVersion) ?? 0, // 0 = pre-versioned legacy
    id: r.id,
    createdAt: asStr(r.createdAt) ?? new Date(0).toISOString(),
    model: {
      fileName: asStr(model.fileName) ?? 'unknown',
      fileHash: model.fileHash,
      format: (asStr(model.format) as ModelFormat) ?? 'unknown',
      units: asStr(model.units),
      fileSizeBytes: asNum(model.fileSizeBytes),
    },
    context: {
      material: asStr(ctx?.material),
      materialFamily: asStr(ctx?.materialFamily),
      printerId: asStr(ctx?.printerId),
      layerHeightMm: asNum(ctx?.layerHeightMm),
      process: asStr(ctx?.process),
    },
    analyzer: {
      rulesVersion: asNum(asObj(r.analyzer)?.rulesVersion) ?? 0,
      thresholdsHash: asStr(asObj(r.analyzer)?.thresholdsHash),
      inputHash: asStr(asObj(r.analyzer)?.inputHash),
    },
    geometry: {
      dimensionsMm:
        dims && asNum(dims.x) !== null && asNum(dims.y) !== null && asNum(dims.z) !== null
          ? { x: asNum(dims.x)!, y: asNum(dims.y)!, z: asNum(dims.z)! }
          : null,
      volumeMm3: asNum(geo?.volumeMm3),
      volumeReliable: typeof geo?.volumeReliable === 'boolean' ? geo.volumeReliable : null,
      surfaceAreaMm2: asNum(geo?.surfaceAreaMm2),
      isWatertight: typeof geo?.isWatertight === 'boolean' ? geo.isWatertight : null,
      holeCount: asNum(geo?.holeCount),
      minWallThicknessMm: asNum(geo?.minWallThicknessMm),
      p5WallThicknessMm: asNum(geo?.p5WallThicknessMm),
      thinWallRatio: asNum(geo?.thinWallRatio),
      overhangRatio: asNum(geo?.overhangRatio),
    },
    findings: Array.isArray(r.findings) ? (r.findings as RecordedFinding[]) : [],
    score: {
      value: asNum(score?.value) ?? 0,
      light: asStr(score?.light) ?? 'unknown',
      rulesVersion: asNum(score?.rulesVersion) ?? 0,
    },
    overallConfidence: asNum(r.overallConfidence) ?? 0,
    slicer: (r.slicer as SlicerProvenance | null) ?? null,
    repair: (r.repair as RepairLink | null) ?? null,
    decision:
      decision && asStr(decision.decision) && asStr(decision.decidedAt)
        ? {
            decidedAt: asStr(decision.decidedAt)!,
            decision: asStr(decision.decision)!,
            rationale: asStr(decision.rationale),
          }
        : null,
    outcome: normalizeOutcome(r.outcome),
  };
}
