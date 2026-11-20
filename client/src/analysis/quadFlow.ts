import type { GeometryGraph } from './geometryGraph';
import { COPLANAR_DOT } from './topologyProfiles';

/**
 * Quad edge-flow quality, measured on a mesh that only exists as triangles.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A quad mesh is "good" for reasons triangle metrics cannot express: edge loops
 * are supposed to follow the load path, and poles (valence ≠ 4 vertices) are
 * supposed to be placed on purpose. A triangulated quad mesh can be perfectly
 * manifold, watertight and still be useless downstream — which is exactly the
 * failure mode the profile registry was built to name but could not yet measure.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 *
 * It produces measurements, not a verdict. No threshold in this file decides
 * pass or fail, because no quad profile has been calibrated against real parts
 * yet. Writing "poleRatio < 0.05 → PASS" here would be inventing a standard and
 * then grading against it. The numbers are recorded so that calibration becomes
 * possible later — that is the whole point of measuring first.
 *
 * ── Recovering the quad layout ──────────────────────────────────────────────
 *
 * The original quad layout is not stored in a triangulated mesh, so it has to be
 * inferred. A quad leaves one signature: its diagonal is an interior edge whose
 * two triangles are *flatter* against each other than either triangle is against
 * its other neighbours. That comparison is relative, and it has to be — an
 * absolute coplanarity bar (the fingerprint's 0.8°) works on flat faces but
 * misses every quad on a curved surface, where even a true diagonal has some
 * dihedral angle across it.
 *
 * So each triangle nominates the flattest of its three edges, and two triangles
 * are merged into a quad only when they nominate each other. Mutual nomination
 * is what keeps this honest: on a plane every edge is equally flat, nobody wins
 * outright, and the result says so via `ambiguityRatio` instead of inventing a
 * pairing.
 *
 * ── Limits ──────────────────────────────────────────────────────────────────
 *
 * Everything below measures the *reconstructed* layout, not the original one.
 * Flat regions are genuinely undecidable from triangles alone, and a mostly-flat
 * CAD part will report reason 'ambiguous' rather than a confident wrong number.
 */

export type QuadFlowReason =
  | 'ok'
  | 'no-graph'
  | 'too-small'
  | 'not-quad-dominant'
  | 'ambiguous';

export interface QuadFlowLoopStats {
  /** Number of distinct edge loops walked. */
  count: number;
  /** Share of loops that returned to their starting quad. */
  closedRatio: number;
  medianLength: number;
  maxLength: number;
  /** Loops of length 1: a quad whose flow goes nowhere. */
  isolatedCount: number;
}

export interface QuadFlowResult {
  /** False when the reconstruction is too weak to report flow statistics. */
  applicable: boolean;
  reason: QuadFlowReason;
  triangleCount: number;
  /** Triangles paired back into quads. */
  quadFaceCount: number;
  /** quadFaceCount / triangleCount. A fully quad mesh triangulates to ≈ 1. */
  coverage: number;
  /**
   * Share of triangles that could not pick a flattest edge — their two best
   * candidates are equally flat.
   *
   * This is the counterweight to `coverage`. On a flat region the shared border
   * of two quads is exactly as flat as a diagonal, so no pairing is better than
   * any other. High ambiguity means "measured, but do not trust it".
   */
  ambiguityRatio: number;
  /** Interior vertices with valence ≠ 4 — the poles that break edge flow. */
  poleCount: number;
  /** Vertices inside the quad region that are not on an open boundary. */
  interiorVertexCount: number;
  poleRatio: number;
  /** Valence → vertex count, interior vertices only. */
  valenceHistogram: Record<number, number>;
  loops: QuadFlowLoopStats;
}

/** Reconstruction needs enough structure for the statistics to be meaningful. */
const MIN_TRIANGLES = 50;
/** Below this share of reconstructed quads, loop statistics describe noise. */
const MIN_COVERAGE = 0.25;
/** Above this share of undecidable triangles, refuse to report flow. */
const MAX_AMBIGUITY = 0.5;
/**
 * Above this share of one-quad loops the pairing is not a layout, it is noise.
 *
 * This is the check that separates "a quad mesh we reconstructed" from "a
 * triangle mesh we forced into pairs". On a real quad layout every quad meets
 * its neighbours through shared edges, so loops run long and few start alone;
 * on a triangle mesh the mutual-nomination rule still finds partners, but they
 * do not chain, and most loops die after one step.
 */
const MAX_ISOLATED_RATIO = 0.4;
/**
 * Second, independent test for the same thing. Dense triangle meshes produce
 * short loops that never close; a real quad layout produces long loops that
 * often wrap around. Either signal alone leaves a gap (an icosphere at high
 * subdivision has only a third of its loops isolated), so both are checked.
 */
