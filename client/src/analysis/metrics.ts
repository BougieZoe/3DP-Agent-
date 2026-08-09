import {
  moduleResult,
  type AnalysisModuleResult,
  type Confidence,
  type MetricsResult,
  type OverhangMetrics,
  type SupportResult,
} from './types';
import { buildGeometryGraph, type GeometryGraph } from './geometryGraph';
import { type GeometryModel } from './geometryModel';
import {
  computeWallConfidence,
  deriveWtStatus,
  sampleWallThickness,
  MAX_RAY_DIST_DIAGONAL_FACTOR,
} from './wallThickness';

// Re-export so existing importers of '@/analysis/metrics' keep working while the
// implementation lives in the canonical wallThickness module.
export { deriveWtStatus, sampleWallThickness } from './wallThickness';

const OVERHANG_ANGLE_BUCKETS = [
  { minAngle: 0, maxAngle: 30 },
  { minAngle: 30, maxAngle: 45 },
  { minAngle: 45, maxAngle: 60 },
  { minAngle: 60, maxAngle: 75 },
  { minAngle: 75, maxAngle: 90 },
];

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
  overhangThresholdDeg: number = 50,
): OverhangMetrics {
  const totalFaceCount = Math.floor(indices.length / 3);
  const bucketCounts = OVERHANG_ANGLE_BUCKETS.map(() => 0);
  let overhangCount = 0;

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

    const tiltDeg = overhangTiltBelowHorizontalDeg(nz, len);
    if (tiltDeg === null) continue;

    // A face resting on the build plate is supported by the bed, not by supports.
    const centroidZ = (az + bz + cz) / 3;
    if (isOnBuildPlate(centroidZ, minZ, modelHeight)) continue;

    for (let b = 0; b < OVERHANG_ANGLE_BUCKETS.length; b++) {
      const bucket = OVERHANG_ANGLE_BUCKETS[b];
      if (tiltDeg >= bucket.minAngle && tiltDeg < bucket.maxAngle) {
        bucketCounts[b]++;
        break;
      }
    }

    if (tiltDeg > overhangThresholdDeg) {
      overhangCount++;
    }
  }

  const ratio = totalFaceCount > 0 ? overhangCount / totalFaceCount : 0;

  const severity: OverhangMetrics['severity'] =
    overhangCount === 0 ? 'none' :
    ratio > 0.3 ? 'severe' : 'moderate';

  const breakdownByAngle = OVERHANG_ANGLE_BUCKETS.map((bucket, idx) => ({
    minAngle: bucket.minAngle,
    maxAngle: bucket.maxAngle,
    faceCount: bucketCounts[idx],
  }));

  return { faceCount: overhangCount, totalFaceCount, ratio, severity, breakdownByAngleDeg: breakdownByAngle };
}

/**
 * Derive printability status from overhang-to-total-face ratio.
 *
 * Threshold rationale (FDM empirical):
 * - 0–5%   overhang faces: negligible — standard supports or orientation handles this.
 * - 5–15%  overhang faces: moderate — support strategy matters; evaluate orientation.
 * - >15%   overhang faces: critical — model has significant overhang geometry;
 *           mandatory support strategy or redesign needed.
 *
 * These thresholds are intentionally lower than the analysis-layer `severity`
 * (none/moderate/severe at 0.3) because they represent manufacturing risk,
 * not just geometric measurement.
 */
