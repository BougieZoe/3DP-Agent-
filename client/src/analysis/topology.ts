import { moduleResult, type AnalysisModuleResult, type Confidence, type TopologyResult } from './types';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import { buildGeometryGraph, edgeMapFromGraph, type GeometryGraph } from './geometryGraph';
import { type GeometryModel } from './geometryModel';

export function buildEdgeMap(model: GeometryModel): Map<string, import('./types').MeshEdge> {
  const graph = buildGeometryGraph(model);
  if (graph) {
    return edgeMapFromGraph(graph);
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
      const start = g.faceNeighborStart[current];
      const end = g.faceNeighborStart[current + 1];
      for (let k = start; k < end; k++) {
        const neighbor = g.faceNeighbors[k];
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
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
  language: ContentLang = 'en',
): AnalysisModuleResult<TopologyResult> {
  const startTime = performance.now();
  const g = graph ?? buildGeometryGraph(model);

  if (!g) {
    return moduleResult('topology', 0.0, 0, {
      triangleCount: 0, vertexCount: 0, edgeCount: 0,
      manifoldEdgeCount: 0, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0,
      shellCount: 0, isManifold: false, problemEdges: [],
    }, translate(CONTENT, 'topology.noPositionData', language));
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
    }, translate(CONTENT, 'topology.nonIndexed', language));
  }

  const edgeCount = g.edgeCount;
  let manifoldCount = 0;
  let boundaryCount = 0;
  let nonManifoldCount = 0;
  const problemEdges: Array<{ a: number; b: number; faceCount: number }> = [];

  for (let e = 0; e < g.edgeCount; e++) {
    const faceCount = g.edgeFaceCount[e];
    if (faceCount === 2) {
      manifoldCount++;
    } else if (faceCount === 1) {
      boundaryCount++;
      problemEdges.push({ a: g.edgeA[e], b: g.edgeB[e], faceCount });
    } else {
      nonManifoldCount++;
      problemEdges.push({ a: g.edgeA[e], b: g.edgeB[e], faceCount });
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
  if (isManifold) parts.push(translate(CONTENT, 'topology.manifold', language));
  else parts.push(translate(CONTENT, 'topology.nonManifoldEdges', language, { count: nonManifoldCount }));
  parts.push(translate(CONTENT, 'topology.shellSummary', language, {
    shells: shellCount,
    triangles: g.triangleCount,
    vertices: g.vertexCount,
  }));
  if (boundaryCount > 0) parts.push(translate(CONTENT, 'topology.boundaryEdges', language, { count: boundaryCount }));

  return moduleResult('topology', confidence, Math.round(performance.now() - startTime), result, parts.join('. '));
}
