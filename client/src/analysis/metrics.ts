import {
  moduleResult,
  type AnalysisModuleResult,
  type Confidence,
  type MetricsResult,
  type OverhangMetrics,
  type SupportResult,
} from './types';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import { buildGeometryGraph, type GeometryGraph } from './geometryGraph';
import { type GeometryModel } from './geometryModel';
import { getThresholds, type AnalysisThresholds } from './thresholds';
import {
  computeWallConfidence,
  deriveWtStatus,
  sampleWallThickness,
} from './wallThickness';
import { computeSurfaceWallThickness } from './surfaceThickness';

// Re-export so existing importers of '@/analysis/metrics' keep working while the
// implementation lives in the canonical wallThickness module.
export { deriveWtStatus, sampleWallThickness } from './wallThickness';

export function computeMeshVolume(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
): number {
  let volume = 0;

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;

    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;

    volume += (uy * vz - uz * vy) * ax;
    volume += (uz * vx - ux * vz) * ay;
    volume += (ux * vy - uy * vx) * az;
  }

  return Math.abs(volume) / 6;
}

export function computeSurfaceArea(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
): number {
  let area = 0;

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;

    const ux = positions[i1] - positions[i0];
    const uy = positions[i1 + 1] - positions[i0 + 1];
    const uz = positions[i1 + 2] - positions[i0 + 2];
    const vx = positions[i2] - positions[i0];
    const vy = positions[i2 + 1] - positions[i0 + 1];
    const vz = positions[i2 + 2] - positions[i0 + 2];

    const crossX = uy * vz - uz * vy;
    const crossY = uz * vx - ux * vz;
    const crossZ = ux * vy - uy * vx;

    area += Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
  }

  return area / 2;
}

/**
 * How far a face's normal points below horizontal, in degrees (0 = vertical
 * wall, 90 = horizontal ceiling). Returns null for any face that is not a
 * downward-facing overhang candidate — faces whose normal points up (nz > 0)
 * or horizontal (nz === 0, i.e. walls and flat tops) never need support.
 *
 * Build axis is Z (slicer convention). This sign-aware, axis-correct test
 * replaces the old `Math.abs(normal.y)` measure, which flagged every vertical
 * wall and flat top on Z-up models as an overhang.
 */
export function overhangTiltBelowHorizontalDeg(nz: number, len: number): number | null {
  if (nz >= 0 || len < 1e-12) return null;
  const cosVertical = Math.max(-1, Math.min(1, nz / len));
  const angleFromVerticalDeg = Math.acos(cosVertical) * (180 / Math.PI); // (90, 180]
  return angleFromVerticalDeg - 90; // (0, 90]
}

/**
 * Whether a face centroid rests on the build-plate plane. Faces touching the
 * bed are supported by the bed itself (slicer convention) and must not count
 * as overhangs — a solid box sitting on the plate has zero overhang faces.
 */
export function isOnBuildPlate(centroidZ: number, minZ: number, modelHeight: number): boolean {
  const eps = Math.max(1e-4, modelHeight * 1e-3);
  return centroidZ <= minZ + eps;
}

export function analyzeOverhang(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  overhangThresholdDeg?: number,
  thresholds: AnalysisThresholds = getThresholds(),
): OverhangMetrics {
  const overhangConfig = thresholds.overhang;
  const thresholdDeg = overhangThresholdDeg ?? thresholds.overhangThresholdDeg;
  const buckets = overhangConfig.bucketsDeg;
  const totalFaceCount = Math.floor(indices.length / 3);
  const bucketCounts = buckets.map(() => 0);
  let overhangCount = 0;
  let overhangAreaMm2 = 0;
  let totalAreaMm2 = 0;

  // Build-plate plane (lowest vertex Z) and model height, for bed-contact exclusion.
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const z = positions[i + 2];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (minZ === Infinity) minZ = 0;
  if (maxZ === -Infinity) maxZ = minZ;
  const modelHeight = Math.max(1e-6, maxZ - minZ);

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;

    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) continue;

    const area = len / 2;
    totalAreaMm2 += area;

    const tiltDeg = overhangTiltBelowHorizontalDeg(nz, len);
    if (tiltDeg === null) continue;

    // A face resting on the build plate is supported by the bed, not by supports.
    const centroidZ = (az + bz + cz) / 3;
    if (isOnBuildPlate(centroidZ, minZ, modelHeight)) continue;

    for (let b = 0; b < buckets.length; b++) {
      const bucket = buckets[b];
      if (tiltDeg >= bucket.minAngle && tiltDeg < bucket.maxAngle) {
        bucketCounts[b]++;
        break;
      }
    }

    if (tiltDeg > thresholdDeg) {
      overhangCount++;
      overhangAreaMm2 += area;
    }
  }

  // Area-weighted overhang fraction: a large overhang face weighs more than a
  // tiny one. (Face-count ratio under-reported small-but-critical regions and
  // over-reported many tiny faces.)
  const ratio = totalAreaMm2 > 0 ? overhangAreaMm2 / totalAreaMm2 : 0;

  const severity: OverhangMetrics['severity'] =
    overhangCount === 0 ? 'none' :
    ratio > overhangConfig.severitySevereRatio ? 'severe' : 'moderate';

  const breakdownByAngle = buckets.map((bucket, idx) => ({
    minAngle: bucket.minAngle,
    maxAngle: bucket.maxAngle,
    faceCount: bucketCounts[idx],
  }));

  return { faceCount: overhangCount, totalFaceCount, ratio, severity, breakdownByAngleDeg: breakdownByAngle, overhangAreaMm2, totalAreaMm2 };
}

