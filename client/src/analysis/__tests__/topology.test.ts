import { describe, it, expect } from 'vitest';
import {
  createWatertightCubeModel,
  createOpenCubeModel,
  createDisconnectedShellsModel,
  createNonManifoldEdgeModel,
  createNonIndexedModel,
} from './testMeshes';
import { analyzeTopology, buildEdgeMap, countShells } from '../topology';

describe('buildEdgeMap', () => {
  it('returns empty map for non-indexed geometry', () => {
    const model = createNonIndexedModel();
    const map = buildEdgeMap(model);
    expect(map.size).toBe(0);
  });

  it('finds 18 unique edges for a watertight cube', () => {
    const model = createWatertightCubeModel();
    const map = buildEdgeMap(model);
    expect(map.size).toBe(18);

    for (const [, edge] of map) {
      expect(edge.faceCount).toBe(2);
    }
  });

  it('detects 4 boundary edges on open cube', () => {
    const model = createOpenCubeModel();
    const map = buildEdgeMap(model);

    let boundaryCount = 0;
    for (const [, edge] of map) {
      if (edge.faceCount === 1) boundaryCount++;
    }
    expect(boundaryCount).toBe(4);
  });

  it('detects non-manifold edge', () => {
    const model = createNonManifoldEdgeModel();
    const map = buildEdgeMap(model);

    let nonManifoldCount = 0;
    for (const [, edge] of map) {
      if (edge.faceCount > 2) nonManifoldCount++;
    }
    expect(nonManifoldCount).toBe(1);
  });
});

describe('countShells', () => {
  it('counts 1 shell for a watertight cube', () => {
    const model = createWatertightCubeModel();
    expect(countShells(model)).toBe(1);
  });

  it('counts 2 shells for disconnected cubes', () => {
    const model = createDisconnectedShellsModel();
    expect(countShells(model)).toBe(2);
  });

  it('counts 1 shell for non-manifold edge', () => {
    const model = createNonManifoldEdgeModel();
    expect(countShells(model)).toBe(1);
  });

  it('counts triangleCount shells for non-indexed geo', () => {
    const model = createNonIndexedModel();
    expect(countShells(model)).toBe(2);
  });
});

describe('analyzeTopology', () => {
  it('analyzes watertight cube correctly', () => {
    const model = createWatertightCubeModel();
    const result = analyzeTopology(model);

    expect(result.result.triangleCount).toBe(12);
    expect(result.result.vertexCount).toBe(8);
    expect(result.result.isManifold).toBe(true);
    expect(result.result.shellCount).toBe(1);
    expect(result.result.boundaryEdgeCount).toBe(0);
    expect(result.result.nonManifoldEdgeCount).toBe(0);
    expect(result.confidence).toBe(1.0);
  });

  it('analyzes open cube correctly', () => {
    const model = createOpenCubeModel();
    const result = analyzeTopology(model);

    expect(result.result.triangleCount).toBe(10);
    expect(result.result.isManifold).toBe(true);
    expect(result.result.boundaryEdgeCount).toBe(4);
    expect(result.result.shellCount).toBe(1);
  });

  it('detects non-manifold edges', () => {
    const model = createNonManifoldEdgeModel();
    const result = analyzeTopology(model);

    expect(result.result.isManifold).toBe(false);
    expect(result.result.nonManifoldEdgeCount).toBe(1);
    expect(result.result.shellCount).toBe(1);
  });

  it('reports problem edges', () => {
    const model = createNonManifoldEdgeModel();
    const result = analyzeTopology(model);

    expect(result.result.problemEdges.length).toBeGreaterThan(0);
    const nmEdge = result.result.problemEdges.find(e => e.faceCount > 2);
    expect(nmEdge).toBeDefined();
    expect(nmEdge!.faceCount).toBe(3);
  });

  it('handles non-indexed geometry gracefully', () => {
    const model = createNonIndexedModel();
    const result = analyzeTopology(model);

    expect(result.result.shellCount).toBe(2);
    expect(result.result.isManifold).toBe(false);
    expect(result.confidence).toBe(0.3);
    expect(result.explanation).toContain('not indexed');
  });

  it('analyzes disconnected shells', () => {
    const model = createDisconnectedShellsModel();
    const result = analyzeTopology(model);

    expect(result.result.shellCount).toBe(2);
    expect(result.result.triangleCount).toBe(24);
    expect(result.result.isManifold).toBe(true);
  });
});
