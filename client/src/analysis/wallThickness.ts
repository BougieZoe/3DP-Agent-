import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
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
 * Performance: builds a BVH (O(n log n)) once, then each of the 200 samples
 * queries the BVH in O(log n) via `raycast`. The previous brute-force scanned
 * all triangles per sample (O(samples × n)) — 20M tests on a 100K-mesh. BVH
 * reduces this to ~3400 ray traversals total.
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

  // Build BVH for O(log n) ray queries. The temporary Geometry + BVH are
  // local to this call and disposed before returning.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  const bvh = new MeshBVH(geo);

  const ray = new THREE.Ray();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();

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

    // Ray: from face centroid along inward normal (-normal direction).
    origin.set(fcx, fcy, fcz);
    direction.set(-nx / len, -ny / len, -nz / len);
    ray.set(origin, direction);

    let minDist = rayLimit;
    let hitCount = 0;

    // BVH raycast returns all hits (O(log n) traversal + O(k) where k = hit count).
    // We find the closest valid hit to match the brute-force semantics.
    const hits = bvh.raycast(ray, THREE.DoubleSide);
    const sourceTriIdx = Math.floor(i / 3);
    for (const hit of hits) {
      if (hit.distance > wt.rayMinHitDistanceMm && hit.distance < minDist) {
        if (hit.faceIndex !== sourceTriIdx) {
          minDist = hit.distance;
          hitCount++;
        }
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

  // Clean up temporary BVH geometry.
  geo.dispose();

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