/**
 * Derive printability status from the AREA-WEIGHTED overhang fraction
 * (overhang surface area / total surface area).
 *
 * Threshold rationale (FDM empirical):
 * - 0–5%   overhang area: negligible — standard supports or orientation handles this.
 * - 5–15%  overhang area: moderate — support strategy matters; evaluate orientation.
 * - >15%   overhang area: critical — model has significant overhang geometry;
 *           mandatory support strategy or redesign needed.
 *
 * These thresholds are intentionally lower than the analysis-layer `severity`
 * (none/moderate/severe at 0.3) because they represent manufacturing risk,
 * not just geometric measurement.
 */
export function deriveOhStatus(ratio: number, thresholds: AnalysisThresholds = getThresholds()): 'good' | 'warning' | 'critical' {
  const status = thresholds.overhang;
  if (ratio > status.statusCriticalRatio) return 'critical';
  if (ratio > status.statusWarningRatio) return 'warning';
  return 'good';
}

export interface SupportStatusResult {
  status: 'good' | 'warning' | 'critical';
  reasons: string[];
  confidence: number;
}

/**
 * Evaluate the full SupportResult and derive a 3-level manufacturing-risk status.
 *
 * Critical triggers:
 *   difficulty === 'very_difficult'
 *   OR largestRegionRatio > 0.5 AND tallSupportRatio > 0.3
 *
 * Warning triggers:
 *   difficulty === 'difficult' or 'moderate'
 *   OR supportRegions.length > 3  (multiple islands)
 *   OR tallSupportRatio > 0.3
 *   OR directionality > 0.7  (directional concentration)
 *
 * Good:
 *   Everything else.
 */
export function deriveSupportStatus(
  result: SupportResult,
  language: ContentLang = 'en',
  thresholds: AnalysisThresholds = getThresholds(),
): SupportStatusResult {
  const derive = thresholds.support.deriveStatus;
  const reasons: string[] = [];

  if (result.difficulty === 'none' || result.supportRegions.length === 0) {
    return { status: 'good', reasons: [translate(CONTENT, 'support.noSupport', language)], confidence: derive.noSupportConfidence };
  }

  // ── Critical evaluation ───────────────────────────────────────────────────
  let isCritical = false;

  if (result.difficulty === 'very_difficult') {
    reasons.push(translate(CONTENT, 'support.veryDifficult', language));
    isCritical = true;
  }

  if (result.largestRegionRatio > derive.criticalLargestRegionRatio && result.tallSupportRatio > derive.criticalTallSupportRatio) {
    reasons.push(translate(CONTENT, 'support.largeIslandRemoval', language));
    isCritical = true;
  }

  if (isCritical) {
    return { status: 'critical', reasons, confidence: derive.criticalConfidence };
  }

  // ── Warning evaluation ────────────────────────────────────────────────────
  if (result.difficulty === 'difficult') {
    reasons.push(translate(CONTENT, 'support.difficult', language));
  }
  if (result.difficulty === 'moderate') {
    reasons.push(translate(CONTENT, 'support.moderate', language));
  }
  if (result.supportRegions.length > derive.warningIslands) {
    reasons.push(translate(CONTENT, 'support.islands', language, { count: result.supportRegions.length }));
  }
  if (result.tallSupportRatio > derive.warningTallSupportRatio) {
    reasons.push(translate(CONTENT, 'support.tallSupports', language, { pct: (result.tallSupportRatio * 100).toFixed(0) }));
  }
  if (result.directionality > derive.warningDirectionality) {
    reasons.push(translate(CONTENT, 'support.directional', language));
  }

  if (reasons.length > 0) {
    const confidence = Math.min(derive.warningConfidenceBase + reasons.length * derive.warningConfidencePerReason, derive.warningConfidenceCap);
    return { status: 'warning', reasons, confidence };
  }

  // ── Good ──────────────────────────────────────────────────────────────────
  reasons.push(translate(CONTENT, 'support.isolated', language));
  return { status: 'good', reasons, confidence: derive.goodConfidence };
}

