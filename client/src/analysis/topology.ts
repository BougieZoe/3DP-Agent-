import { moduleResult, type AnalysisModuleResult, type Confidence, type TopologyResult } from './types';
import { buildGeometryGraph, type GeometryGraph } from './geometryGraph';
import { type GeometryModel } from './geometryModel';

export function buildEdgeMap(model: GeometryModel): Map<string, import('./types').MeshEdge> {
  const graph = buildGeometryGraph(model);
  if (graph) {
    return new Map(graph.edgeMap);
  }
  return new Map();
}

export function countShells(model: GeometryModel, graph?: GeometryGraph | null): number {
  const g = graph ?? buildGeometryGraph(model);
  if (!g || g.triangleCount === 0) {
    return g?.triangleCount ?? 0;
  }

  const triCount = g.triangleCount;
  const visited = new Set<number>();
  let shellCount = 0;

  for (let i = 0; i < triCount; i++) {
    if (visited.has(i)) continue;
    shellCount++;

    const queue = [i];
    visited.add(i);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = g.faceAdjacency.get(current);
      if (neighbors) {
        const neighborArr = Array.from(neighbors);
        for (const neighbor of neighborArr) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }
  }

  return shellCount;
}

export function analyzeTopology(
  model: GeometryModel,
  _fileName?: string,
  graph?: GeometryGraph | null,
): AnalysisModuleResult<TopologyResult> {
  const startTime = performance.now();
  const g = graph ?? buildGeometryGraph(model);

  if (!g) {
    return moduleResult('topology', 0.0, 0, {
      triangleCount: 0, vertexCount: 0, edgeCount: 0,
      manifoldEdgeCount: 0, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0,
      shellCount: 0, isManifold: false, problemEdges: [],
    }, 'No position data');
  }

  if (g.indices.length === 0) {
    return moduleResult('topology', 0.3, Math.round(performance.now() - startTime), {
      triangleCount: g.triangleCount,
      vertexCount: g.vertexCount,
      edgeCount: 0,
      manifoldEdgeCount: 0,
      boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      shellCount: g.triangleCount,
      isManifold: false,
      problemEdges: [],
    }, 'Geometry is not indexed — each triangle is treated as an independent shell.');
  }

  const edgeCount = g.edgeMap.size;
  let manifoldCount = 0;
  let boundaryCount = 0;
  let nonManifoldCount = 0;
  const problemEdges: Array<{ a: number; b: number; faceCount: number }> = [];

  const edgeArray = Array.from(g.edgeMap.entries());
  for (const [, edge] of edgeArray) {
    if (edge.faceCount === 2) {
      manifoldCount++;
    } else if (edge.faceCount === 1) {
      boundaryCount++;
      problemEdges.push({ a: edge.a, b: edge.b, faceCount: edge.faceCount });
    } else {
      nonManifoldCount++;
      problemEdges.push({ a: edge.a, b: edge.b, faceCount: edge.faceCount });
    }
  }

  const shellCount = countShells(model, g);
  const isManifold = nonManifoldCount === 0;

  const confidence: Confidence = 1.0;

  const result: TopologyResult = {
    triangleCount: g.triangleCount,
    vertexCount: g.vertexCount,
    edgeCount,
    manifoldEdgeCount: manifoldCount,
    boundaryEdgeCount: boundaryCount,
    nonManifoldEdgeCount: nonManifoldCount,
    shellCount,
    isManifold,
    problemEdges,
  };

  const parts: string[] = [];
  if (isManifold) parts.push('Mesh is manifold');
  else parts.push(`${nonManifoldCount} non-manifold edge(s) detected`);
  parts.push(`${shellCount} shell(s), ${g.triangleCount} triangles, ${g.vertexCount} vertices`);
  if (boundaryCount > 0) parts.push(`${boundaryCount} boundary edge(s) — mesh has holes`);

  return moduleResult('topology', confidence, Math.round(performance.now() - startTime), result, parts.join('. '));
}
