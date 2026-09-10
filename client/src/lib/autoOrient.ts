/**
 * Auto-orientation for 3D models
 *
 * Detects the natural "bottom" face of a model and orients it to sit flat
 * on the build plate, so the model looks natural when first loaded.
 *
 * A resting face must be COPLANAR (one plane), not merely normal-aligned:
 * parallel-but-offset faces (e.g. the sides of six thin walls) share a
 * normal direction yet form no single surface to rest on. The old check
 * averaged normal alignment only, so it stood wall_tower (60×20×28 flat on
 * the plate) up on its side into a 28×20×60 tower.
 */

import * as THREE from 'three';

/**
 * Auto-orient a geometry so its largest coplanar face sits on the build
 * plate (Z=0). Leaves the geometry untouched when it already rests flat or
 * when no face covers enough area to justify a rotation (spheres, organic
 * shapes). Makes models look natural when first loaded.
 */
export function autoOrientGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  // In-place: callers pass a freshly-normalized geometry they own exclusively
  // (normalizeModelGeometry already cloned the source), so the extra clone
  // here was a full duplicate of a potentially huge position/index buffer on
  // the main thread.
  const oriented = geometry;
  oriented.computeVertexNormals();
  oriented.computeBoundingBox();

  const box = oriented.boundingBox;
  if (!box) return oriented;

  // Face normals are derived per-triangle from positions (never from the
  // smoothed vertex normals), so shared-vertex averaging can't blur the check.
  const restingNormal = findRestingFaceNormal(oriented);

  if (restingNormal) {
    // Rotate so the resting face is on the bottom (Z=0)
    applyOrientation(oriented, restingNormal);
  }

  return oriented;
}

/** Outward unit normal of the face chosen to rest on the plate. */
interface RestingNormal {
  nx: number;
  ny: number;
  nz: number;
}

/**
 * Minimum share of the total surface a single coplanar patch must cover to
 * justify rotating the model. Below this the model keeps its file orientation
 * (organic shapes, spheres, already-flat parts).
 */
const MIN_RESTING_FACE_AREA_RATIO = 0.05;

/** A triangle must face within ~25° of a cardinal direction to count for it. */
const FACE_ALIGNMENT_DOT = 0.9;

const CARDINAL_DIRS: RestingNormal[] = [
  { nx: 1, ny: 0, nz: 0 },
  { nx: -1, ny: 0, nz: 0 },
  { nx: 0, ny: 1, nz: 0 },
  { nx: 0, ny: -1, nz: 0 },
  { nx: 0, ny: 0, nz: 1 },
  { nx: 0, ny: 0, nz: -1 },
];

/**
 * Find the outward normal of the largest single coplanar axis-aligned patch.
 * Returns null when the model already rests flat (a −Z patch ties for
 * largest) or when no patch is large enough — both mean "don't touch".
 */
