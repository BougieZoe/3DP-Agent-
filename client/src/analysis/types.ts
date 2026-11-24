/**
 * Core types for the STL analysis pipeline.
 *
 * Design principles:
 * - Every module output includes `confidence: number` (0.0–1.0) and `explanation: string`
 * - All analysis is deterministic and pure where possible
 * - No fabricated values — if a metric cannot be measured, mark confidence=0
 * - Assumptions and limitations are documented inline
 */

// ─── Confidence ────────────────────────────────────────────────────────────────
// Discrete confidence levels to avoid false precision.
// 0.0 = no data / could not compute
// 0.3 = rough estimate, algorithm has known limitations
// 0.6 = reasonable confidence, standard algorithm
// 0.8 = high confidence, well-validated algorithm
// 1.0 = exact (e.g., triangle count from index buffer length)
import { getMachineModel, requireBuildVolume } from '@shared/domain/machine';

export type Confidence = 0.0 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1.0;

export interface AnalysisModuleResult<T> {
  moduleName: string;
  confidence: Confidence;
  durationMs: number;
  result: T;
  explanation: string;
}

export function moduleResult<T>(
  moduleName: string,
  confidence: Confidence,
  durationMs: number,
  result: T,
  explanation: string,
): AnalysisModuleResult<T> {
  return { moduleName, confidence, durationMs, result, explanation };
}

// ─── Topology ──────────────────────────────────────────────────────────────────
// Computed from the index buffer and position buffer of a mesh.
// Does NOT require vertex normals.

export interface MeshEdge {
  /** Sorted vertex indices — always (min, max) */
  a: number;
  b: number;
  /** Number of triangles that share this edge */
  faceCount: number;
  /** Indices of incident triangles */
  triangleIndices: number[];
}

export interface TopologyResult {
  triangleCount: number;
  vertexCount: number;
  edgeCount: number;
  /** Edges shared by exactly 2 triangles (regular manifold edge) */
  manifoldEdgeCount: number;
  /** Edges shared by 1 triangle only (hole/boundary) */
  boundaryEdgeCount: number;
  /** Edges shared by 3+ triangles (non-manifold junction) */
  nonManifoldEdgeCount: number;
  /** Number of disconnected shells (connected components) */
  shellCount: number;
  /** True iff no non-manifold edges exist */
  isManifold: boolean;
  /** All edges with faceCount !== 2 (potential problems) */
  problemEdges: Array<{ a: number; b: number; faceCount: number }>;
}

// ─── Validation ────────────────────────────────────────────────────────────────
// Checks mesh quality. Works on indexed geometry.

export type NormalOrientation =
  | 'consistent_outward'
  | 'consistent_inward'
  | 'mixed'
  | 'unknown';

export interface ValidationResult {
  /** True iff every edge has exactly 2 incident faces */
  isWatertight: boolean;
  /** Number of boundary edges / 2 (each hole has a closed loop of boundary edges) */
  holeCount: number;
  /** Total boundary edges */
  boundaryEdgeCount: number;
  /** Number of faces whose winding order produces inward-facing normals */
  flippedNormalFaceCount: number;
  totalFaceCount: number;
  /** flippedNormalFaceCount / totalFaceCount */
  flippedNormalRatio: number;
  normalOrientation: NormalOrientation;
  /** Faces with area < 1e-10 or collinear vertices */
  degenerateFaceCount: number;
}

// ─── Geometry Metrics ──────────────────────────────────────────────────────────
// Physical measurements. Some are exact (volume from tetrahedralization),
// some are sampled (wall thickness via raycast).

export interface WallThicknessSample {
  position: { x: number; y: number; z: number };
  thickness: number;
  /** How reliable this sample is (0.0 = unreliable, 1.0 = high confidence) */
  confidence: number;
}

export type OverhangSeverity = 'none' | 'moderate' | 'severe';