export function computeMetrics(
  model: GeometryModel,
  graph?: GeometryGraph | null,
  overhangThresholdDeg?: number,
  profiling?: Record<string, number>,
  language: ContentLang = 'en',
  thresholds: AnalysisThresholds = getThresholds(),
): AnalysisModuleResult<MetricsResult> {
  const startTime = performance.now();
  const g = graph ?? buildGeometryGraph(model);

  if (!g) {
    return moduleResult('metrics', 0.0, 0, {
      meshVolumeMm3: 0, surfaceAreaMm2: 0,
      boundingBoxVolumeMm3: 0, boundingBoxDimensionsMm: { x: 0, y: 0, z: 0 },
      minWallThicknessMm: null, avgWallThicknessMm: null,
      p1WallThicknessMm: null, p5WallThicknessMm: null, p10WallThicknessMm: null, medianWallThicknessMm: null,
      thinWallCount: 0, thinWallPercentage: 0, thinWallRatio: 0, averageConfidence: 0,
      wallThicknessSamples: [],
      overhang: { faceCount: 0, totalFaceCount: 0, ratio: 0, severity: 'none', breakdownByAngleDeg: [], overhangAreaMm2: 0, totalAreaMm2: 0 },
    }, translate(CONTENT, 'metrics.noPositionData', language));
  }

  if (g.indices.length === 0) {
    return moduleResult('metrics', 0.5, Math.round(performance.now() - startTime), {
      meshVolumeMm3: 0, surfaceAreaMm2: 0,
      boundingBoxVolumeMm3: 0, boundingBoxDimensionsMm: { x: 0, y: 0, z: 0 },
      minWallThicknessMm: null, avgWallThicknessMm: null,
      p1WallThicknessMm: null, p5WallThicknessMm: null, p10WallThicknessMm: null, medianWallThicknessMm: null,
      thinWallCount: 0, thinWallPercentage: 0, thinWallRatio: 0, averageConfidence: 0,
      wallThicknessSamples: [],
      overhang: { faceCount: 0, totalFaceCount: g.triangleCount, ratio: 0, severity: 'none', breakdownByAngleDeg: [], overhangAreaMm2: 0, totalAreaMm2: 0 },
    }, translate(CONTENT, 'metrics.nonIndexed', language));
  }

  const positions = g.positions;
  const indices = g.indices;
  const dimX = g.boundingBoxDimensions.x;
  const dimY = g.boundingBoxDimensions.y;
  const dimZ = g.boundingBoxDimensions.z;

  const time = <T>(key: string, fn: () => T): T => {
    if (!profiling) return fn();
    const start = performance.now();
    const result = fn();
    profiling[key] = performance.now() - start;
    return result;
  };

  const meshVolume = time('computeMeshVolume', () => computeMeshVolume(positions, indices));
  const surfaceArea = time('computeSurfaceArea', () => computeSurfaceArea(positions, indices));
  const overhang = time('analyzeOverhang', () => analyzeOverhang(positions, indices, overhangThresholdDeg, thresholds));
  // Scale-aware ray budget derived from the model's own bounding box: large
  // parts are measured rather than silently failing the raycast (which used to
  // trigger the report layer's bounding-box substitution).
  const wallThickness = time('sampleWallThickness', () => sampleWallThickness(
    positions, indices, thresholds.wallThickness.maxSamples, undefined, thresholds, g,
  ));
  const { samples, minThickness, avgThickness, p1Thickness, p5Thickness, p10Thickness, medianThickness, thinWallCount, thinWallRatio, thinWallPercentage, averageConfidence } = wallThickness;

  // Surface-mapped per-vertex thickness — computed worker-side so mobile can
  // render the wall-thickness heatmap as a true surface mapping without a
  // main-thread per-vertex pass (which OOMs on large meshes). Same algorithm
  // and constants as the desktop AdvancedWallThickness component, so the
  // numbers match what desktop renders today.
  let wallThicknessMap: Float32Array | undefined;
  try {
    wallThicknessMap = computeSurfaceWallThickness(positions, g.normals, g.vertexCount);
  } catch {
    wallThicknessMap = undefined;
  }

  const wallConfidence = computeWallConfidence(
    minThickness, p5Thickness, thinWallCount, thinWallRatio,
    averageConfidence, samples.length, thresholds,
  );
  const overallConfidence = wallConfidence as Confidence;

  const result: MetricsResult = {
    meshVolumeMm3: meshVolume,
    surfaceAreaMm2: surfaceArea,
    boundingBoxVolumeMm3: dimX * dimY * dimZ,
    boundingBoxDimensionsMm: { x: dimX, y: dimY, z: dimZ },
    minWallThicknessMm: minThickness,
    avgWallThicknessMm: avgThickness,
    p1WallThicknessMm: p1Thickness,
    p5WallThicknessMm: p5Thickness,
    p10WallThicknessMm: p10Thickness,
    medianWallThicknessMm: medianThickness,
    thinWallCount,
    thinWallPercentage,
    thinWallRatio,
    averageConfidence,
    wallThicknessSamples: samples,
    wallThicknessMap,
    overhang,
  };

  const parts: string[] = [];
  parts.push(translate(CONTENT, 'metrics.volume', language, { volume: meshVolume.toFixed(1) }));
  parts.push(translate(CONTENT, 'metrics.surfaceArea', language, { area: surfaceArea.toFixed(1) }));
  parts.push(translate(CONTENT, 'metrics.dimensions', language, { x: dimX.toFixed(1), y: dimY.toFixed(1), z: dimZ.toFixed(1) }));
  if (minThickness !== null) {
    parts.push(translate(CONTENT, 'metrics.minWallSampled', language, { t: minThickness.toFixed(3) }));
  } else {
    parts.push(translate(CONTENT, 'metrics.wallNotSampled', language));
  }
  parts.push(translate(CONTENT, 'metrics.overhangSummary', language, {
    faces: overhang.faceCount,
    total: overhang.totalFaceCount,
    pct: (overhang.ratio * 100).toFixed(1),
  }));

  return moduleResult('metrics', overallConfidence, Math.round(performance.now() - startTime), result, parts.join('. '));
}

