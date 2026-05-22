import { describe, it, expect } from 'vitest';
import { buildGeometryGraph } from '../geometryGraph';
import { analyzeTopology } from '../topology';
import { validateMesh } from '../validation';
import { computeMetrics } from '../metrics';
import { checkBedFit } from '../bedFit';
import { estimateSupportVolume } from '../support';
import { fromThreeBufferGeometry } from '../geometryConversion';
import { createWatertightCube, createIcosphere, createTerrainGrid, createThinWall, createWatertightCubeModel, createIcosphereModel, createTerrainGridModel, createThinWallModel } from './testMeshes';

function measureTime(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe('GeometryGraph benchmark', () => {
  it('buildGeometryGraph on watertight cube (12 tri)', () => {
    const model = createWatertightCubeModel();

    const t = measureTime(() => {
      const graph = buildGeometryGraph(model);
      expect(graph).not.toBeNull();
      expect(graph!.triangleCount).toBe(12);
      expect(graph!.edgeMap.size).toBe(18);
    });

    console.log(`[bench] buildGeometryGraph (12 tri): ${t.toFixed(3)}ms`);
    expect(t).toBeLessThan(10);
  });

  it('buildGeometryGraph on icosphere (80 tri)', () => {
    const model = createIcosphereModel(1);

    const t = measureTime(() => {
      const graph = buildGeometryGraph(model);
      expect(graph).not.toBeNull();
      expect(graph!.triangleCount).toBe(80);
    });

    console.log(`[bench] buildGeometryGraph (80 tri): ${t.toFixed(3)}ms`);
  });

  it('buildGeometryGraph on icosphere (320 tri)', () => {
    const model = createIcosphereModel(3);

    const t = measureTime(() => {
      const graph = buildGeometryGraph(model);
      expect(graph).not.toBeNull();
      expect(graph!.triangleCount).toBe(320);
    });

    console.log(`[bench] buildGeometryGraph (320 tri): ${t.toFixed(3)}ms`);
  });

  it('buildGeometryGraph on terrain grid (20000 tri)', () => {
    const model = createTerrainGridModel(10, 100, 100);

    const t = measureTime(() => {
      const graph = buildGeometryGraph(model);
      expect(graph).not.toBeNull();
    });

    console.log(`[bench] buildGeometryGraph (terrain ~20000 tri): ${t.toFixed(3)}ms`);
    expect(t).toBeLessThan(500);
  });
});

describe('Graph sharing benchmark', () => {
  it('pipeline modules share a single graph build', () => {
    const model = createIcosphereModel(2);

    const t = measureTime(() => {
      const graph = buildGeometryGraph(model);
      analyzeTopology(model, undefined, graph);
      validateMesh(model, graph);
      computeMetrics(model, graph);
      checkBedFit(model, 'bambu_x1c', graph);
      estimateSupportVolume(model, graph);
    });

    console.log(`[bench] All 5 modules with pre-built graph (${t.toFixed(3)}ms)`);
  });
});

describe('Pipeline benchmark', () => {
  it('full analysis on watertight cube', () => {
    const model = createWatertightCubeModel();

    const t = measureTime(() => {
      const graph = buildGeometryGraph(model);
      const topo = analyzeTopology(model, undefined, graph);
      const val = validateMesh(model, graph);
      const met = computeMetrics(model, graph);
      const bed = checkBedFit(model, 'bambu_x1c', graph);
      const sup = estimateSupportVolume(model, graph);

      expect(topo.result.isManifold).toBe(true);
      expect(val.result.isWatertight).toBe(true);
      expect(met.result.meshVolumeMm3).toBeCloseTo(1, 0);
    });

    console.log(`[bench] Full analysis (12 tri): ${t.toFixed(3)}ms`);
  });

  it('full analysis on icosphere', () => {
    const model = createIcosphereModel(3);

    const t = measureTime(() => {
      const met = computeMetrics(model);
      expect(met.result.meshVolumeMm3).toBeGreaterThan(0);
    });

    console.log(`[bench] Volume computation (320 tri): ${t.toFixed(3)}ms`);
  });

  it('wall thickness sampling on thin wall fixture', () => {
    const model = createThinWallModel(20);

    const t = measureTime(() => {
      const met = computeMetrics(model);
      expect(met.result.minWallThicknessMm).toBeGreaterThan(0);
    });

    console.log(`[bench] Wall thickness (thin wall): ${t.toFixed(3)}ms`);
  });
});

describe('Deterministic behavior', () => {
  it('produces identical results across runs', () => {
    const model = createWatertightCubeModel();

    const run1 = analyzeTopology(model);
    const run2 = analyzeTopology(model);

    expect(run1.result.triangleCount).toBe(run2.result.triangleCount);
    expect(run1.result.shellCount).toBe(run2.result.shellCount);
    expect(run1.result.isManifold).toBe(run2.result.isManifold);
    expect(run1.confidence).toBe(run2.confidence);
  });

  it('buildGeometryGraph is deterministic', () => {
    const model1 = createWatertightCubeModel();
    const model2 = createWatertightCubeModel();

    const g1 = buildGeometryGraph(model1);
    const g2 = buildGeometryGraph(model2);

    expect(g1!.triangleCount).toBe(g2!.triangleCount);
    expect(g1!.vertexCount).toBe(g2!.vertexCount);
    expect(g1!.edgeMap.size).toBe(g2!.edgeMap.size);
    expect(g1!.boundingBoxDimensions.x).toBe(g2!.boundingBoxDimensions.x);
  });
});

describe('Conversion overhead', () => {
  it('fromThreeBufferGeometry on watertight cube', () => {
    const geo = createWatertightCube();

    const t = measureTime(() => {
      const model = fromThreeBufferGeometry(geo);
      expect(model.positions.length).toBe(24);
      expect(model.indices.length).toBe(36);
    });

    console.log(`[bench] Conversion from Three.js (cube): ${t.toFixed(3)}ms`);
  });

  it('fromThreeBufferGeometry on terrain grid', () => {
    const geo = createTerrainGrid(10, 100, 100);

    const t = measureTime(() => {
      const model = fromThreeBufferGeometry(geo);
      expect(model.indices.length).toBeGreaterThan(0);
    });

    console.log(`[bench] Conversion from Three.js (terrain): ${t.toFixed(3)}ms`);
  });
});