export interface OverhangMetrics {
  /** Faces whose downward tilt exceeds the overhang threshold */
  faceCount: number;
  totalFaceCount: number;
  /**
   * Area-weighted overhang fraction: sum of overhang triangle areas divided
   * by the total surface area. Physically meaningful — a large overhang face
   * weighs more than a tiny one (unlike a pure face-count ratio).
   */
  ratio: number;
  severity: OverhangSeverity;
  breakdownByAngleDeg: Array<{ minAngle: number; maxAngle: number; faceCount: number }>;
  /** Sum of the areas of overhang faces. */
  overhangAreaMm2: number;
  /** Total surface area. */
  totalAreaMm2: number;
}

export interface MetricsResult {
  /** Exact: sum of signed tetrahedron volumes */
  meshVolumeMm3: number;

  /**
   * Whether `meshVolumeMm3` is a trustworthy deliverable.
   *
   * The signed-tetrahedron sum only equals the enclosed volume when the shell is
   * closed. With a boundary hole the sum silently depends on where the hole
   * sits: `t_openbox` (a 20mm cube missing one face) reports 6666.67mm³ — a
   * plausible-looking number that is wrong, not merely approximate. Anything
   * user-facing or cost-bearing must gate on this flag; the raw value is still
   * computed so geometry-only consumers keep working unchanged.
   *
   * False when the mesh is not watertight, or when the graph has no usable
   * topology at all.
   */
  volumeReliable: boolean;

  /** Exact: half sum of cross product magnitudes */
  surfaceAreaMm2: number;

  boundingBoxVolumeMm3: number;

  boundingBoxDimensionsMm: {
    x: number;
    y: number;
    z: number;
  };

  /** Sampled: raycast-based wall thickness estimates. null if too few rays hit. */
  minWallThicknessMm: number | null;

  avgWallThicknessMm: number | null;

  /** 1st percentile wall thickness — thinnest 1% of samples */
  p1WallThicknessMm: number | null;

  /** 5th percentile wall thickness */
  p5WallThicknessMm: number | null;

  /** 10th percentile wall thickness */
  p10WallThicknessMm: number | null;

  /** Median (50th percentile) wall thickness */
  medianWallThicknessMm: number | null;

  /** Number of samples below 0.8mm thin-wall threshold */
  thinWallCount: number;

  /** Fraction (0.0–1.0) of valid samples below 0.8mm thin-wall threshold (thinWallCount / totalSamples) */
  thinWallPercentage: number;
  /** Ratio 0.0–1.0 of sampled regions below thin-wall threshold (thinWallCount / totalSamples) */
  thinWallRatio: number;

  /** Average confidence across all valid samples (0.0–1.0) */
  averageConfidence: number;

  wallThicknessSamples: WallThicknessSample[];

  thinnestWallSample?: WallThicknessSample | null;

  /**
   * Per-vertex wall thickness (mm), one value per vertex of the position
   * buffer — drives the surface-mapped heatmap overlay. Computed once in the
   * analysis worker so mobile never re-runs the per-vertex pass on the main
   * thread. Absent for very large meshes or legacy cached entries (the heatmap
   * falls back to the sample point cloud).
   */
  wallThicknessMap?: Float32Array;

  overhang: OverhangMetrics;
}

// ─── Bed Fit ───────────────────────────────────────────────────────────────────
// Checks if the model fits on a printer's build plate.
//
// Dimensions are NOT authored here. This table is a projection of
// shared/domain/machine.ts (MACHINE_MODELS) — the single source of truth — so the
// analysis worker and the server can no longer drift apart. Profile ids are
// persisted in analysis records: keep them stable even if a model is renamed.
//
// A model whose dimensions are still unconfirmed (build volume null in the source
// table) cannot be projected here: requireBuildVolume() throws at load time rather
// than letting a fabricated triple reach the bed-fit gate.

function toBedProfile<K extends string>(modelId: K) {
  const model = getMachineModel(modelId);
  const vol = requireBuildVolume(modelId);
  return {
    id: modelId,
    name: model?.name ?? modelId,
    widthMm: vol.x,
    depthMm: vol.y,
    heightMm: vol.z,
  };
}

