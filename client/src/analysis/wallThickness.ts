import { type Confidence, type WallThicknessSample } from './types';

const THIN_WALL_THRESHOLD_MM = 0.8;
const LOW_CONFIDENCE_THRESHOLD = 0.3;

/**
 * Ray budget = bounding-box diagonal × this factor.
 *
 * The longest interior chord of a part is bounded by its bounding-box
 * diagonal, so a ray cast along an inward normal can always reach a back
 * surface when one exists. The previous hardcoded `maxRayDist = 20` silently
 * discarded every sample on parts whose interior chord exceeded it (e.g. any
 * solid thicker than 20 mm), which forced the report layer to substitute a
 * bounding-box heuristic for a real measurement. The factor (>1) tolerates
 * numerically off-axis rays without admitting a ray past the geometry.
 */
export const MAX_RAY_DIST_DIAGONAL_FACTOR = 1.05;

function boundingBoxDiagonal(positions: Float32Array): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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

/**
 * Wall-thickness confidence. Returns 0.0 — never a fabricated number — when the
 * raycast could not produce a valid measurement (no opposing faces found).
 */
export function computeWallConfidence(
  minThickness: number | null,
  p5Thickness: number | null,
  thinWallCount: number,
  thinWallRatio: number,
  averageConfidence: number,
  lowConfidenceSampleCount: number,
  sampleCount: number,
): Confidence {
  if (minThickness === null || sampleCount === 0) return 0.0 as Confidence;

  let confidence = averageConfidence;

  const lowConfRatio = sampleCount > 0 ? lowConfidenceSampleCount / sampleCount : 0;
  confidence *= (1 - lowConfRatio * 0.4);

  if (thinWallRatio > 0.25) {
    confidence *= 0.5;
  } else if (thinWallRatio > 0.1) {
    confidence *= 0.75;
  } else if (thinWallRatio > 0.02) {
    confidence *= 0.9;
  }

  const clamped = Math.max(0.1, Math.min(0.95, confidence));
  const levels = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  return levels.reduce((a, b) =>
    Math.abs(b - clamped) < Math.abs(a - clamped) ? b : a
  ) as Confidence;
}

export function deriveWtStatus(thinWallRatio: number, p5WallThickness?: number | null): 'good' | 'warning' | 'critical' {
  if (thinWallRatio > 0.15) return 'critical';
  if (thinWallRatio > 0.05) return 'warning';
  if (p5WallThickness != null && p5WallThickness < 0.4) return 'warning';
  return 'good';
}

export function sampleWallThickness(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  maxSamples: number = 200,
  maxRayDist?: number,
): {
  samples: WallThicknessSample[];
  minThickness: number | null;
  avgThickness: number | null;
  p1Thickness: number | null;
  p5Thickness: number | null;
  p10Thickness: number | null;
  medianThickness: number | null;
  thinWallCount: number;
  thinWallRatio: number;
  thinWallPercentage: number;
  averageConfidence: number;
  lowConfidenceSampleCount: number;
} {
  const triCount = Math.floor(indices.length / 3);
  const samples: WallThicknessSample[] = [];

  if (triCount < 4) {
    return { samples, minThickness: null, avgThickness: null, p1Thickness: null, p5Thickness: null, p10Thickness: null, medianThickness: null, thinWallCount: 0, thinWallRatio: 0, thinWallPercentage: 0, averageConfidence: 0, lowConfidenceSampleCount: 0 };
  }

  // Scale-aware ray budget (see MAX_RAY_DIST_DIAGONAL_FACTOR). Callers that
  // already computed the bounding box pass the diagonal-derived value to avoid
  // a redundant scan; standalone callers derive it from the positions.
  const rayLimit = maxRayDist ?? boundingBoxDiagonal(positions) * MAX_RAY_DIST_DIAGONAL_FACTOR;

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

    let minDist = rayLimit;
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
      thickness: minDist < rayLimit ? minDist : 0,
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
  const thinWallRatio = validSamples.length > 0 ? (thinWallCount / validSamples.length) : 0;
  const thinWallPercentage = thinWallRatio * 100;

  const averageConfidence = validSamples.length > 0
    ? validSamples.reduce((sum, s) => sum + s.confidence, 0) / validSamples.length
    : 0;
  const lowConfidenceSampleCount = validSamples.filter(s => s.confidence < LOW_CONFIDENCE_THRESHOLD).length;

  return { samples, minThickness, avgThickness, p1Thickness, p5Thickness, p10Thickness, medianThickness, thinWallCount, thinWallRatio, thinWallPercentage, averageConfidence, lowConfidenceSampleCount };
}
