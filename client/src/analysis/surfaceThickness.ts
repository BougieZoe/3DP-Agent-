/**
 * Per-vertex wall thickness map — the data behind the surface-mapped
 * wall-thickness heatmap.
 *
 * Same algorithm as the desktop `AdvancedWallThickness` component (spatial
 * grid + opposite-normal nearest-distance search), computed once inside the
 * analysis worker so mobile gets a true surface mapping without a main-thread
 * pass that would OOM on large meshes.
 *
 * Values are identical to what the desktop component computes on its own:
 * same grid size, same normal-opposition threshold, same distance filter,
 * same cap. Desktop and mobile therefore render the same colors from the
 * same numbers — nothing here changes the reported wall-thickness metrics
 * (those still come from the raycast sampler in wallThickness.ts).
 *
 * Performance: vertices are bucketed by their normal sign pattern (8
 * buckets). Two vertices whose sign patterns are identical can never satisfy
 * the opposition test (every axis product is ≥ 0, so the dot product is ≥ 0
 * > -0.3), so same-bucket vertices are skipped without changing any result.
 * This is a strict, provable filter — not a heuristic — and it collapses
 * degenerate inputs (e.g. point clouds with uniform normals) to a fast path.
 */

/** Spatial grid cell size in mm — MUST match AdvancedWallThickness. */
export const SURFACE_THICKNESS_GRID_SIZE_MM = 4;
/** Distance cap — values above read as "safe/thick", same as the component. */
export const SURFACE_THICKNESS_MAX_MM = 4;
/** Normals must point this far into opposition before a pair counts. */
const OPPOSITE_NORMAL_DOT = -0.3;
/** Pairs closer than this are ignored (coplanar self-hits). */
const MIN_PAIR_DISTANCE_MM = 0.1;
/** 27-cell search neighborhood (±1 cell per axis). */
const NEIGHBORHOOD = [-1, 0, 1];
/**
 * Skip meshes above this vertex count — the per-vertex map would be too large
 * to transfer/upload to the GPU usefully on a phone. The 200-sample raycast
 * metrics still run; only the surface overlay falls back.
 */
const MAX_VERTICES = 3_000_000;

/** 17 bits per axis: ±65536 cells × 4 mm = ±262 km — any real part fits. */
const CELL_SHIFT = 17;
const CELL_OFFSET = 1 << (CELL_SHIFT - 1);

function cellKey(cx: number, cy: number, cz: number): number {
  return ((cx + CELL_OFFSET) << (CELL_SHIFT * 2))
    | ((cy + CELL_OFFSET) << CELL_SHIFT)
    | (cz + CELL_OFFSET);
}

/**
 * Normal sign-pattern bucket (0..7): bit2 = sign(nx), bit1 = sign(ny),
 * bit0 = sign(nz), where sign(x) = 1 for x >= 0, 0 for x < 0.
 *
 * If two normals share a bucket, every axis product is ≥ 0 (same sign, with 0
 * contributing 0), so their dot product is ≥ 0 > OPPOSITE_NORMAL_DOT — they
 * can never pair. Same-bucket vertices are therefore skipped losslessly.
 */
function bucketIndex(normals: Float32Array, i: number): number {
  const p = i * 3;
  return (normals[p] >= 0 ? 4 : 0)
    | (normals[p + 1] >= 0 ? 2 : 0)
    | (normals[p + 2] >= 0 ? 1 : 0);
}

/**
 * Compute per-vertex wall thickness via opposite-normal nearest-distance.
 * Returns a Float32Array of `vertexCount` values in mm (capped at
 * SURFACE_THICKNESS_MAX_MM), or undefined when the mesh is too large or the
 * normal buffer is missing.
 */
export function computeSurfaceWallThickness(
  positions: Float32Array,
  normals: Float32Array,
  vertexCount: number,
): Float32Array | undefined {
  if (!normals || normals.length < vertexCount * 3) return undefined;
  if (vertexCount > MAX_VERTICES) return undefined;

  // Spatial hash: cell key → interleaved [bucket, vertexIndex, bucket, vertexIndex…].
  // Numeric packed keys (integer cell coords) — the desktop component's string
  // keys would allocate ~150 MB of strings for a 1.5M-vertex model.
  // Spatial hash: cell key → per-bucket vertex index arrays. Bucketing by
  // normal sign pattern keeps the per-vertex search to candidate buckets only
  // (see bucketIndex) — degenerate inputs with uniform normals never touch
  // most of their cells.
  const grid = new Map<number, Map<number, number[]>>();
  for (let i = 0; i < vertexCount; i++) {
    const cx = Math.floor(positions[i * 3] / SURFACE_THICKNESS_GRID_SIZE_MM);
    const cy = Math.floor(positions[i * 3 + 1] / SURFACE_THICKNESS_GRID_SIZE_MM);
    const cz = Math.floor(positions[i * 3 + 2] / SURFACE_THICKNESS_GRID_SIZE_MM);
    const key = cellKey(cx, cy, cz);
    let buckets = grid.get(key);
    if (!buckets) { buckets = new Map(); grid.set(key, buckets); }
    const b = bucketIndex(normals, i);
    let arr = buckets.get(b);
    if (!arr) { arr = []; buckets.set(b, arr); }
    arr.push(i);
  }

  const thickness = new Float32Array(vertexCount);

  for (let i = 0; i < vertexCount; i++) {
    const p3 = i * 3;
    const px = positions[p3];
    const py = positions[p3 + 1];
    const pz = positions[p3 + 2];
    const nx = normals[p3];
    const ny = normals[p3 + 1];
    const nz = normals[p3 + 2];
    const myBucket = bucketIndex(normals, i);

    const baseX = Math.floor(px / SURFACE_THICKNESS_GRID_SIZE_MM);
    const baseY = Math.floor(py / SURFACE_THICKNESS_GRID_SIZE_MM);
    const baseZ = Math.floor(pz / SURFACE_THICKNESS_GRID_SIZE_MM);

    let minDist = SURFACE_THICKNESS_MAX_MM;

    for (const dx of NEIGHBORHOOD) {
      for (const dy of NEIGHBORHOOD) {
        for (const dz of NEIGHBORHOOD) {
          const buckets = grid.get(cellKey(baseX + dx, baseY + dy, baseZ + dz));
          if (!buckets) continue;
          for (const [b, arr] of buckets) {
            // Same-bucket vertices provably cannot satisfy the opposition
            // test (every axis product ≥ 0 → dot ≥ 0 > -0.3).
            if (b === myBucket) continue;
            for (let k = 0; k < arr.length; k++) {
            const j = arr[k];

            // Opposite normals: dot must be strongly negative (facing across a wall).
            const jp3 = j * 3;
            const dot = nx * normals[jp3] + ny * normals[jp3 + 1] + nz * normals[jp3 + 2];
            if (dot > OPPOSITE_NORMAL_DOT) continue;

            const dx2 = positions[jp3] - px;
            const dy2 = positions[jp3 + 1] - py;
            const dz2 = positions[jp3 + 2] - pz;
            const dist = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);

            if (dist < minDist && dist > MIN_PAIR_DISTANCE_MM) {
              minDist = dist;
            }
            }
          }
        }
      }
    }

    thickness[i] = minDist;
  }

  return thickness;
}
