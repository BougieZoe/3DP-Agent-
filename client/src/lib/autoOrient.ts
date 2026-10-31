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
import { analyzeOverhang } from '../analysis/metrics';

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

// ---------------------------------------------------------------------------
// Overhang-aware orientation suggestion (preview loop)
// ---------------------------------------------------------------------------

export interface OrientationCandidate {
  /** Rotation axis relative to the current orientation; null = current pose. */
  axis: 'x' | 'y' | null;
  /** Degrees applied about `axis`; 0 for the current pose. */
  degrees: number;
  label: string;
  overhangRatio: number;
  overhangFaces: number;
  buildHeightMm: number;
  baseContactAreaMm2: number;
  /** False when the pose fails the base-contact floor and cannot win. */
  baseContactOk: boolean;
  /** XY-projected bounding-box area of this pose (mm²). */
  footprintMm2: number;
  /** baseContactAreaMm2 / footprintMm2 — the share of the shadow that touches. */
  baseContactFraction: number;
}

export type OrientationVerdict = 'rotated' | 'kept' | 'no_good_orientation';

export interface OrientationSuggestion {
  candidates: OrientationCandidate[];
  /** The orientation the user should preview; `axis: null` means keep current. */
  chosen: OrientationCandidate;
  /** Rotated clone of the input geometry for `chosen`; null when kept current. */
  rotatedGeometry: THREE.BufferGeometry | null;
  /** True only when verdict is 'rotated'. */
  rotated: boolean;
  /**
   * 'rotated' — a stable pose clears the overhang-gain bar.
   * 'kept' — the current pose is already the best available.
   * 'no_good_orientation' — no pose gives the part a stable seat; nothing
   *   worth proposing. `reason` explains why in user-facing terms.
   */
  verdict: OrientationVerdict;
  reason: string | null;
}

/**
 * Candidates within this many absolute points of the lowest overhang area
 * ratio are treated as tied. Inside the tie, footprint and build height —
 * not overhang — decide the winner, so a pose that is only 1–2pp better but
 * much taller or resting on a tiny base never beats a stable one.
 */
const NEAR_BEST_OVERHANG_TOL = 0.02;

/**
 * Absolute overhang-area-ratio improvement required before a rotation is
 * proposed at all. 0.05 matches the 'negligible → moderate' boundary in
 * deriveOhStatus (metrics.ts): below 5pp the change is cosmetic and not
 * worth re-orienting the user's model for.
 */
const MIN_OVERHANG_GAIN_TO_ROTATE = 0.05;

/**
 * Base-contact floor, relative to the part's own footprint: a candidate is
 * eligible only when its plate-contact area is at least this fraction of the
 * LARGEST base contact the part can achieve across the six poses. 0.25 means
 * a pose must offer a quarter of the best seat the geometry allows — edge
 * perches and point rests fall far below that on any real part. Applied
 * before the overhang comparison; the current pose is exempt (it is always
 * the fallback when nothing better qualifies). Parts whose best contact is
 * ~0 (spheres) get a floor of 0, so the check can never reject everything.
 */
const MIN_BASE_CONTACT_FRACTION = 0.25;

/**
 * Second stability guard, against parts that have NO decent pose at all:
 * a candidate is 'stable' only when its plate contact covers at least this
 * fraction of its own XY projected footprint (bbox x×y in that pose). 0.10
 * means a pose resting on less than a tenth of its shadow is an edge perch.
 * When even the best pose falls below it we report 'no_good_orientation'
 * instead of proposing a rotation we know is fragile.
 */
const MIN_STABLE_FOOTPRINT_FRACTION = 0.10;

const CANDIDATE_ROTATIONS: ReadonlyArray<{ axis: 'x' | 'y' | null; degrees: number; label: string }> = [
  { axis: null, degrees: 0, label: 'current' },
  { axis: 'x', degrees: 90, label: '+90° about X' },
  { axis: 'x', degrees: -90, label: '-90° about X' },
  { axis: 'x', degrees: 180, label: '180° about X' },
  { axis: 'y', degrees: 90, label: '+90° about Y' },
  { axis: 'y', degrees: -90, label: '-90° about Y' },
];

function sequentialIndices(vertexCount: number): Uint32Array {
  const idx = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) idx[i] = i;
  return idx;
}

/** Vertices within this distance of the plate count as touching it —
 *  approximates first-layer squish plus minor underside warp. Absolute,
 *  not relative to model height: the old relative band (modelHeight ×
 *  1e-3, i.e. 0.002 mm on a 2 mm part) saw only faces coplanar with the
 *  lowest vertex and undercounted non-flat undersides (test_model:
 *  3.2 mm² measured vs ~60 mm² of bearing underside). Must stay small:
 *  at 0.5 mm a 10 mm-diameter cylinder lying down already produces a
 *  ~380 mm² phantom contact strip (sagitta), so 0.25 mm is the band that
 *  still credits test_model's ~0.4 mm underside relief while excluding
 *  curved surfaces that never truly bear. */
const CONTACT_EPS_MM = 0.25;

/** Support polygon: the XY convex hull of the vertices touching the plate.
 *  This is the region where the part's weight can bear — a flat underside
 *  yields its full area (a 20×10 plate gives exactly 200 mm²), four feet
 *  give the feet polygon, a cylinder lying down gives ~0 (line contact),
 *  and an edge perch gives the sliver it stands on. Summing in-band face
 *  area instead credits curved undersides that never touch (a lying
 *  cylinder measured 383 mm² of "contact" that way).
 *  Monotone-chain hull, O(n log n). */