export interface VolumeCrossCheckResult {
  /** Whether the two volume values diverge beyond configured thresholds. */
  diverged: boolean;
  /** Absolute difference |server − client| in mm³. */
  absoluteDelta: number;
  /** Relative difference |server − client| / server. NaN when server is 0. */
  relativeDelta: number;
  /** Why the check was skipped (empty string when the check ran). */
  skipped: string;
}

/**
 * Compare server-side (trimesh) and client-side (tetrahedron) volume values.
 *
 * Returns a structured result without side effects — the caller decides
 * whether and how to display it. The check is skipped (diverged=false,
 * skipped=<reason>) when:
 *   - serverVolume is null (trimesh couldn't compute, e.g. non-watertight)
 *   - clientVolume ≤ 0 (client computation failed or degenerate mesh)
 *   - repaired is true (mesh repair changes topology, divergence is expected)
 */
export function checkVolumeCrossConsistency(
  serverVolumeMm3: number | null | undefined,
  clientVolumeMm3: number,
  repaired: boolean,
  thresholds: AnalysisThresholds = getThresholds(),
): VolumeCrossCheckResult {
  const t = thresholds.volumeCrossCheck;
  const noServer = serverVolumeMm3 == null || !Number.isFinite(serverVolumeMm3);
  const noClient = clientVolumeMm3 <= 0 || !Number.isFinite(clientVolumeMm3);

  if (noServer) return { diverged: false, absoluteDelta: 0, relativeDelta: NaN, skipped: 'server volume unavailable' };
  if (noClient) return { diverged: false, absoluteDelta: 0, relativeDelta: NaN, skipped: 'client volume unavailable' };
  if (repaired) return { diverged: false, absoluteDelta: 0, relativeDelta: NaN, skipped: 'mesh was repaired — divergence expected' };

  const abs = Math.abs(serverVolumeMm3 - clientVolumeMm3);
  const rel = serverVolumeMm3 !== 0 ? abs / serverVolumeMm3 : NaN;
  const diverged = abs > t.absoluteThresholdMm3 && (Number.isFinite(rel) ? rel > t.relativeThreshold : true);

  return { diverged, absoluteDelta: abs, relativeDelta: rel, skipped: '' };
}
