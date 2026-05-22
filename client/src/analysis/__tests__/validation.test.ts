import { describe, it, expect } from 'vitest';
import {
  createWatertightCubeModel,
  createOpenCubeModel,
  createCubeWithInvertedNormalsModel,
  createSingleTriangleModel,
} from './testMeshes';
import { validateMesh } from '../validation';

describe('validateMesh', () => {
  describe('watertight', () => {
    it('reports cube as watertight', () => {
      const model = createWatertightCubeModel();
      const result = validateMesh(model);
      expect(result.result.isWatertight).toBe(true);
      expect(result.result.holeCount).toBe(0);
      expect(result.result.boundaryEdgeCount).toBe(0);
    });

    it('reports open cube as not watertight', () => {
      const model = createOpenCubeModel();
      const result = validateMesh(model);
      expect(result.result.isWatertight).toBe(false);
      expect(result.result.holeCount).toBeGreaterThanOrEqual(1);
      expect(result.result.boundaryEdgeCount).toBeGreaterThan(0);
    });
  });

  describe('flipped normals', () => {
    it('detects no flipped normals in watertight cube', () => {
      const model = createWatertightCubeModel();
      const result = validateMesh(model);
      expect(result.result.flippedNormalFaceCount).toBe(0);
    });

    it('detects flipped normals on inverted face', () => {
      const model = createCubeWithInvertedNormalsModel();
      const result = validateMesh(model);
      expect(result.result.flippedNormalFaceCount).toBeGreaterThan(0);
      expect(result.result.flippedNormalRatio).toBeGreaterThan(0);
    });
  });

  describe('degenerate faces', () => {
    it('reports 0 degenerate faces for cube', () => {
      const model = createWatertightCubeModel();
      const result = validateMesh(model);
      expect(result.result.degenerateFaceCount).toBe(0);
    });

    it('handles single triangle (all boundary)', () => {
      const model = createSingleTriangleModel();
      const result = validateMesh(model);
      expect(result.result.isWatertight).toBe(false);
      expect(result.result.boundaryEdgeCount).toBeGreaterThan(0);
    });
  });

  describe('normal orientation', () => {
    it('reports consistent_outward for cube', () => {
      const model = createWatertightCubeModel();
      const result = validateMesh(model);
      expect(result.result.normalOrientation).toBe('consistent_outward');
    });
  });

  describe('confidence', () => {
    it('returns high confidence for clean cube', () => {
      const model = createWatertightCubeModel();
      const result = validateMesh(model);
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('returns explanation', () => {
      const model = createWatertightCubeModel();
      const result = validateMesh(model);
      expect(result.explanation.length).toBeGreaterThan(0);
      expect(result.explanation).toContain('watertight');
    });
  });
});