const MIN_LOOP_MEDIAN = 3;
const MIN_CLOSED_RATIO = 0.1;
/** Valence every interior vertex of a clean quad mesh has. */
const IDEAL_VALENCE = 4;
/**
 * Normals must agree at least this much for two triangles to be considered part
 * of one quad. Deliberately loose: a quad on a tight cylinder still bends, and
 * the mutual-nomination rule below does the real discriminating. This only
 * rejects fold-sharp pairs that are plainly not coplanar at all.
 */
const MIN_PAIRING_DOT = 0.7;
/** Two candidate edges flatter than this apart are a coin flip, not a decision. */
const TIE_EPSILON = 1e-6;
/** Stride of GeometryGraph.faceNormals: [nx, ny, nz, length] per face. */
const NORMAL_STRIDE = 4;

function emptyLoops(): QuadFlowLoopStats {
  return { count: 0, closedRatio: 0, medianLength: 0, maxLength: 0, isolatedCount: 0 };
}

function skippable(reason: QuadFlowReason, triangleCount: number): QuadFlowResult {
  return {
    applicable: false,
    reason,
    triangleCount,
    quadFaceCount: 0,
    coverage: 0,
    ambiguityRatio: 0,
    poleCount: 0,
    interiorVertexCount: 0,
    poleRatio: 0,
    valenceHistogram: {},
    loops: emptyLoops(),
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Measure edge-flow quality of the quad layout reconstructed from a triangle
 * mesh. Pure and allocation-bounded; safe to call from the analysis worker.
 */
export function analyzeQuadFlow(graph: GeometryGraph | null | undefined): QuadFlowResult {
  if (!graph || graph.triangleCount === 0) return skippable('no-graph', 0);

  const triangleCount = graph.triangleCount;
  if (triangleCount < MIN_TRIANGLES) return skippable('too-small', triangleCount);

  const vertexCount = graph.vertexCount;
  const indices = graph.indices;
  const normals = graph.faceNormals;
  const edgeCount = graph.edgeCount;

  // Vertex-pair key. Multiplication instead of string concatenation: a 100k
  // triangle mesh has ~150k edges, and string keys there cost more than the
  // whole traversal does.
  const pairKey = (a: number, b: number): number =>
    a < b ? a * vertexCount + b : b * vertexCount + a;

  const edgeIndexByKey = new Map<number, number>();
  for (let e = 0; e < edgeCount; e++) {
    edgeIndexByKey.set(pairKey(graph.edgeA[e], graph.edgeB[e]), e);
  }

  // Edge → its (up to two) incident triangles, plus each triangle's three edges.
  // Only two slots are kept per edge: an edge shared by three or more faces is
  // non-manifold and can never be a quad diagonal, so the third face is moot.
  const edgeFace = new Int32Array(edgeCount * 2).fill(-1);
  const faceEdges = new Int32Array(triangleCount * 3).fill(-1);

  for (let f = 0; f < triangleCount; f++) {
    const i0 = indices[f * 3];
    const i1 = indices[f * 3 + 1];
    const i2 = indices[f * 3 + 2];
    const pairs: Array<[number, number]> = [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ];
    for (let k = 0; k < 3; k++) {
      const [a, b] = pairs[k];
      const e = edgeIndexByKey.get(pairKey(a, b));
      if (e === undefined) continue;
      faceEdges[f * 3 + k] = e;
      if (edgeFace[e * 2] === -1) edgeFace[e * 2] = f;
      else if (edgeFace[e * 2 + 1] === -1) edgeFace[e * 2 + 1] = f;
    }
  }

  // ── Flatness of every interior edge ────────────────────────────────────────
  const edgeDot = new Float64Array(edgeCount).fill(-2);
  for (let e = 0; e < edgeCount; e++) {
    const faceA = edgeFace[e * 2];
    const faceB = edgeFace[e * 2 + 1];
    if (faceA < 0 || faceB < 0) continue;
    if (graph.edgeFaceCount[e] !== 2) continue;
    // graph.faceNormals stores UNNORMALISED cross products, stride 4:
    // [nx*2A, ny*2A, nz*2A, 2A]. The 4th slot is the cross product length, so it
    // has to be divided out — comparing raw values returns area-weighted numbers
    // around 0.03 on a small mesh and never trips any angular threshold.
    // (The fingerprint's areCoplanar() helper assumes stride-3 *unit* normals
    // over its own packed buffer and cannot be reused against this layout.)
    const a4 = faceA * NORMAL_STRIDE;
    const b4 = faceB * NORMAL_STRIDE;
    const lenA = normals[a4 + 3];
    const lenB = normals[b4 + 3];
    if (lenA <= 0 || lenB <= 0) continue;
    const raw =
      normals[a4] * normals[b4] +
      normals[a4 + 1] * normals[b4 + 1] +
      normals[a4 + 2] * normals[b4 + 2];
    edgeDot[e] = raw / (lenA * lenB);
  }

  // ── Each triangle nominates its flattest edge ──────────────────────────────
  const bestEdge = new Int32Array(triangleCount).fill(-1);
  const bestDot = new Float64Array(triangleCount).fill(-2);
  const secondDot = new Float64Array(triangleCount).fill(-2);

  for (let f = 0; f < triangleCount; f++) {
    for (let k = 0; k < 3; k++) {
      const e = faceEdges[f * 3 + k];
      if (e < 0) continue;
      const d = edgeDot[e];
      if (d < MIN_PAIRING_DOT) continue;
      if (d > bestDot[f]) {
        secondDot[f] = bestDot[f];
        bestDot[f] = d;
        bestEdge[f] = e;
      } else if (d > secondDot[f]) {
        secondDot[f] = d;
      }
    }
  }

  let ambiguousTriangles = 0;
  for (let f = 0; f < triangleCount; f++) {
    // A triangle with only one viable edge is not ambiguous — it had no choice
    // to get wrong. A triangle whose two best edges tie is a coin flip.
    if (secondDot[f] > -2 && bestDot[f] - secondDot[f] < TIE_EPSILON) ambiguousTriangles++;
  }
  const ambiguityRatio = ambiguousTriangles / triangleCount;

  // ── Mutual nomination → quad ───────────────────────────────────────────────
  const quadOfTriangle = new Int32Array(triangleCount).fill(-1);
  const allocated = new Uint8Array(triangleCount);
  // quadVerts[q] = [u, b, v, d] — oriented so the diagonal (u, v) is absent from
  // the four edges, giving loop traversal a well-defined "opposite" edge.
  const quadVerts: number[][] = [];

  for (let e = 0; e < edgeCount; e++) {
    const faceA = edgeFace[e * 2];
    const faceB = edgeFace[e * 2 + 1];
    if (faceA < 0 || faceB < 0) continue;
    if (bestEdge[faceA] !== e || bestEdge[faceB] !== e) continue;
    if (allocated[faceA] || allocated[faceB]) continue;

    const u = graph.edgeA[e];
    const v = graph.edgeB[e];

    const third = (face: number): number => {
      for (let k = 0; k < 3; k++) {
        const vert = indices[face * 3 + k];
        if (vert !== u && vert !== v) return vert;
      }
      return -1;
    };

    const b = third(faceA);
    const d = third(faceB);
    if (b < 0 || d < 0 || b === d) continue;

    const quadIndex = quadVerts.length;
    allocated[faceA] = 1;
    allocated[faceB] = 1;
    quadOfTriangle[faceA] = quadIndex;
    quadOfTriangle[faceB] = quadIndex;
    quadVerts.push([u, b, v, d]);
  }

  const quadFaceCount = quadVerts.length;
  const coverage = triangleCount > 0 ? (quadFaceCount * 2) / triangleCount : 0;

  // Ambiguity is checked first, and deliberately so. On a flat model almost no
  // triangle can pick a winner, so pairing collapses and coverage lands near
  // zero — reporting that as 'not-quad-dominant' would blame the mesh for what
  // is actually a limitation of the measurement. "Cannot decide" is the honest
  // answer, and it is more useful than "not a quad mesh".
  if (ambiguityRatio > MAX_AMBIGUITY) {
    return {
      ...skippable('ambiguous', triangleCount),
      quadFaceCount,
      coverage,
      ambiguityRatio,
    };
  }

  // Report the coverage we measured even when it is too low to trust — a caller
  // diagnosing "why is my quad mesh not reporting flow?" needs that number.
  if (coverage < MIN_COVERAGE) {
    return {
      ...skippable('not-quad-dominant', triangleCount),
      quadFaceCount,
      coverage,
      ambiguityRatio,
    };
  }

  // ── Quad edges, valence, poles ─────────────────────────────────────────────
  interface QuadEdge {
    a: number;
    b: number;
    /** How many quads share this edge: 1 is an open boundary, 2 interior. */
    uses: number;
    /** Flattened quad*4+slot references, so a walk can hop across. */
    refs: number[];
  }
  const quadEdges = new Map<number, QuadEdge>();
  const quadEdgeKeys: number[][] = [];

  for (let q = 0; q < quadFaceCount; q++) {
    const verts = quadVerts[q];
    const keys: number[] = [];
    for (let s = 0; s < 4; s++) {
      const a = verts[s];
      const b = verts[(s + 1) & 3];
      const key = pairKey(a, b);
      keys.push(key);
      const existing = quadEdges.get(key);
      if (existing) {
        existing.uses++;
        existing.refs.push(q * 4 + s);
      } else {
        quadEdges.set(key, { a: Math.min(a, b), b: Math.max(a, b), uses: 1, refs: [q * 4 + s] });
      }
    }
    quadEdgeKeys.push(keys);
  }

  const vertexValence = new Map<number, number>();
  const boundaryVertex = new Set<number>();
  for (const edge of quadEdges.values()) {
    vertexValence.set(edge.a, (vertexValence.get(edge.a) ?? 0) + 1);
    vertexValence.set(edge.b, (vertexValence.get(edge.b) ?? 0) + 1);
    // A vertex on an open boundary legitimately has valence < 4; counting it as
    // a pole would report every trimmed quad sheet as poorly flowed.
    if (edge.uses === 1) {
      boundaryVertex.add(edge.a);
      boundaryVertex.add(edge.b);
    }
  }

  const valenceHistogram: Record<number, number> = {};
  let poleCount = 0;
  let interiorVertexCount = 0;
  for (const [vertex, valence] of vertexValence) {
    if (boundaryVertex.has(vertex)) continue;
    interiorVertexCount++;
    valenceHistogram[valence] = (valenceHistogram[valence] ?? 0) + 1;
    if (valence !== IDEAL_VALENCE) poleCount++;
  }

  // ── Edge loops ─────────────────────────────────────────────────────────────
  // A loop is walked by entering a quad through one edge and leaving through the
  // edge opposite it. Closed loops mean the flow wraps around the surface; short
  // loops mean it dies at a seam, a pole or a triangle patch.
  const visited = new Uint8Array(quadFaceCount * 4);
  const lengths: number[] = [];
  let closedLoops = 0;
  let isolated = 0;

  for (let q = 0; q < quadFaceCount; q++) {
    for (let s = 0; s < 4; s++) {
      // Only slots 0 and 1 seed a walk. Every quad contributes two opposite
      // slots to each loop, so seeding from all four counts every loop twice —
      // once per side — and inflates `count` without adding information.
      if (s >= 2) continue;
      const start = q * 4 + s;
      if (visited[start]) continue;

      let current = start;
      let length = 0;
      let closed = false;
      let guard = 0;

      while (guard++ <= quadFaceCount * 4) {
        if (visited[current]) {
          closed = current === start;
          break;
        }
        visited[current] = 1;
        length++;

        const curQuad = current >> 2;
        const curSlot = current & 3;
        const oppositeSlot = (curSlot + 2) & 3;
        const edge = quadEdges.get(quadEdgeKeys[curQuad][oppositeSlot]);
        if (!edge || edge.uses < 2) break;

        let next = -1;
        for (const ref of edge.refs) {
          if ((ref >> 2) !== curQuad) {
            next = ref;
            break;
          }
        }
        if (next < 0) break;
        current = next;
      }

      lengths.push(length);
      if (closed) closedLoops++;
      if (length === 1) isolated++;
    }
  }

  const loopCount = lengths.length;
  const isolatedRatio = loopCount > 0 ? isolated / loopCount : 0;

  const closedRatio = loopCount > 0 ? closedLoops / loopCount : 0;
  const medianLength = median(lengths);

  // Flow that goes nowhere is the signature of pairs invented between triangles
  // that were never part of a quad. Report the measurements but refuse to call
  // this a quad layout.
  const fragmented =
    isolatedRatio > MAX_ISOLATED_RATIO ||
    (closedRatio < MIN_CLOSED_RATIO && medianLength < MIN_LOOP_MEDIAN);
  if (fragmented) {
    return {
      ...skippable('not-quad-dominant', triangleCount),
      quadFaceCount,
      coverage,
      ambiguityRatio,
      poleCount,
      interiorVertexCount,
      poleRatio: interiorVertexCount > 0 ? poleCount / interiorVertexCount : 0,
      valenceHistogram,
      loops: {
        count: loopCount,
        closedRatio,
        medianLength,
        maxLength: loopCount > 0 ? Math.max(...lengths) : 0,
        isolatedCount: isolated,
      },
    };
  }

  return {
    applicable: true,
    reason: 'ok',
    triangleCount,
    quadFaceCount,
    coverage,
    ambiguityRatio,
    poleCount,
    interiorVertexCount,
    poleRatio: interiorVertexCount > 0 ? poleCount / interiorVertexCount : 0,
    valenceHistogram,
    loops: {
      count: loopCount,
      closedRatio,
      medianLength,
      maxLength: loopCount > 0 ? Math.max(...lengths) : 0,
      isolatedCount: isolated,
    },
  };
}

/**
 * The coplanarity bar this module shares with the topology fingerprint, exposed
 * for tests: the fingerprint classifies a mesh as quad-derived at 0.8°, and flow
 * reconstruction must not contradict that verdict on the same mesh.
 */
export const QUAD_FLOW_COPLANAR_DOT = COPLANAR_DOT;