export const PRINTER_PROFILES = {
  bambu_x1c: toBedProfile('bambu_x1c'),
  prusa_mk4: toBedProfile('prusa_mk4'),
  creality_k1: toBedProfile('creality_k1'),
  ender_3: toBedProfile('ender_3'),
  fgf_1800_pro: toBedProfile('fgf_1800_pro'),
  fgf_1200: toBedProfile('fgf_1200'),
};

export type PrinterProfileId = keyof typeof PRINTER_PROFILES;

export interface PrinterBedProfile {
  id: PrinterProfileId;
  name: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export interface BedFitResult {
  fits: boolean;
  printerProfile: PrinterBedProfile;
  /** Model dimensions after applying optimal rotation */
  modelDimensionsMm: { x: number; y: number; z: number };
  /** Clearance on each axis after fitting */
  clearanceMm: { x: number; y: number; z: number };
  /** The best orientation found */
  bestOrientation: { x: number; y: number; z: number };
  /** Additional viable orientations */
  orientations: Array<{ rotation: { x: number; y: number; z: number }; score: number; reason: string }>;
}

// ─── Support Estimation ────────────────────────────────────────────────────────
// Estimates support material volume and printability difficulty.

export type SupportDifficulty = 'none' | 'easy' | 'moderate' | 'difficult' | 'very_difficult';

export interface SupportRegion {
  faceCount: number;
  centroid: { x: number; y: number; z: number };
  boundingBoxSize: { x: number; y: number; z: number };
  normalizedDirection: { x: number; y: number; z: number };
  avgAngleDeg: number;
  estimatedVolumeMm3: number;
  zRange: { min: number; max: number };
}

export interface SupportResult {
  /** Estimated volume of support structures in mm³ */
  totalSupportVolumeMm3: number;
  /** Number of faces requiring support */
  supportFaceCount: number;
  /** Average overhang angle of supported faces */
  averageOverhangAngleDeg: number;
  difficulty: SupportDifficulty;
  /** Estimated support material weight in grams */ 
  estimatedSupportGrams: number;
  /** Volume breakdown by angle range */
  volumeByAngleDeg: Array<{ range: string; volumeMm3: number; faceCount: number }>;
  /** Contiguous support face regions (clusters) */
  supportRegions: SupportRegion[];
  /** Face count of largest region / supportFaceCount (0–1) */
  largestRegionRatio: number;
  /** Fraction of support faces in top half of model Z (0–1) */
  tallSupportRatio: number;
  /** Z-distribution trend: -1 (bottom-heavy) to +1 (top-heavy), 0 = uniform */
  zGradient: number;
  /** How directional overhang normals are: 0 (uniform spread) to 1 (all same direction) */
  directionality: number;
}

// ─── Print Time ────────────────────────────────────────────────────────────────
// Estimation based on volume, overhang complexity, and printer profile.

/**
 * Ground-truth print metrics parsed from a real slicer's G-code
 * (PrusaSlicer / BambuStudio / OrcaSlicer via server/slicerBridge). When
 * present, `estimatePrintTime` uses these instead of the volumetric proxy —
 * see `PrintTimeResult.source`.
 */
export interface SlicerBackedMetrics {
  /** Which slicer produced the G-code, e.g. 'prusaslicer' | 'bambustudio' | 'orca'. */
  slicerId: string;
  /** Exact print time parsed from the G-code header (minutes). */
  printTimeMinutes: number;
  /** Filament consumed (grams), parsed from the G-code. */
  filamentGrams: number;
  /** Layer count from `;LAYER:n` markers. */
  layerCount: number;
  /** Slicer-reported layer height, if available. */
  layerHeightMm: number | null;
}

export interface PrintTimeResult {
  estimatedPrintTimeMinutes: number;
  estimatedPrintTimeHours: number;
  materialWeightGrams: number;
  materialCostUsd: number;
  totalCostUsd: number;
  layerCount: number;
  printerProfile: PrinterBedProfile;
  /** Provenance: 'slicer' = parsed from real G-code; 'estimate' = volumetric proxy. */
  source?: 'estimate' | 'slicer';
  /** Set when source === 'slicer'. */
  slicerId?: string;
}

// ─── Unified Analysis ─────────────────────────────────────────────────────────
// Top-level result combining all modules.

/**
 * A pipeline module that did not produce a real result.
 *
 * `placeholder: true` means the module returned a zero-filled placeholder
 * (confidence 0) that is renderable but meaningless; `false` means the module
 * was skipped entirely and its slot is null. The distinction matters to the UI:
 * "0.000 mm" and "not measured" must never look the same.
 */
export interface ModuleError {
  module: string;
  /** Localized, already user-facing (built with the pipeline's language). */
  message: string;
  placeholder: boolean;
}

export interface UnifiedAnalysis {
  topology: AnalysisModuleResult<TopologyResult>;
  validation: AnalysisModuleResult<ValidationResult>;
  metrics: AnalysisModuleResult<MetricsResult>;
  /**
   * Scale / unit sentinel — ported from the Python engine's `scale_guard`.
   * Read-only: flags implausible extents (oversize, inch/cm misread) and never
   * auto-rescales. Null when the model has no usable extents.
   */
  scaleGuard?: AnalysisModuleResult<import('./scaleGuard').ScaleGuardResult> | null;
  bedFit: AnalysisModuleResult<BedFitResult> | null;
  support: AnalysisModuleResult<SupportResult> | null;
  printTime: AnalysisModuleResult<PrintTimeResult> | null;
  /** Present only when the analysis ran with materialFamily === 'resin'. */
  resin?: AnalysisModuleResult<import('./resin').ResinResult> | null;
  /** Present only when the analysis ran with materialFamily === 'fgf'. */
  fgf?: AnalysisModuleResult<import('./fgf').FgfResult> | null;
  /** Present only when the analysis ran with materialFamily sls/slm/mjf (powder bed fusion). */
  pbf?: AnalysisModuleResult<import('./pbf').PbfResult> | null;
  /** Present only when the analysis ran with materialFamily === 'concrete'. */
  concrete?: AnalysisModuleResult<import('./concrete').ConcreteResult> | null;
  /** Present only when the analysis ran with materialFamily === 'eco'. */
  eco?: AnalysisModuleResult<import('./eco').EcoResult> | null;
  /** Circularity (prevent / reuse / end) — present when a material is specified. */
  loop?: AnalysisModuleResult<import('./loop').LoopResult> | null;
  /** Thermal field & warping analysis — present when material has thermal properties. */
  thermal?: AnalysisModuleResult<import('./thermal').ThermalFieldResult> | null;
  /** Metal printing analysis — present when materialFamily === 'slm'. */
  metal?: AnalysisModuleResult<import('./metalAnalysis').MetalAnalysisResult> | null;
  /** Multi-material analysis — present when secondaryMaterial or fiberReinforced is specified. */
  multiMaterial?: AnalysisModuleResult<import('./multiMaterial').MultiMaterialAnalysisResult> | null;
  /** AI suggestions — always present when material is specified. */
  aiSuggestions?: AnalysisModuleResult<import('./aiSuggestions').AISuggestionResult> | null;
  /** On-device ML analysis — present when ML models are loaded. */
  mlAnalysis?: AnalysisModuleResult<{
    wallThickness: { minWidth: number; maxWidth: number; avgWidth: number; thinVertices: number } | null;
    overhang: { maxAngle: number; overhangArea: number; faceCount: number } | null;
    printTime: { printTime: number; filamentLength: number; layerCount: number } | null;
    modelsLoaded: { wallThickness: boolean; overhang: boolean; printTime: boolean };
  }> | null;
  /**
   * Which topology profile judged this model, plus the evidence that selected
   * it. Recorded so a report can justify the choice rather than assert it, and
   * so a verdict can be replayed against the same profile later.
   */
  topologyProfile?: import('./topologyProfiles').TopologyProfileSelection | null;
  /**
   * Quad edge-flow quality.
   *
   * Present only when the resolved profile declares `criteria: 'quad-flow'` —
   * absent means "not measured", which is deliberately distinct from a zero
   * measurement. `applicable: false` means the reconstruction ran but the
   * triangle data could not support a trustworthy flow reading.
   */
  quadFlow?: import('./quadFlow').QuadFlowResult | null;
  /** ISO timestamp of when analysis was run */
  timestamp: string;
  modelFileName: string;
  /** Minimum confidence across all modules that ran successfully */
  overallConfidence: Confidence;
  /**
   * Modules that threw. Absent when every module completed. Consumers must
   * treat a placeholder module's numbers as unknown, not as zero.
   */
  errors?: ModuleError[];
  /**
   * Per-module (and wall-thickness sub-module) wall-clock durations, populated
   * only when the pipeline is run with `enableProfiling: true`.
   */
  profiling?: Record<string, number>;
}

// ─── Structured Report ────────────────────────────────────────────────────────
// Normalized report format for structured analysis output.
// Sits between raw UnifiedAnalysis and rendered text/PDF.

export type FindingSeverity = 'critical' | 'warning' | 'info';
export type FindingCategory = 'geometry' | 'printability' | 'failure' | 'thermal' | 'cost' | 'environmental';
export type RecommendationPriority = 'high' | 'medium' | 'low';
export type RecommendationCategory = 'design' | 'material' | 'process' | 'orientation' | 'support';
export type EffortLevel = 'easy' | 'moderate' | 'difficult';

export interface ReportMetadata {
  fileName: string;
  material: string;
  printerProfile: string;
  technologyFamily: string;
  analysisDate: string;
  analysisMode: 'rules' | 'llm' | 'hybrid';
  mlModelsAvailable: boolean;
}

export interface Evidence {
  type: 'metric' | 'threshold' | 'comparison' | 'image';
  label: string;
  value: number | string;
  unit: string;
  threshold?: number;
  status: 'pass' | 'warning' | 'fail';
}

export interface Finding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence: Evidence[];
  impact: string;
  moduleSource: string;
  confidence: number;
}

