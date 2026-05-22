import { moduleResult, type AnalysisModuleResult, type Confidence, type ValidationResult, type NormalOrientation } from './types';
import { buildGeometryGraph, type GeometryGraph } from './geometryGraph';
import { type GeometryModel } from './geometryModel';

const DEGENERATE_AREA_THRESHOLD = 1e-12;

export function validateMesh(
  model: GeometryModel,
  graph?: GeometryGraph | null,
): AnalysisModuleResult<ValidationResult> {
  const startTime = performance.now();
  const g = graph ?? buildGeometryGraph(model);

  if (!g) {
    return moduleResult('validation', 0.0, 0, {
      isWatertight: false, holeCount: 0, boundaryEdgeCount: 0,
      flippedNormalFaceCount: 0, totalFaceCount: 0, flippedNormalRatio: 0,
      normalOrientation: 'unknown', degenerateFaceCount: 0,
    }, 'No position data');
  }

  if (g.indices.length === 0) {
    return moduleResult('validation', 0.2, Math.round(performance.now() - startTime), {
      isWatertight: false, holeCount: 0, boundaryEdgeCount: 0,
      flippedNormalFaceCount: 0, totalFaceCount: g.triangleCount,
      flippedNormalRatio: 0, normalOrientation: 'unknown', degenerateFaceCount: 0,
    }, 'Cannot validate non-indexed geometry');
  }

  const positions = g.positions;
  const indices = g.indices;
  const edgeMap = g.edgeMap;
  const totalFaceCount = g.triangleCount;

  let boundaryCount = 0;
  let nonManifoldCount = 0;
  const edgeEntries = Array.from(edgeMap.entries());
  for (const [, edge] of edgeEntries) {
    if (edge.faceCount === 1) boundaryCount++;
    else if (edge.faceCount > 2) nonManifoldCount++;
  }

  const isWatertight = boundaryCount === 0 && nonManifoldCount === 0;

  let boundaryPerimeter = 0;
  let boundaryEdgeSampleCount = 0;
  for (const [, edge] of edgeEntries) {
    if (edge.faceCount === 1) {
      const ax = positions[edge.a * 3], ay = positions[edge.a * 3 + 1], az = positions[edge.a * 3 + 2];
      const bx = positions[edge.b * 3], by = positions[edge.b * 3 + 1], bz = positions[edge.b * 3 + 2];
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      boundaryPerimeter += Math.sqrt(dx * dx + dy * dy + dz * dz);
      boundaryEdgeSampleCount++;
    }
  }

  const avgEdgeLength = boundaryEdgeSampleCount > 0
    ? boundaryPerimeter / boundaryEdgeSampleCount
    : 0;

  const holeCount = avgEdgeLength > 0 && boundaryCount > 0
    ? Math.max(1, Math.round(boundaryPerimeter / avgEdgeLength / 3))
    : 0;

  const { flippedCount, orientation } = detectFlippedNormals(g);

  let degenerateCount = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const crossX = uy * vz - uz * vy;
    const crossY = uz * vx - ux * vz;
    const crossZ = ux * vy - uy * vx;
    const area = 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);

    if (area < DEGENERATE_AREA_THRESHOLD) {
      degenerateCount++;
    }
  }

  const flippedNormalRatio = totalFaceCount > 0 ? flippedCount / totalFaceCount : 0;

  let confidence: Confidence;
  if (degenerateCount > totalFaceCount * 0.5) {
    confidence = 0.2;
  } else if (flippedNormalRatio > 0.1 || degenerateCount > 0) {
    confidence = 0.7;
  } else {
    confidence = 0.9;
  }

  const result: ValidationResult = {
    isWatertight,
    holeCount,
    boundaryEdgeCount: boundaryCount,
    flippedNormalFaceCount: flippedCount,
    totalFaceCount,
    flippedNormalRatio,
    normalOrientation: orientation,
    degenerateFaceCount: degenerateCount,
  };

  const parts: string[] = [];
  if (isWatertight) parts.push('Mesh is watertight');
  else parts.push(`Mesh is NOT watertight — ${holeCount} hole(s), ${boundaryCount} boundary edge(s)`);
  if (flippedCount > 0) parts.push(`${flippedCount} face(s) (${(flippedNormalRatio * 100).toFixed(1)}%) have flipped normals`);
  if (degenerateCount > 0) parts.push(`${degenerateCount} degenerate face(s)`);
  parts.push(`Normal orientation: ${orientation}`);

  return moduleResult('validation', confidence, Math.round(performance.now() - startTime), result, parts.join('. '));
}

function detectFlippedNormals(
  graph: GeometryGraph,
): { flippedCount: number; orientation: NormalOrientation } {
  const { positions, indices, triangleCount } = graph;
  if (triangleCount === 0) return { flippedCount: 0, orientation: 'unknown' };

  let cx = 0, cy = 0, cz = 0;
  const usedVerts = new Set<number>();

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i] as number;
    if (!usedVerts.has(idx)) {
      usedVerts.add(idx);
      cx += positions[idx * 3];
      cy += positions[idx * 3 + 1];
      cz += positions[idx * 3 + 2];
    }
  }

  const numVerts = usedVerts.size;
  cx /= numVerts;
  cy /= numVerts;
  cz /= numVerts;

  let outwardCount = 0;
  let inwardCount = 0;

  for (let t = 0; t < triangleCount; t++) {
    const base = t * 3;
    const i0 = indices[base] as number, i1 = indices[base + 1] as number, i2 = indices[base + 2] as number;

    const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
    const ax = positions[p0], ay = positions[p0 + 1], az = positions[p0 + 2];
    const bx = positions[p1], by = positions[p1 + 1], bz = positions[p1 + 2];
    const cx2 = positions[p2], cy2 = positions[p2 + 1], cz2 = positions[p2 + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx2 - ax, vy = cy2 - ay, vz = cz2 - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    const fcx = (ax + bx + cx2) / 3;
    const fcy = (ay + by + cy2) / 3;
    const fcz = (az + bz + cz2) / 3;

    const dcx = fcx - cx, dcy = fcy - cy, dcz = fcz - cz;

    const dot = nx * dcx + ny * dcy + nz * dcz;
    if (dot >= 0) outwardCount++;
    else inwardCount++;
  }

  let flippedCount: number;
  let orientation: NormalOrientation;

  if (outwardCount > inwardCount) {
    orientation = 'consistent_outward';
    flippedCount = inwardCount;
  } else if (inwardCount > outwardCount) {
    orientation = 'consistent_inward';
    flippedCount = outwardCount;
  } else {
    orientation = 'mixed';
    flippedCount = outwardCount;
  }

  if (flippedCount > triangleCount * 0.8) {
    orientation = orientation === 'consistent_outward' ? 'consistent_inward' : 'consistent_outward';
    flippedCount = triangleCount - flippedCount;
  }

  return { flippedCount, orientation };
}
