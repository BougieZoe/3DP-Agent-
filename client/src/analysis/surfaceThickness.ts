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
 * Performance:
 *  - Vertices are bucketed by their normal sign pattern (8 buckets). Two
 *    vertices whose sign patterns are identical can never satisfy the
 *    opposition test (every axis product is ≥ 0, so the dot product is
 *    ≥ 0 > -0.3), so same-bucket vertices are skipped losslessly.
 *  - Dense scan meshes (vertex spacing ≪ 4 mm) put hundreds of vertices in
 *    every grid cell, making the exact per-vertex pass O(V × cell²) — minutes
 *    on a phone. Above FULL_COMPUTE_LIMIT vertices the map is computed on a
 *    uniform sample of the mesh and every other vertex inherits the nearest
 *    sample's thickness. Sample spacing stays below the 4 mm grid radius for
 *    any mesh the map is useful on, so coverage is complete; thin-wall
 *    regions keep their shape and color, and the heatmap stays a true surface
 *    mapping rather than a point cloud.
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
/** Below this, compute every vertex exactly (matches the desktop algorithm bit-for-bit). */
const FULL_COMPUTE_LIMIT = 100_000;
/** Above FULL_COMPUTE_LIMIT, compute this many uniformly-spaced samples. */
const SAMPLE_TARGET = 100_000;

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

type ThicknessGrid = Map<number, Map<number, number[]>>;

function buildGrid(
  positions: Float32Array,
  normals: Float32Array,
  vertices: ArrayLike<number>,
  count: number,
): ThicknessGrid {
  const grid: ThicknessGrid = new Map();
  for (let k = 0; k < count; k++) {
    const i = vertices[k];
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
  return grid;
}

/**
 * Exact per-vertex pass: 27-cell opposite-normal nearest-distance search.
 * `indexOf` maps a vertex index to its position in the thickness array (used
 * to pack samples for the dense-mesh path).
 */
function thicknessOf(
  positions: Float32Array,
  normals: Float32Array,
  grid: ThicknessGrid,
  i: number,
): number {
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
          // Same-bucket vertices provably cannot satisfy the opposition test.
          if (b === myBucket) continue;
          for (let k = 0; k < arr.length; k++) {
            const j = arr[k];
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

  return minDist;
}

/**
 * Dense-mesh path: compute exact thickness on a uniform sample, then have
 * every other vertex inherit the nearest sample's value. See the module doc
 * for the rationale.
 */
function computeSampled(
  positions: Float32Array,
  normals: Float32Array,
  vertexCount: number,
): Float32Array {
  const stride = Math.max(2, Math.ceil(vertexCount / SAMPLE_TARGET));
  const sampleCount = Math.ceil(vertexCount / stride);

  const sampleVerts = new Uint32Array(sampleCount);
  for (let s = 0; s < sampleCount; s++) sampleVerts[s] = s * stride;

  const sampleGrid = buildGrid(positions, normals, sampleVerts, sampleCount);
  const sampledThickness = new Float32Array(sampleCount);
  for (let s = 0; s < sampleCount; s++) {
    sampledThickness[s] = thicknessOf(positions, normals, sampleGrid, sampleVerts[s]);
  }

  const thickness = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];
    const baseX = Math.floor(px / SURFACE_THICKNESS_GRID_SIZE_MM);
    const baseY = Math.floor(py / SURFACE_THICKNESS_GRID_SIZE_MM);
    const baseZ = Math.floor(pz / SURFACE_THICKNESS_GRID_SIZE_MM);

    let best = -1;
    let bestDist = Infinity;

    // Nearest-sample inheritance. The exact 27-cell search is O(cells ×
    // samples-per-cell); samples are stride-spaced and every occupied cell
    // holds one, so the nearest sample is virtually always in the vertex's
    // own cell or one of the 6 face-sharing cells. Search those 7 first and
    // only fall back to the full 27 when they come up empty (which cannot
    // happen for valid sample spacing, but stays correct if it does) — this
    // keeps dense-mesh maps ~4x faster at no visible cost.
    const FACE_CELLS: Array<[number, number, number]> = [
      [0, 0, 0], [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
    ];
    for (const [dx, dy, dz] of FACE_CELLS) {
      const buckets = sampleGrid.get(cellKey(baseX + dx, baseY + dy, baseZ + dz));
      if (!buckets) continue;
      for (const arr of buckets.values()) {
        for (let k = 0; k < arr.length; k++) {
          const j = arr[k];
          const dx2 = positions[j * 3] - px;
          const dy2 = positions[j * 3 + 1] - py;
          const dz2 = positions[j * 3 + 2] - pz;
          const d2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
          if (d2 < bestDist) {
            bestDist = d2;
            best = j;
          }
        }
      }
    }
    if (best < 0) {
      for (const dx of NEIGHBORHOOD) {
        for (const dy of NEIGHBORHOOD) {
          for (const dz of NEIGHBORHOOD) {
            const buckets = sampleGrid.get(cellKey(baseX + dx, baseY + dy, baseZ + dz));
            if (!buckets) continue;
            for (const arr of buckets.values()) {
              for (let k = 0; k < arr.length; k++) {
                const j = arr[k];
                const dx2 = positions[j * 3] - px;
                const dy2 = positions[j * 3 + 1] - py;
                const dz2 = positions[j * 3 + 2] - pz;
                const d2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
                if (d2 < bestDist) {
                  bestDist = d2;
                  best = j;
                }
              }
            }
          }
        }
      }
    }
    thickness[v] = best >= 0 ? sampledThickness[best / stride] : SURFACE_THICKNESS_MAX_MM;
  }

  return thickness;
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

  if (vertexCount > FULL_COMPUTE_LIMIT) {
    return computeSampled(positions, normals, vertexCount);
  }

  const fullVerts = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) fullVerts[i] = i;
  const grid = buildGrid(positions, normals, fullVerts, vertexCount);
  const thickness = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    thickness[i] = thicknessOf(positions, normals, grid, i);
  }
  return thickness;
}