export interface Recommendation {
  id: string;
  priority: RecommendationPriority;
  category: RecommendationCategory;
  title: string;
  description: string;
  expectedImpact: string;
  effort: EffortLevel;
  relatedFindings: string[];
}

export interface CostBreakdown {
  materialCostUsd: number;
  printTimeCostUsd: number;
  supportCostUsd: number;
  postProcessingCostUsd: number;
  totalCostUsd: number;
  failureRiskCostUsd: number;
  expectedTotalCostUsd: number;
  /**
   * Ledger with per-line provenance. The numeric mirrors above are convenience
   * values; anything listed in `unpricedKeys` was never priced and must not be
   * displayed as a real $0.
   */
  ledger?: import('@shared/domain/costLedger').CostLedger;
  /** Cost lines the analysis could not price (absent input, not zero cost). */
  unpricedKeys?: import('@shared/domain/costLedger').CostLineKey[];
  /** True when failure risk had no probability to multiply with. */
  failureRiskUnpriced?: boolean;
  /** True only when every cost line was priced. */
  isComplete?: boolean;
  /** Provenance per cost line, for UI badges. */
  provenance?: Record<string, import('@shared/domain/costLedger').CostProvenance>;
}

export interface ConfidenceBreakdown {
  geometryAnalysis: number;
  printabilityAssessment: number;
  failurePrediction: number;
  thermalAnalysis: number;
  mlInference: number;
  overall: number;
}

export interface ActionItem {
  id: string;
  order: number;
  action: string;
  reason: string;
  estimatedTime: string;
  dependencies: string[];
}

export interface ExecutiveSummary {
  overallScore: number;
  verdict: 'pass' | 'warning' | 'fail';
  keyIssues: Finding[];
  quickWins: Recommendation[];
  estimatedCost: number;
  estimatedPrintTime: number;
  /** True when every cost line was priced. When false, `estimatedCost` is a floor. */
  costIsComplete?: boolean;
  /** Cost lines that could not be priced; their absence is not a $0 saving. */
  unpricedCostKeys?: string[];
}

export interface StructuredReport {
  metadata: ReportMetadata;
  executiveSummary: ExecutiveSummary;
  findings: Finding[];
  recommendations: Recommendation[];
  costBreakdown: CostBreakdown;
  confidenceBreakdown: ConfidenceBreakdown;
  actionItems: ActionItem[];
}
