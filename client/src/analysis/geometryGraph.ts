import type { MeshEdge } from './types';
import { type GeometryModel } from './geometryModel';

export interface TriangleNormal {
  nx: number;
  ny: number;
  nz: number;
  length: number;
}

/**
 * Compact, memory-efficient geometry graph.
 *
 * The previous implementation stored edges / adjacency in Map<string, …>
 * structures with string keys, per-face object arrays and per-vertex/face
 * Sets — a 1.5M-triangle model peaked at ~2.3 GB inside the analysis worker
 * and crashed low-memory phones (whole tab reload → back to the upload page).
 *
 * This version stores everything in flat typed arrays:
 *
 *   - edges: edgeA / edgeB / edgeFaceCount (Uint32/Uint16) — no string keys,
 *     no per-edge objects, no triangleIndices (which nothing consumed).
 *   - face adjacency: CSR (faceNeighborStart + faceNeighbors) — no Sets.
 *   - face normals / centroids: flat Float32Arrays — no per-face objects.
 *   - vertexAdjacency was DEAD (built, never read) — removed.
 *
 * All derived values are numerically identical to the old graph; consumers
 * read the same faceCount / neighbor / centroid / normal semantics.
 */
export interface GeometryGraph {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  vertexCount: number;
  /** Number of unique edges (== edgeA.length). */
  edgeCount: number;
  /** Edge vertex index pairs (always sorted: a < b). */
  edgeA: Uint32Array;
  edgeB: Uint32Array;
  /** Incident triangle count per edge: 1 = boundary, 2 = manifold, >2 = non-manifold. */
  edgeFaceCount: Uint16Array;
  /**
   * CSR face adjacency: the neighbors of face i are
   * faceNeighbors[faceNeighborStart[i] .. faceNeighborStart[i + 1]).
   */
  faceNeighborStart: Uint32Array;
  faceNeighbors: Uint32Array;
  /** Flat per-face normals: [nx, ny, nz, length] per face. */
  faceNormals: Float32Array;
  /** Flat per-face centroids: [x, y, z] per face. */
  faceCentroids: Float32Array;
  boundingBox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  boundingBoxDimensions: { x: number; y: number; z: number };
  boundingBoxDiagonal: number;
}

/**
 * Vertex counts above this fall back to string edge keys. Packed keys
 * (min*vertexCount + max) stay exact while min*vertexCount ≤ 2^53; the bound
 * is 2^26 vertices (a position buffer of ~800 MB) — far beyond any mesh that
 * fits in a browser tab, but the fallback keeps the math honest.
 */
const MAX_PACKED_VERTEX_COUNT = 1 << 26;