function supportPolygonAreaMm2(positions: Float32Array, minZ: number): number {
  const zMax = minZ + CONTACT_EPS_MM;
  const pts: number[] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    if (positions[i + 2] <= zMax) pts.push(positions[i], positions[i + 1]);
  }
  const n = pts.length / 2;
  if (n < 3) return 0;

  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1]);

  const cross = (o: number, a: number, b: number) =>
    (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1]) -
    (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);

  const lower: number[] = [];
  for (const i of order) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 1e-12) {
      lower.pop();
    }
    lower.push(i);
  }
  const upper: number[] = [];
  for (const i of [...order].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 1e-12) {
      upper.pop();
    }
    upper.push(i);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));

  let twiceArea = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    twiceArea += pts[2 * a] * pts[2 * b + 1] - pts[2 * b] * pts[2 * a + 1];
  }
  return Math.abs(twiceArea) / 2;
}

/**
 * Score the 6 cardinal orientations of `geometry` with the pipeline's own
 * overhang computation (analyzeOverhang), then pick the best pose:
 *   1. candidates within NEAR_BEST_OVERHANG_TOL of the minimum overhang
 *      ratio are "tied";
 *   2. among ties, the largest base contact area wins (stability);
 *   3. build height breaks remaining ties (shorter prints are safer/faster).
 *
 * A rotation is proposed only when it improves the overhang ratio by at
 * least MIN_OVERHANG_GAIN_TO_ROTATE or removes every overhanging face;
 * otherwise the current orientation is kept. The input geometry is never
 * mutated — `rotatedGeometry` is a clone.
 */
export function suggestOrientation(
  geometry: THREE.BufferGeometry,
  overhangThresholdDeg = 50,
): OrientationSuggestion {
  const candidates: OrientationCandidate[] = [];
  const rotatedClones: THREE.BufferGeometry[] = [];

  for (const rot of CANDIDATE_ROTATIONS) {
    const g = geometry.clone();
    if (rot.axis === 'x') g.rotateX(THREE.MathUtils.degToRad(rot.degrees));
    if (rot.axis === 'y') g.rotateY(THREE.MathUtils.degToRad(rot.degrees));
    g.computeBoundingBox();
    rotatedClones.push(g);

    const posAttr = g.getAttribute('position');
    const positions = posAttr.array as Float32Array;
    const index = g.getIndex();
    const indices = index ? new Uint32Array(index.array) : sequentialIndices(posAttr.count);

    const overhang = analyzeOverhang(positions, indices, overhangThresholdDeg);
    const box = g.boundingBox!;
    const size = new THREE.Vector3();
    box.getSize(size);
    const buildHeightMm = size.z;
    const footprintMm2 = size.x * size.y;
    const contact = supportPolygonAreaMm2(positions, box.min.z);

    candidates.push({
      axis: rot.axis,
      degrees: rot.degrees,
      label: rot.label,
      overhangRatio: overhang.ratio,
      overhangFaces: overhang.faceCount,
      buildHeightMm,
      baseContactAreaMm2: contact,
      baseContactOk: true,
      footprintMm2,
      baseContactFraction: footprintMm2 > 1e-9 ? contact / footprintMm2 : 0,
    });
  }

  // Base-contact floor FIRST: an unstable pose is disqualified before its
  // overhang ratio is allowed to compete.
  const maxBaseContact = Math.max(...candidates.map(c => c.baseContactAreaMm2));
  const floor = maxBaseContact * MIN_BASE_CONTACT_FRACTION;
  for (const c of candidates) c.baseContactOk = c.baseContactAreaMm2 >= floor;
  const eligible = candidates.filter((c, i) =>
    i === 0 || (c.baseContactOk && c.baseContactFraction >= MIN_STABLE_FOOTPRINT_FRACTION),
  );

  const minRatio = Math.min(...eligible.map(c => c.overhangRatio));
  const nearBest = eligible.filter(c => c.overhangRatio <= minRatio + NEAR_BEST_OVERHANG_TOL);
  nearBest.sort((a, b) =>
    b.baseContactAreaMm2 - a.baseContactAreaMm2 || a.buildHeightMm - b.buildHeightMm,
  );

  const best = nearBest[0];
  const current = candidates[0];
  const bestIndex = candidates.indexOf(best);
  const gain = current.overhangRatio - best.overhangRatio;
  const rotated = best !== current &&
    (gain >= MIN_OVERHANG_GAIN_TO_ROTATE ||
      (best.overhangFaces === 0 && current.overhangFaces > 0));

  const bestFootprintFraction = Math.max(...candidates.map(c => c.baseContactFraction));
  let verdict: OrientationVerdict;
  let reason: string | null = null;
  if (rotated) {
    verdict = 'rotated';
  } else if (bestFootprintFraction < MIN_STABLE_FOOTPRINT_FRACTION) {
    verdict = 'no_good_orientation';
    reason = 'No orientation gives this part a stable seat: its best pose ' +
      `contacts only ${(bestFootprintFraction * 100).toFixed(1)}% of its footprint.`;
  } else {
    verdict = 'kept';
  }

  return {
    candidates,
    chosen: rotated ? best : current,
    rotatedGeometry: rotated ? rotatedClones[bestIndex] : null,
    rotated,
    verdict,
    reason,
  };
}