function findRestingFaceNormal(geometry: THREE.BufferGeometry): RestingNormal | null {
  const positions = geometry.getAttribute('position');
  const indices = geometry.getIndex();
  if (!positions) return null;

  const vertexCount = positions.count;
  const faceCount = indices ? indices.count / 3 : Math.floor(vertexCount / 3);
  if (faceCount === 0) return null;

  const vert = (i: number, out: number[]): void => {
    const vi = indices ? indices.getX(i) : i;
    out[0] = positions.getX(vi);
    out[1] = positions.getY(vi);
    out[2] = positions.getZ(vi);
  };

  // Per-direction plane offsets (centroid coordinate along the facing axis)
  // weighted by triangle area.
  const clusters: Array<Array<{ offset: number; area: number }>> =
    CARDINAL_DIRS.map(() => []);
  let totalArea = 0;

  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  for (let f = 0; f < faceCount; f++) {
    vert(f * 3, a);
    vert(f * 3 + 1, b);
    vert(f * 3 + 2, c);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    // Unnormalized face normal; |n|/2 is the triangle area.
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) continue; // degenerate triangle
    const area = len / 2;
    totalArea += area;
    const inv = 1 / len;
    const fnx = nx * inv;
    const fny = ny * inv;
    const fnz = nz * inv;
    const cx = (a[0] + b[0] + c[0]) / 3;
    const cy = (a[1] + b[1] + c[1]) / 3;
    const cz = (a[2] + b[2] + c[2]) / 3;
    for (let d = 0; d < CARDINAL_DIRS.length; d++) {
      const dir = CARDINAL_DIRS[d];
      if (fnx * dir.nx + fny * dir.ny + fnz * dir.nz > FACE_ALIGNMENT_DOT) {
        const offset = dir.nx !== 0 ? cx : dir.ny !== 0 ? cy : cz;
        clusters[d].push({ offset, area });
        break; // >0.9 dot against one cardinal excludes the others
      }
    }
  }

  if (totalArea <= 0) return null;

  // Largest single coplanar patch per direction (greedy 1-D clustering).
  const axisSize = (d: number): number => {
    const bb = geometry.boundingBox;
    if (!bb) return 0;
    const dir = CARDINAL_DIRS[d];
    return dir.nx !== 0 ? bb.max.x - bb.min.x : dir.ny !== 0 ? bb.max.y - bb.min.y : bb.max.z - bb.min.z;
  };
  const bestAreaPerDir = clusters.map((list, d) => {
    if (list.length === 0) return 0;
    const tol = Math.max(1e-6, axisSize(d) * 1e-3);
    const sorted = [...list].sort((p, q) => p.offset - q.offset);
    let best = 0;
    let runSum = 0;
    let runStart = sorted[0].offset;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].offset - runStart > tol) {
        if (runSum > best) best = runSum;
        runSum = 0;
        runStart = sorted[i].offset;
      }
      runSum += sorted[i].area;
    }
    if (runSum > best) best = runSum;
    return best;
  });

  let bestDir = 0;
  for (let d = 1; d < bestAreaPerDir.length; d++) {
    if (bestAreaPerDir[d] > bestAreaPerDir[bestDir]) bestDir = d;
  }
  if (bestAreaPerDir[bestDir] < totalArea * MIN_RESTING_FACE_AREA_RATIO) return null;

  // Already resting well enough: the downward-facing patch is at least
  // half the best patch → rotating would be lateral churn, not a fix
  // (e.g. a flat 60×20×28 box must NOT be tipped onto its 60×28 side).
  // Only rotate when the current rest face is clearly worse than the best.
  const negZ = bestAreaPerDir[5];
  if (negZ >= bestAreaPerDir[bestDir] * 0.5) return null;

  return CARDINAL_DIRS[bestDir];
}

function applyOrientation(geometry: THREE.BufferGeometry, normal: RestingNormal): void {
  // Rotate the resting face's outward normal onto −Z (straight down).
  if (normal.nx === 1) {
    geometry.rotateY(Math.PI / 2);
  } else if (normal.nx === -1) {
    geometry.rotateY(-Math.PI / 2);
  } else if (normal.ny === 1) {
    geometry.rotateX(-Math.PI / 2);
  } else if (normal.ny === -1) {
    geometry.rotateX(Math.PI / 2);
  } else if (normal.nz === 1) {
    geometry.rotateX(Math.PI);
  }
  // nz === -1: already facing down, nothing to do (callers guard this too).
}

/**
 * Get a suggested camera position for a freshly loaded model.
 * Returns a position that shows the model from a natural 3/4 view.
 */
export function getSuggestedCameraPosition(geometry: THREE.BufferGeometry): {
  position: THREE.Vector3;
  target: THREE.Vector3;
} {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;

  if (!box) {
    return {
      position: new THREE.Vector3(5, 5, 5),
      target: new THREE.Vector3(0, 0, 0),
    };
  }

  const center = new THREE.Vector3();
  box.getCenter(center);

  const size = new THREE.Vector3();
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 1.5;

  // Natural 3/4 view from slightly above and to the right
  const position = new THREE.Vector3(
    center.x + distance * 0.65,
    center.y + distance * 0.5,
    center.z + distance * 1.0,
  );

  return { position, target: center };
}