export function deriveOhStatus(ratio: number): 'good' | 'warning' | 'critical' {
  if (ratio > 0.15) return 'critical';
  if (ratio > 0.05) return 'warning';
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
export function deriveSupportStatus(result: SupportResult): SupportStatusResult {
  const reasons: string[] = [];

  if (result.difficulty === 'none' || result.supportRegions.length === 0) {
    return { status: 'good', reasons: ['No support structures needed'], confidence: 1 };
  }

  // ── Critical evaluation ───────────────────────────────────────────────────
  let isCritical = false;

  if (result.difficulty === 'very_difficult') {
    reasons.push('Very difficult support structure');
    isCritical = true;
  }

  if (result.largestRegionRatio > 0.5 && result.tallSupportRatio > 0.3) {
    reasons.push('Large continuous support island with tall supports — removal risk');
    isCritical = true;
  }

  if (isCritical) {
    return { status: 'critical', reasons, confidence: 0.85 };
  }

  // ── Warning evaluation ────────────────────────────────────────────────────
  if (result.difficulty === 'difficult') {
    reasons.push('Difficult support structure');
  }
  if (result.difficulty === 'moderate') {
    reasons.push('Moderate support complexity');
  }
  if (result.supportRegions.length > 3) {
    reasons.push(`${result.supportRegions.length} separate support islands`);
  }
  if (result.tallSupportRatio > 0.3) {
    reasons.push(`${(result.tallSupportRatio * 100).toFixed(0)}% of support faces in top half — tall supports`);
  }
  if (result.directionality > 0.7) {
    reasons.push('Directionally concentrated supports — consider rotation');
  }

  if (reasons.length > 0) {
    const confidence = Math.min(0.55 + reasons.length * 0.08, 0.85);
    return { status: 'warning', reasons, confidence };
  }

  // ── Good ──────────────────────────────────────────────────────────────────
  reasons.push('Isolated manageable supports');
  return { status: 'good', reasons, confidence: 0.9 };
}

export function computeMetrics(
  model: GeometryModel,
  graph?: GeometryGraph | null,
  overhangThresholdDeg: number = 50,
): AnalysisModuleResult<MetricsResult> {
  const startTime = performance.now();
  const g = graph ?? buildGeometryGraph(model);

  if (!g) {
    return moduleResult('metrics', 0.0, 0, {
      meshVolumeMm3: 0, surfaceAreaMm2: 0,
      boundingBoxVolumeMm3: 0, boundingBoxDimensionsMm: { x: 0, y: 0, z: 0 },
      minWallThicknessMm: null, avgWallThicknessMm: null,
      p1WallThicknessMm: null, p5WallThicknessMm: null, p10WallThicknessMm: null, medianWallThicknessMm: null,
      thinWallCount: 0, thinWallPercentage: 0, thinWallRatio: 0, averageConfidence: 0, lowConfidenceSampleCount: 0,
      wallThicknessSamples: [],
      overhang: { faceCount: 0, totalFaceCount: 0, ratio: 0, severity: 'none', breakdownByAngleDeg: [] },
    }, 'No position data');
  }

  if (g.indices.length === 0) {
    return moduleResult('metrics', 0.5, Math.round(performance.now() - startTime), {
      meshVolumeMm3: 0, surfaceAreaMm2: 0,
      boundingBoxVolumeMm3: 0, boundingBoxDimensionsMm: { x: 0, y: 0, z: 0 },
      minWallThicknessMm: null, avgWallThicknessMm: null,
      p1WallThicknessMm: null, p5WallThicknessMm: null, p10WallThicknessMm: null, medianWallThicknessMm: null,
      thinWallCount: 0, thinWallPercentage: 0, thinWallRatio: 0, averageConfidence: 0, lowConfidenceSampleCount: 0,
      wallThicknessSamples: [],
      overhang: { faceCount: 0, totalFaceCount: g.triangleCount, ratio: 0, severity: 'none', breakdownByAngleDeg: [] },
    }, 'Non-indexed geometry — volume and wall thickness cannot be computed accurately');
  }

  const positions = g.positions;
  const indices = g.indices;
  const bbox = g.boundingBox;

  const dimX = bbox.maxX - bbox.minX;
  const dimY = bbox.maxY - bbox.minY;
  const dimZ = bbox.maxZ - bbox.minZ;
  const bboxDiagonal = Math.sqrt(dimX * dimX + dimY * dimY + dimZ * dimZ);

  const meshVolume = computeMeshVolume(positions, indices);
  const surfaceArea = computeSurfaceArea(positions, indices);
  const overhang = analyzeOverhang(positions, indices, overhangThresholdDeg);
  // Scale-aware ray budget derived from the model's own bounding box: large
  // parts are measured rather than silently failing the raycast (which used to
  // trigger the report layer's bounding-box substitution).
  const { samples, minThickness, avgThickness, p1Thickness, p5Thickness, p10Thickness, medianThickness, thinWallCount, thinWallRatio, thinWallPercentage, averageConfidence, lowConfidenceSampleCount } = sampleWallThickness(
    positions, indices, 200, bboxDiagonal * MAX_RAY_DIST_DIAGONAL_FACTOR,
  );

  const wallConfidence = computeWallConfidence(
    minThickness, p5Thickness, thinWallCount, thinWallRatio,
    averageConfidence, lowConfidenceSampleCount, samples.length,
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
    lowConfidenceSampleCount,
    wallThicknessSamples: samples,
    overhang,
  };

  const parts: string[] = [];
  parts.push(`Volume: ${meshVolume.toFixed(1)} mm³`);
  parts.push(`Surface area: ${surfaceArea.toFixed(1)} mm²`);
  parts.push(`Dimensions: ${dimX.toFixed(1)} × ${dimY.toFixed(1)} × ${dimZ.toFixed(1)} mm`);
  if (minThickness !== null) {
    parts.push(`Min wall thickness (sampled): ${minThickness.toFixed(3)} mm (approximate)`);
  } else {
    parts.push('Wall thickness: could not be sampled (no opposing faces found)');
  }
  parts.push(`Overhang faces: ${overhang.faceCount}/${overhang.totalFaceCount} (${(overhang.ratio * 100).toFixed(1)}%)`);

  return moduleResult('metrics', overallConfidence, Math.round(performance.now() - startTime), result, parts.join('. '));
}