export function buildGeometryGraph(model: GeometryModel): GeometryGraph | null {
  const { positions, normals, indices, vertexCount } = model;

  if (positions.length === 0) return null;

  if (indices.length === 0) {
    return {
      positions, normals, indices: new Uint32Array(0),
      triangleCount: Math.floor(vertexCount / 3),
      vertexCount,
      edgeCount: 0,
      edgeA: new Uint32Array(0),
      edgeB: new Uint32Array(0),
      edgeFaceCount: new Uint16Array(0),
      faceNeighborStart: new Uint32Array(0),
      faceNeighbors: new Uint32Array(0),
      faceNormals: new Float32Array(0),
      faceCentroids: new Float32Array(0),
      boundingBox: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
      boundingBoxDimensions: { x: 0, y: 0, z: 0 },
      boundingBoxDiagonal: 0,
    };
  }

  const triCount = Math.floor(indices.length / 3);
  const slots = triCount * 3;

  // ── Pass 1: bounding box, face normals/centroids, edge buckets ─────────────
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (pz < minZ) minZ = pz;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    if (pz > maxZ) maxZ = pz;
  }

  const faceNormals = new Float32Array(triCount * 4);
  const faceCentroids = new Float32Array(triCount * 3);

  // Edge buckets: one slot per triangle-edge. Slots sharing a packed key are
  // chained via `edgeNext`; `edgeHead` maps key → first slot. This replaces
  // the old Map<string, MeshEdge> + Map<string, number[]> pair (string keys,
  // one object array per edge) with a single numeric-keyed map + two arrays.
  const edgeTris = new Uint32Array(slots);   // triangle index for the slot
  const edgePos = new Uint8Array(slots);     // 0..2 — which edge of the triangle
  const edgeNext = new Int32Array(slots);    // next slot with the same key, -1 = end
  const usePackedKeys = vertexCount <= MAX_PACKED_VERTEX_COUNT;
  const edgeHead = new Map<number | string, number>();

  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    const i0 = indices[base] as number;
    const i1 = indices[base + 1] as number;
    const i2 = indices[base + 2] as number;

    const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
    const ax = positions[p0], ay = positions[p0 + 1], az = positions[p0 + 2];
    const bx = positions[p1], by = positions[p1 + 1], bz = positions[p1 + 2];
    const cx = positions[p2], cy = positions[p2 + 1], cz = positions[p2 + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const f4 = t * 4;
    faceNormals[f4] = nx; faceNormals[f4 + 1] = ny; faceNormals[f4 + 2] = nz; faceNormals[f4 + 3] = len;
    const f3 = t * 3;
    faceCentroids[f3] = (ax + bx + cx) / 3;
    faceCentroids[f3 + 1] = (ay + by + cy) / 3;
    faceCentroids[f3 + 2] = (az + bz + cz) / 3;

    // Three directed edges: (i0,i1), (i1,i2), (i2,i0) — keyed by the sorted pair.
    const eA = [i0, i1, i2];
    for (let e = 0; e < 3; e++) {
      const a = eA[e], b = eA[(e + 1) % 3];
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = usePackedKeys ? lo * vertexCount + hi : `${lo}-${hi}`;
      const slot = t * 3 + e;
      edgeTris[slot] = t;
      edgePos[slot] = e;
      const prev = edgeHead.get(key);
      edgeNext[slot] = prev ?? -1;
      edgeHead.set(key, slot);
    }
  }

  // ── Pass 2: flat edge arrays + per-face adjacency counts ───────────────────
  const edgeCount = edgeHead.size;
  const edgeA = new Uint32Array(edgeCount);
  const edgeB = new Uint32Array(edgeCount);
  const edgeFaceCount = new Uint16Array(edgeCount);
  const adjCount = new Uint32Array(triCount);

  let eIdx = 0;
  for (const [, headSlot] of edgeHead) {
    // Recover a/b from the first slot's triangle
    const t0 = edgeTris[headSlot];
    const e0 = edgePos[headSlot];
    const a0 = indices[t0 * 3 + e0] as number;
    const b0 = indices[t0 * 3 + ((e0 + 1) % 3)] as number;
    edgeA[eIdx] = Math.min(a0, b0);
    edgeB[eIdx] = Math.max(a0, b0);

    let k = 0;
    let slot = headSlot;
    while (slot !== -1) { k++; slot = edgeNext[slot]; }
    edgeFaceCount[eIdx] = Math.min(k, 65535);

    if (k >= 2) {
      slot = headSlot;
      while (slot !== -1) {
        adjCount[edgeTris[slot]] += k - 1;
        slot = edgeNext[slot];
      }
    }
    eIdx++;
  }

  // ── Pass 3: CSR adjacency (prefix sum + fill) ──────────────────────────────
  const faceNeighborStart = new Uint32Array(triCount + 1);
  for (let i = 0; i < triCount; i++) faceNeighborStart[i + 1] = faceNeighborStart[i] + adjCount[i];
  const faceNeighbors = new Uint32Array(faceNeighborStart[triCount]);
  const cursor = faceNeighborStart.slice(0, triCount);

  for (const [, headSlot] of edgeHead) {
    let slot = headSlot;
    while (slot !== -1) {
      const fi = edgeTris[slot];
      let s2 = edgeNext[slot];
      while (s2 !== -1) {
        const fj = edgeTris[s2];
        faceNeighbors[cursor[fi]++] = fj;
        faceNeighbors[cursor[fj]++] = fi;
        s2 = edgeNext[s2];
      }
      slot = edgeNext[slot];
    }
  }

  return {
    positions, normals,
    indices, // reference — the graph is read-only over the model's arrays
    triangleCount: triCount,
    vertexCount,
    edgeCount,
    edgeA, edgeB, edgeFaceCount,
    faceNeighborStart, faceNeighbors,
    faceNormals, faceCentroids,
    boundingBox: { minX, minY, minZ, maxX, maxY, maxZ },
    boundingBoxDimensions: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    boundingBoxDiagonal: Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2),
  };
}

/**
 * Rebuild a Map<string, MeshEdge> from the compact edge arrays. Kept for
 * API compatibility (tests / external importers); the analysis pipeline
 * itself reads the flat arrays directly.
 */
export function edgeMapFromGraph(graph: GeometryGraph): Map<string, MeshEdge> {
  const map = new Map<string, MeshEdge>();
  for (let e = 0; e < graph.edgeCount; e++) {
    map.set(`${graph.edgeA[e]}-${graph.edgeB[e]}`, {
      a: graph.edgeA[e],
      b: graph.edgeB[e],
      faceCount: graph.edgeFaceCount[e],
      triangleIndices: [],
    });
  }
  return map;
}
