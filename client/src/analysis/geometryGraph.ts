import type { MeshEdge } from './types';
import { type GeometryModel } from './geometryModel';

export interface TriangleNormal {
  nx: number;
  ny: number;
  nz: number;
  length: number;
}

export interface GeometryGraph {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  vertexCount: number;
  edgeMap: Map<string, MeshEdge>;
  boundingBox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  boundingBoxDimensions: { x: number; y: number; z: number };
  faceNormals: TriangleNormal[];
  faceCentroids: Array<{ x: number; y: number; z: number }>;
  vertexAdjacency: Map<number, Set<number>>;
  faceAdjacency: Map<number, Set<number>>;
}

function addEdge(map: Map<string, MeshEdge>, a: number, b: number, triIdx: number): void {
  const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
  const existing = map.get(key);
  if (existing) {
    existing.faceCount++;
    existing.triangleIndices.push(triIdx);
  } else {
    map.set(key, {
      a: Math.min(a, b),
      b: Math.max(a, b),
      faceCount: 1,
      triangleIndices: [triIdx],
    });
  }
}

function computeFaceNormal(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): TriangleNormal {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return { nx, ny, nz, length: len };
}

export function buildGeometryGraph(model: GeometryModel): GeometryGraph | null {
  const { positions, normals, indices, vertexCount } = model;

  if (positions.length === 0) return null;

  if (indices.length === 0) {
    return {
      positions, normals, indices: new Uint32Array(0),
      triangleCount: Math.floor(vertexCount / 3),
      vertexCount,
      edgeMap: new Map(),
      boundingBox: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
      boundingBoxDimensions: { x: 0, y: 0, z: 0 },
      faceNormals: [],
      faceCentroids: [],
      vertexAdjacency: new Map(),
      faceAdjacency: new Map(),
    };
  }

  const triCount = Math.floor(indices.length / 3);

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

  const edgeMap = new Map<string, MeshEdge>();
  const faceNormals: TriangleNormal[] = new Array(triCount);
  const faceCentroids: Array<{ x: number; y: number; z: number }> = new Array(triCount);
  const faceAdjacency = new Map<number, Set<number>>();
  const vertexAdjacency = new Map<number, Set<number>>();

  for (let i = 0; i < vertexCount; i++) {
    vertexAdjacency.set(i, new Set());
  }
  for (let i = 0; i < triCount; i++) {
    faceAdjacency.set(i, new Set());
  }

  const edgeToTriangles = new Map<string, number[]>();

  for (let t = 0; t < triCount; t++) {
    const base = t * 3;
    const i0 = indices[base] as number;
    const i1 = indices[base + 1] as number;
    const i2 = indices[base + 2] as number;

    const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
    const ax = positions[p0], ay = positions[p0 + 1], az = positions[p0 + 2];
    const bx = positions[p1], by = positions[p1 + 1], bz = positions[p1 + 2];
    const cx = positions[p2], cy = positions[p2 + 1], cz = positions[p2 + 2];

    faceCentroids[t] = { x: (ax + bx + cx) / 3, y: (ay + by + cy) / 3, z: (az + bz + cz) / 3 };
    faceNormals[t] = computeFaceNormal(ax, ay, az, bx, by, bz, cx, cy, cz);

    const e0k = `${Math.min(i0, i1)}-${Math.max(i0, i1)}`;
    const e1k = `${Math.min(i1, i2)}-${Math.max(i1, i2)}`;
    const e2k = `${Math.min(i2, i0)}-${Math.max(i2, i0)}`;

    const edges = [e0k, e1k, e2k];
    for (let e = 0; e < 3; e++) {
      const ek = edges[e];
      if (!edgeToTriangles.has(ek)) edgeToTriangles.set(ek, []);
      edgeToTriangles.get(ek)!.push(t);

      addEdge(edgeMap, indices[base + e], indices[base + ((e + 1) % 3)], t);
    }

    vertexAdjacency.get(i0)!.add(i1);
    vertexAdjacency.get(i0)!.add(i2);
    vertexAdjacency.get(i1)!.add(i0);
    vertexAdjacency.get(i1)!.add(i2);
    vertexAdjacency.get(i2)!.add(i0);
    vertexAdjacency.get(i2)!.add(i1);
  }

  const edgeEntries = Array.from(edgeToTriangles.entries());
  for (const [, tris] of edgeEntries) {
    if (tris.length >= 2) {
      for (let j = 0; j < tris.length; j++) {
        for (let k = j + 1; k < tris.length; k++) {
          faceAdjacency.get(tris[j])!.add(tris[k]);
          faceAdjacency.get(tris[k])!.add(tris[j]);
        }
      }
    }
  }

  return {
    positions, normals,
    indices: new Uint32Array(indices.length > 0 ? indices : []),
    triangleCount: triCount,
    vertexCount,
    edgeMap,
    boundingBox: { minX, minY, minZ, maxX, maxY, maxZ },
    boundingBoxDimensions: {
      x: maxX - minX,
      y: maxY - minY,
      z: maxZ - minZ,
    },
    faceNormals,
    faceCentroids,
    vertexAdjacency,
    faceAdjacency,
  };
}
