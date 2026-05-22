import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to mock THREE.js before importing stlLoader
// Use a simple approach - just mock the functions we need

const mockVector3 = {
  x: 0,
  y: 0,
  z: 0,
  clone: function() { return { x: this.x, y: this.y, z: this.z }; },
  subVectors: function() { return mockVector3; },
  crossVectors: function() { return { length: function() { return 1; } }; },
  getSize: function(target: any) { target.x = 100; target.y = 50; target.z = 25; },
};

vi.mock('three', () => ({
  default: {
    BufferGeometry: vi.fn().mockImplementation(() => ({
      setAttribute: vi.fn(),
      getAttribute: vi.fn().mockReturnValue({ array: new Float32Array(270) }),
      computeVertexNormals: vi.fn(),
      computeBoundingBox: vi.fn(),
      computeBoundingSphere: vi.fn(),
      boundingBox: {
        min: { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }) },
        max: { x: 100, y: 50, z: 25, clone: () => ({ x: 100, y: 50, z: 25 }) },
        getSize: (target: any) => { target.x = 100; target.y = 50; target.z = 25; },
      },
    })),
    Mesh: vi.fn().mockImplementation(() => ({
      castShadow: true,
      receiveShadow: true,
    })),
    MeshPhongMaterial: vi.fn().mockReturnValue({}),
    DoubleSide: 2,
  },
  Mesh: vi.fn().mockImplementation(() => ({ castShadow: true, receiveShadow: true })),
  MeshPhongMaterial: vi.fn().mockReturnValue({}),
  DoubleSide: 2,
  Vector3: vi.fn().mockImplementation(() => mockVector3),
}));

// Import after mocking
import * as stlLoader from '../stlLoader';

describe('stlLoader', () => {
  describe('exports', () => {
    it('should export loadSTLFile function', () => {
      expect(typeof stlLoader.loadSTLFile).toBe('function');
    });

    it('should export createMeshFromGeometry function', () => {
      expect(typeof stlLoader.createMeshFromGeometry).toBe('function');
    });
  });

  describe('createMeshFromGeometry', () => {
    it('should return a mesh object', () => {
      const mockGeometry = {
        setAttribute: vi.fn(),
        getAttribute: vi.fn(),
        computeVertexNormals: vi.fn(),
        computeBoundingBox: vi.fn(),
      } as any;

      const mesh = stlLoader.createMeshFromGeometry(mockGeometry);

      expect(mesh).toBeDefined();
      expect(typeof mesh).toBe('object');
    });
  });
});
