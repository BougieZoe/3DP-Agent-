import { type Confidence, type WallThicknessSample } from './types';
import { getThresholds, DEFAULT_ANALYSIS_THRESHOLDS, type AnalysisThresholds } from './thresholds';
import { type GeometryGraph } from './geometryGraph';

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
 *
 * Exported for external importers; the value lives in
 * DEFAULT_ANALYSIS_THRESHOLDS.wallThickness.rayDistanceDiagonalFactor.
 */
export const MAX_RAY_DIST_DIAGONAL_FACTOR = DEFAULT_ANALYSIS_THRESHOLDS.wallThickness.rayDistanceDiagonalFactor;

function boundingBoxDiagonal(positions: Float32Array, graph?: GeometryGraph | null): number {
  if (graph) return graph.boundingBoxDiagonal;
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

/**
 * Möller–Trumbore ray-triangle intersection with plain float arguments.
 * The previous version took six {x,y,z} object literals per call — for a
 * 1.5M-triangle model the sampler allocated ~17 billion objects (200 samples
 * × 1.47M faces × 6), which dominated the analysis time and GC pressure on
 * low-end phones. Identical math, zero allocations.
 */
function rayTriangleIntersection(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number | null {
  const EPS = 1e-8;

  const edge1x = bx - ax, edge1y = by - ay, edge1z = bz - az;
  const edge2x = cx - ax, edge2y = cy - ay, edge2z = cz - az;

  const hx = dy * edge2z - dz * edge2y;
  const hy = dz * edge2x - dx * edge2z;
  const hz = dx * edge2y - dy * edge2x;

  const a = edge1x * hx + edge1y * hy + edge1z * hz;
  if (Math.abs(a) < EPS) return null;

  const f = 1.0 / a;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return null;

  const qx = sy * edge1z - sz * edge1y;
  const qy = sz * edge1x - sx * edge1z;
  const qz = sx * edge1y - sy * edge1x;
  const v = f * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return null;

  const t = f * (edge2x * qx + edge2y * qy + edge2z * qz);
  return t >= 0 ? t : null;
}

/**
 * Ray-segment AABB overlap test.
 *
 * The ray travels from its origin along -normal for up to rayLimit; its swept
 * AABB is a thin box from the origin to the endpoint. A triangle can only be
 * hit inside that box, so a triangle whose AABB does not overlap the ray AABB
 * is skipped — six comparisons, no divisions, no allocations (the previous
 * slab filter did three divisions and allocated an object per triangle, which
 * on a 1.5M-face model cost ~119 GFLOP and ~3 billion allocations inside the
 * sampler).
 */
function rayAABBOverlaps(
  minX: number, maxX: number,
  minY: number, maxY: number,
  minZ: number, maxZ: number,
  rayMinX: number, rayMaxX: number,
  rayMinY: number, rayMaxY: number,
  rayMinZ: number, rayMaxZ: number,
): boolean {
  return minX <= rayMaxX && maxX >= rayMinX
    && minY <= rayMaxY && maxY >= rayMinY
    && minZ <= rayMaxZ && maxZ >= rayMinZ;
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
  sampleCount: number,
  thresholds: AnalysisThresholds = getThresholds(),
): Confidence {
  if (minThickness === null || sampleCount === 0) return 0.0 as Confidence;

  const wt = thresholds.wallThickness;
  let confidence = averageConfidence;

  if (thinWallRatio > wt.confidencePenalty.thinWallRatioBandCritical) {
    confidence *= wt.confidencePenalty.criticalMultiplier;
  } else if (thinWallRatio > wt.confidencePenalty.thinWallRatioBandHigh) {
    confidence *= wt.confidencePenalty.highMultiplier;
  } else if (thinWallRatio > wt.confidencePenalty.thinWallRatioBandModerate) {
    confidence *= wt.confidencePenalty.moderateMultiplier;
  }

  const clamped = Math.max(wt.confidenceClamp.min, Math.min(wt.confidenceClamp.max, confidence));
  return wt.confidenceSnapLevels.reduce((a, b) =>
    Math.abs(b - clamped) < Math.abs(a - clamped) ? b : a
  ) as Confidence;
}

export function deriveWtStatus(
  thinWallRatio: number,
  p5WallThickness?: number | null,
  thresholds: AnalysisThresholds = getThresholds(),
): 'good' | 'warning' | 'critical' {
  const status = thresholds.wallThickness.status;
  if (thinWallRatio > status.criticalThinRatio) return 'critical';
  if (thinWallRatio > status.warningThinRatio) return 'warning';
  if (p5WallThickness != null && p5WallThickness < status.warningMinThicknessMm) return 'warning';
  return 'good';
}

/**
 * Raycast wall-thickness sampling.
 *
 * Performance: the inner loop is the classic O(samples × triangles) scan, but
 * every triangle is pre-filtered by a six-comparison ray-AABB overlap test
 * before the (now allocation-free) intersection. The previous implementation
 * ran the full Möller–Trumbore test on every face with six object allocations
 * per call — on a 1.5M-triangle model that was ~2.9 billion intersections and
 * ~17 billion allocations, taking ~10 s on desktop and 30-60 s on a phone.
 * The overlap filter skips only triangles whose AABB the ray segment cannot
 * touch, so the hit set (and therefore the per-sample confidence, which
 * counts strictly-decreasing hits in index order) is byte-identical.
 */
export function sampleWallThickness(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  maxSamples?: number,
  maxRayDist?: number,
  thresholds: AnalysisThresholds = getThresholds(),
  graph?: GeometryGraph | null,
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
} {
  const wt = thresholds.wallThickness;
  const maxSampleCount = maxSamples ?? wt.maxSamples;
  const triCount = Math.floor(indices.length / 3);
  const samples: WallThicknessSample[] = [];

  if (triCount < wt.minTriCount) {
    return { samples, minThickness: null, avgThickness: null, p1Thickness: null, p5Thickness: null, p10Thickness: null, medianThickness: null, thinWallCount: 0, thinWallRatio: 0, thinWallPercentage: 0, averageConfidence: 0 };
  }

  // Scale-aware ray budget (see MAX_RAY_DIST_DIAGONAL_FACTOR). Callers that
  // already computed the bounding box pass the diagonal-derived value to avoid
  // a redundant scan; standalone callers derive it from the positions.
  const rayLimit = maxRayDist ?? boundingBoxDiagonal(positions, graph) * wt.rayDistanceDiagonalFactor;

  // Per-triangle AABBs for the slab pre-filter (6 floats per triangle).
  const triBounds = new Float32Array(triCount * 6);
  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    const i0 = indices[base] * 3, i1 = indices[base + 1] * 3, i2 = indices[base + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
    const b6 = t * 6;
    triBounds[b6] = ax < bx ? (ax < cx ? ax : cx) : (bx < cx ? bx : cx);
    triBounds[b6 + 1] = ax > bx ? (ax > cx ? ax : cx) : (bx > cx ? bx : cx);
    triBounds[b6 + 2] = ay < by ? (ay < cy ? ay : cy) : (by < cy ? by : cy);
    triBounds[b6 + 3] = ay > by ? (ay > cy ? ay : cy) : (by > cy ? by : cy);
    triBounds[b6 + 4] = az < bz ? (az < cz ? az : cz) : (bz < cz ? bz : cz);
    triBounds[b6 + 5] = az > bz ? (az > cz ? az : cz) : (bz > cz ? bz : cz);
  }

  const step = Math.max(1, Math.floor(triCount / maxSampleCount));

  for (let i = 0; i < indices.length && samples.length < maxSampleCount; i += step * 3) {
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

    const dx = -nx / len, dy = -ny / len, dz = -nz / len;

    let minDist = rayLimit;
    let hitCount = 0;

    // Swept AABB of this ray segment (origin → origin + dir * rayLimit).
    const rayMinX = dx >= 0 ? fcx : fcx + dx * rayLimit;
    const rayMaxX = dx >= 0 ? fcx + dx * rayLimit : fcx;
    const rayMinY = dy >= 0 ? fcy : fcy + dy * rayLimit;
    const rayMaxY = dy >= 0 ? fcy + dy * rayLimit : fcy;
    const rayMinZ = dz >= 0 ? fcz : fcz + dz * rayLimit;
    const rayMaxZ = dz >= 0 ? fcz + dz * rayLimit : fcz;

    for (let j = 0; j < indices.length; j += 3) {
      if (j === i) continue;

      const b6 = (j / 3) * 6;
      // Exact pre-filter: the triangle AABB must overlap the ray segment's
      // swept AABB — otherwise the ray cannot touch the triangle and the
      // full intersection is skipped (result-identical, no allocations).
      if (!rayAABBOverlaps(
        triBounds[b6], triBounds[b6 + 1],
        triBounds[b6 + 2], triBounds[b6 + 3],
        triBounds[b6 + 4], triBounds[b6 + 5],
        rayMinX, rayMaxX, rayMinY, rayMaxY, rayMinZ, rayMaxZ,
      )) continue;

      const j0 = indices[j] * 3, j1 = indices[j + 1] * 3, j2 = indices[j + 2] * 3;

      const t = rayTriangleIntersection(
        fcx, fcy, fcz, dx, dy, dz,
        positions[j0], positions[j0 + 1], positions[j0 + 2],
        positions[j1], positions[j1 + 1], positions[j1 + 2],
        positions[j2], positions[j2 + 1], positions[j2 + 2],
      );

      if (t !== null && t > wt.rayMinHitDistanceMm && t < minDist) {
        minDist = t;
        hitCount++;
      }
    }

    const confidence = hitCount > 0
      ? Math.min(wt.hitConfidenceCap, wt.hitConfidenceBase + hitCount * wt.hitConfidencePerHit) as Confidence
      : wt.noHitConfidence as Confidence;

    samples.push({
      position: { x: fcx, y: fcy, z: fcz },
      thickness: minDist < rayLimit ? minDist : 0,
      confidence,
    });
  }

  const validSamples = samples.filter(s => s.thickness > wt.validThicknessMinMm && s.confidence > wt.validConfidenceMin);
  const minThickness = validSamples.length > 0
    ? Math.min(...validSamples.map(s => s.thickness))
    : null;
  const avgThickness = validSamples.length > 0
    ? validSamples.reduce((sum, s) => sum + s.thickness, 0) / validSamples.length
    : null;

  const sorted = validSamples.map(s => s.thickness).sort((a, b) => a - b);
  const p1Thickness = validSamples.length > 0 ? percentile(sorted, wt.percentiles.p1) : null;
  const p5Thickness = validSamples.length > 0 ? percentile(sorted, wt.percentiles.p5) : null;
  const p10Thickness = validSamples.length > 0 ? percentile(sorted, wt.percentiles.p10) : null;
  const medianThickness = validSamples.length > 0 ? percentile(sorted, wt.percentiles.median) : null;

  const thinWallCount = validSamples.filter(s => s.thickness < wt.thinWallMm).length;
  const thinWallRatio = validSamples.length > 0 ? (thinWallCount / validSamples.length) : 0;
  const thinWallPercentage = thinWallRatio * 100;

  const averageConfidence = validSamples.length > 0
    ? validSamples.reduce((sum, s) => sum + s.confidence, 0) / validSamples.length
    : 0;

  return { samples, minThickness, avgThickness, p1Thickness, p5Thickness, p10Thickness, medianThickness, thinWallCount, thinWallRatio, thinWallPercentage, averageConfidence };
}
