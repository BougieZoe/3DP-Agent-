import {
  moduleResult,
  type AnalysisModuleResult,
  type Confidence,
  type MetricsResult,
  type OverhangMetrics,
  type SupportResult,
  type WallThicknessSample,
} from './types';
import { buildGeometryGraph, type GeometryGraph } from './geometryGraph';
import { type GeometryModel } from './geometryModel';

const THIN_WALL_THRESHOLD_MM = 0.8;
const LOW_CONFIDENCE_THRESHOLD = 0.3;
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

export function analyzeOverhang(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  overhangThresholdDeg: number = 50,
): OverhangMetrics {
  const totalFaceCount = Math.floor(indices.length / 3);
  const bucketCounts = OVERHANG_ANGLE_BUCKETS.map(() => 0);
  let overhangCount = 0;

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;

    const ux = positions[i1] - positions[i0];
    const uy = positions[i1 + 1] - positions[i0 + 1];
    const uz = positions[i1 + 2] - positions[i0 + 2];
    const vx = positions[i2] - positions[i0];
    const vy = positions[i2 + 1] - positions[i0 + 1];
    const vz = positions[i2 + 2] - positions[i0 + 2];

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

    if (len < 1e-12) continue;

    const cosAngle = Math.abs(ny) / len;
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);

    for (let b = 0; b < OVERHANG_ANGLE_BUCKETS.length; b++) {
      const bucket = OVERHANG_ANGLE_BUCKETS[b];
      if (angleDeg >= bucket.minAngle && angleDeg < bucket.maxAngle) {
        bucketCounts[b]++;
        break;
      }
    }

    if (angleDeg > overhangThresholdDeg) {
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

/**
 * Derive wall thickness status from thin-wall ratio and p5 thickness.
 *
 * Thresholds (FDM empirical):
 * - thinWallRatio > 0.15 → critical (widespread thin walls)
 * - thinWallRatio > 0.05 → warning  (moderate thin wall presence)
 * - p5WallThickness < 0.4 → warning (critical thin spots even if few)
 * - else               → good
 */
export function deriveWtStatus(thinWallRatio: number, p5WallThickness?: number | null): 'good' | 'warning' | 'critical' {
  if (thinWallRatio > 0.15) return 'critical';
  if (thinWallRatio > 0.05) return 'warning';
  if (p5WallThickness != null && p5WallThickness < 0.4) return 'warning';
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const frac = index - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

export function sampleWallThickness(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  maxSamples: number = 200,
): {
  samples: WallThicknessSample[];
  minThickness: number | null;
  avgThickness: number | null;
  p1Thickness: number | null;
  p5Thickness: number | null;
  p10Thickness: number | null;
  medianThickness: number | null;
  thinWallCount: number;
  /** Ratio 0.0–1.0 of samples below thin-wall threshold */
  thinWallRatio: number;
  /** Percentage 0–100 (backward compat) */
  thinWallPercentage: number;
  averageConfidence: number;
  lowConfidenceSampleCount: number;
} {
  const triCount = Math.floor(indices.length / 3);
  const samples: WallThicknessSample[] = [];

  if (triCount < 4) {
    return { samples, minThickness: null, avgThickness: null, p1Thickness: null, p5Thickness: null, p10Thickness: null, medianThickness: null, thinWallCount: 0, thinWallRatio: 0, thinWallPercentage: 0, averageConfidence: 0, lowConfidenceSampleCount: 0 };
  }

  const step = Math.max(1, Math.floor(triCount / maxSamples));

  for (let i = 0; i < indices.length && samples.length < maxSamples; i += step * 3) {
    const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;

    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    const fcx = (ax + bx + cx) / 3;
    const fcy = (ay + by + cy) / 3;
    const fcz = (az + bz + cz) / 3;

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) continue;

    const invNx = -nx / len, invNy = -ny / len, invNz = -nz / len;

    const maxRayDist = 20;
    let minDist = maxRayDist;
    let hitCount = 0;

    for (let j = 0; j < indices.length; j += 3) {
      if (j === i) continue;

      const j0 = indices[j] * 3, j1 = indices[j + 1] * 3, j2 = indices[j + 2] * 3;

      const t = rayTriangleIntersection(
        { x: fcx, y: fcy, z: fcz },
        { x: invNx, y: invNy, z: invNz },
        { x: positions[j0], y: positions[j0 + 1], z: positions[j0 + 2] },
        { x: positions[j1], y: positions[j1 + 1], z: positions[j1 + 2] },
        { x: positions[j2], y: positions[j2 + 1], z: positions[j2 + 2] },
      );

      if (t !== null && t > 0.01 && t < minDist) {
        minDist = t;
        hitCount++;
      }
    }

    const confidence = hitCount > 0
      ? Math.min(0.8, 0.3 + hitCount * 0.1) as Confidence
      : 0.1 as Confidence;

    samples.push({
      position: { x: fcx, y: fcy, z: fcz },
      thickness: minDist < maxRayDist ? minDist : 0,
      confidence,
    });
  }

  const validSamples = samples.filter(s => s.thickness > 0 && s.confidence > 0.1);
  const minThickness = validSamples.length > 0
    ? Math.min(...validSamples.map(s => s.thickness))
    : null;
  const avgThickness = validSamples.length > 0
    ? validSamples.reduce((sum, s) => sum + s.thickness, 0) / validSamples.length
    : null;

  const sorted = validSamples.map(s => s.thickness).sort((a, b) => a - b);
  const p1Thickness = validSamples.length > 0 ? percentile(sorted, 0.01) : null;
  const p5Thickness = validSamples.length > 0 ? percentile(sorted, 0.05) : null;
  const p10Thickness = validSamples.length > 0 ? percentile(sorted, 0.10) : null;
  const medianThickness = validSamples.length > 0 ? percentile(sorted, 0.50) : null;

  const thinWallCount = validSamples.filter(s => s.thickness < THIN_WALL_THRESHOLD_MM).length;
  /** thinWallRatio = fraction 0.0–1.0 of sampled regions below thin-wall threshold */
  const thinWallRatio = validSamples.length > 0 ? (thinWallCount / validSamples.length) : 0;
  /** thinWallPercentage = percentage 0–100 (for backward compatibility) */
  const thinWallPercentage = thinWallRatio * 100;

  const averageConfidence = validSamples.length > 0
    ? validSamples.reduce((sum, s) => sum + s.confidence, 0) / validSamples.length
    : 0;
  const lowConfidenceSampleCount = validSamples.filter(s => s.confidence < LOW_CONFIDENCE_THRESHOLD).length;

  return { samples, minThickness, avgThickness, p1Thickness, p5Thickness, p10Thickness, medianThickness, thinWallCount, thinWallRatio, thinWallPercentage, averageConfidence, lowConfidenceSampleCount };
}

function rayTriangleIntersection(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  v0: { x: number; y: number; z: number },
  v1: { x: number; y: number; z: number },
  v2: { x: number; y: number; z: number },
): number | null {
  const EPS = 1e-8;

  const edge1x = v1.x - v0.x, edge1y = v1.y - v0.y, edge1z = v1.z - v0.z;
  const edge2x = v2.x - v0.x, edge2y = v2.y - v0.y, edge2z = v2.z - v0.z;

  const hx = dir.y * edge2z - dir.z * edge2y;
  const hy = dir.z * edge2x - dir.x * edge2z;
  const hz = dir.x * edge2y - dir.y * edge2x;

  const a = edge1x * hx + edge1y * hy + edge1z * hz;
  if (Math.abs(a) < EPS) return null;

  const f = 1.0 / a;
  const sx = origin.x - v0.x, sy = origin.y - v0.y, sz = origin.z - v0.z;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return null;

  const qx = sy * edge1z - sz * edge1y;
  const qy = sz * edge1x - sx * edge1z;
  const qz = sx * edge1y - sy * edge1x;
  const v = f * (dir.x * qx + dir.y * qy + dir.z * qz);
  if (v < 0 || u + v > 1) return null;

  const t = f * (edge2x * qx + edge2y * qy + edge2z * qz);
  return t >= 0 ? t : null;
}

function computeWallConfidence(
  minThickness: number | null,
  p5Thickness: number | null,
  thinWallCount: number,
  thinWallRatio: number,
  averageConfidence: number,
  lowConfidenceSampleCount: number,
  sampleCount: number,
): Confidence {
  if (minThickness === null || sampleCount === 0) return 0.1 as Confidence;

  // Base = average per-sample raycast confidence
  let confidence = averageConfidence;

  // Penalize for many low-confidence individual samples
  const lowConfRatio = sampleCount > 0 ? lowConfidenceSampleCount / sampleCount : 0;
  confidence *= (1 - lowConfRatio * 0.4);

  // Reduce confidence when thin walls are widespread (not isolated anomalies)
  if (thinWallRatio > 0.25) {
    confidence *= 0.5;
  } else if (thinWallRatio > 0.1) {
    confidence *= 0.75;
  } else if (thinWallRatio > 0.02) {
    confidence *= 0.9;
  }

  // Clamp and snap to nearest valid Confidence level
  const clamped = Math.max(0.1, Math.min(0.95, confidence));
  const levels = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  return levels.reduce((a, b) =>
    Math.abs(b - clamped) < Math.abs(a - clamped) ? b : a
  ) as Confidence;
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
  const triCount = g.triangleCount;
  const bbox = g.boundingBox;

  const dimX = bbox.maxX - bbox.minX;
  const dimY = bbox.maxY - bbox.minY;
  const dimZ = bbox.maxZ - bbox.minZ;

  const meshVolume = computeMeshVolume(positions, indices);
  const surfaceArea = computeSurfaceArea(positions, indices);
  const overhang = analyzeOverhang(positions, indices, overhangThresholdDeg);
  const { samples, minThickness, avgThickness, p1Thickness, p5Thickness, p10Thickness, medianThickness, thinWallCount, thinWallRatio, thinWallPercentage, averageConfidence, lowConfidenceSampleCount } = sampleWallThickness(positions, indices);

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
