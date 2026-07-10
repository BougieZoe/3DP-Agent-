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
  /** Faces where normal angle from vertical exceeds 45° */
  faceCount: number;
  totalFaceCount: number;
  ratio: number;
  severity: OverhangSeverity;
  breakdownByAngleDeg: Array<{ minAngle: number; maxAngle: number; faceCount: number }>;
}

export interface MetricsResult {
  /** Exact: sum of signed tetrahedron volumes */
  meshVolumeMm3: number;

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

  /** Number of valid samples with confidence < 0.3 */
  lowConfidenceSampleCount: number;

  wallThicknessSamples: WallThicknessSample[];

  thinnestWallSample?: WallThicknessSample | null;

  overhang: OverhangMetrics;
}

// ─── Bed Fit ───────────────────────────────────────────────────────────────────
// Checks if the model fits on a printer's build plate.

export const PRINTER_PROFILES = {
  bambu_x1c: { id: 'bambu_x1c', name: 'Bambu Lab X1C', widthMm: 256, depthMm: 256, heightMm: 256 },
  prusa_mk4: { id: 'prusa_mk4', name: 'Prusa MK4', widthMm: 250, depthMm: 210, heightMm: 220 },
  creality_k1: { id: 'creality_k1', name: 'Creality K1', widthMm: 220, depthMm: 220, heightMm: 250 },
  ender_3: { id: 'ender_3', name: 'Ender 3', widthMm: 220, depthMm: 220, heightMm: 250 },
} as const;

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
}

// ─── Print Time ────────────────────────────────────────────────────────────────
// Estimation based on volume, overhang complexity, and printer profile.

export interface PrintTimeResult {
  estimatedPrintTimeMinutes: number;
  estimatedPrintTimeHours: number;
  materialWeightGrams: number;
  materialCostUsd: number;
  totalCostUsd: number;
  layerCount: number;
  printerProfile: PrinterBedProfile;
}

// ─── Unified Analysis ─────────────────────────────────────────────────────────
// Top-level result combining all modules.

export interface UnifiedAnalysis {
  topology: AnalysisModuleResult<TopologyResult>;
  validation: AnalysisModuleResult<ValidationResult>;
  metrics: AnalysisModuleResult<MetricsResult>;
  bedFit: AnalysisModuleResult<BedFitResult> | null;
  support: AnalysisModuleResult<SupportResult> | null;
  printTime: AnalysisModuleResult<PrintTimeResult> | null;
  /** ISO timestamp of when analysis was run */
  timestamp: string;
  modelFileName: string;
  /** Minimum confidence across all modules that ran successfully */
  overallConfidence: Confidence;
}
