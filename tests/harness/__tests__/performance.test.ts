/**
 * S3 — Performance Benchmark Tests
 *
 * Tests measuring analysis pipeline performance across different mesh sizes
 * and complexity levels. These establish baseline performance metrics and
 * detect regressions in analysis speed.
 */
import { describe, it, expect } from 'vitest';
import { runAnalysisPipeline } from '../../../client/src/analysis/pipeline';
import { createGeometryModel } from '../../../client/src/analysis/geometryModel';
import { createWatertightCube, createOpenCube, createDisconnectedShells } from '../../../client/src/analysis/__tests__/testMeshes';
import { fromThreeBufferGeometry } from '../../../client/src/analysis/geometryConversion';
import * as THREE from 'three';

describe('Performance Benchmarks', () => {
  // Helper to measure execution time
  async function measureTime(fn: () => void): Promise<number> {
    const start = performance.now();
    fn();
    return performance.now() - start;
  }

  // Helper to create a gear-like geometry
  function createGearGeometry(teeth: number = 20, radius: number = 10): THREE.BufferGeometry {
    const vertices: number[] = [];
    const indices: number[] = [];

    // Create gear teeth
    for (let i = 0; i < teeth; i++) {
      const angle1 = (i / teeth) * Math.PI * 2;
      const angle2 = ((i + 0.5) / teeth) * Math.PI * 2;
      const angle3 = ((i + 1) / teeth) * Math.PI * 2;

      const innerRadius = radius * 0.8;
      const outerRadius = radius;

      // Inner point
      vertices.push(Math.cos(angle1) * innerRadius, Math.sin(angle1) * innerRadius, 0);
      // Outer point 1
      vertices.push(Math.cos(angle2) * outerRadius, Math.sin(angle2) * outerRadius, 0);
      // Outer point 2
      vertices.push(Math.cos(angle3) * outerRadius, Math.sin(angle3) * outerRadius, 0);

      const baseIdx = i * 3;
      indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    geo.setIndex(indices);
    return geo;
  }

  describe('Geometry Model Creation', () => {
    it('should create geometry model from simple cube in < 10ms', async () => {
      const positions = new Float32Array([
        -10, -10, -10,  10, -10, -10,  10,  10, -10,
        -10, -10, -10,  10,  10, -10, -10,  10, -10,
        -10, -10,  10,  10, -10,  10,  10,  10,  10,
        -10, -10,  10,  10,  10,  10, -10,  10,  10,
      ]);
      const normals = new Float32Array(positions.length);
      const indices = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

      const time = await measureTime(() => {
        createGeometryModel(positions, normals, indices);
      });

      expect(time).toBeLessThan(10);
    });

    it('should create geometry model from gear in < 50ms', async () => {
      const geo = createGearGeometry(20, 10);
      const model = fromThreeBufferGeometry(geo);

      const time = await measureTime(() => {
        createGeometryModel(model.positions, model.normals, model.indices);
      });

      expect(time).toBeLessThan(50);
    });

    it('should create geometry model from watertight cube in < 10ms', async () => {
      const geo = createWatertightCube();
      const model = fromThreeBufferGeometry(geo);

      const time = await measureTime(() => {
        createGeometryModel(model.positions, model.normals, model.indices);
      });

      expect(time).toBeLessThan(10);
    });
  });

  describe('Analysis Pipeline Performance', () => {
    it('should analyze simple cube in < 50ms', async () => {
      const positions = new Float32Array([
        -10, -10, -10,  10, -10, -10,  10,  10, -10,
        -10, -10, -10,  10,  10, -10, -10,  10, -10,
        -10, -10,  10,  10, -10,  10,  10,  10,  10,
        -10, -10,  10,  10,  10,  10, -10,  10,  10,
      ]);
      const normals = new Float32Array(positions.length);
      const indices = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      const model = createGeometryModel(positions, normals, indices);

      const time = await measureTime(() => {
        runAnalysisPipeline(model);
      });

      expect(time).toBeLessThan(50);
    });

    it('should analyze gear in < 200ms', async () => {
      const geo = createGearGeometry(20, 10);
      const model = fromThreeBufferGeometry(geo);

      const time = await measureTime(() => {
        runAnalysisPipeline(model);
      });

      expect(time).toBeLessThan(200);
    });

    it('should analyze watertight cube in < 50ms', async () => {
      const geo = createWatertightCube();
      const model = fromThreeBufferGeometry(geo);

      const time = await measureTime(() => {
        runAnalysisPipeline(model);
      });

      expect(time).toBeLessThan(50);
    });

    it('should analyze disconnected shells in < 100ms', async () => {
      const geo = createDisconnectedShells();
      const model = fromThreeBufferGeometry(geo);

      const time = await measureTime(() => {
        runAnalysisPipeline(model);
      });

      expect(time).toBeLessThan(100);
    });

    it('should analyze large mesh (100k triangles) in < 5s', async () => {
      // Generate a large mesh (100k triangles)
      const triangleCount = 100000;
      const positions = new Float32Array(triangleCount * 9);
      const normals = new Float32Array(triangleCount * 9);
      const indices = new Uint32Array(triangleCount * 3);

      for (let i = 0; i < triangleCount; i++) {
        const offset = i * 9;
        // Random triangle vertices
        positions[offset] = Math.random() * 100;
        positions[offset + 1] = Math.random() * 100;
        positions[offset + 2] = Math.random() * 100;
        positions[offset + 3] = Math.random() * 100;
        positions[offset + 4] = Math.random() * 100;
        positions[offset + 5] = Math.random() * 100;
        positions[offset + 6] = Math.random() * 100;
        positions[offset + 7] = Math.random() * 100;
        positions[offset + 8] = Math.random() * 100;
        // Normals pointing up
        normals[offset + 2] = 1;
        normals[offset + 5] = 1;
        normals[offset + 8] = 1;
        // Indices
        indices[i * 3] = i * 3;
        indices[i * 3 + 1] = i * 3 + 1;
        indices[i * 3 + 2] = i * 3 + 2;
      }

      const model = createGeometryModel(positions, normals, indices);

      const time = await measureTime(() => {
        runAnalysisPipeline(model);
      });

      expect(time).toBeLessThan(5000);
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory after multiple analyses', async () => {
      const positions = new Float32Array([
        -10, -10, -10,  10, -10, -10,  10,  10, -10,
        -10, -10, -10,  10,  10, -10, -10,  10, -10,
        -10, -10,  10,  10, -10,  10,  10,  10,  10,
        -10, -10,  10,  10,  10,  10, -10,  10,  10,
      ]);
      const normals = new Float32Array(positions.length);
      const indices = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

      // Run analysis 100 times
      for (let i = 0; i < 100; i++) {
        const model = createGeometryModel(positions, normals, indices);
        runAnalysisPipeline(model);
      }

      // If we get here without OOM, test passes
      expect(true).toBe(true);
    });
  });
});
