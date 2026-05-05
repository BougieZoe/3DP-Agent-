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

    it('should export analyzeModel function', () => {
      expect(typeof stlLoader.analyzeModel).toBe('function');
    });

    it('should export createMeshFromGeometry function', () => {
      expect(typeof stlLoader.createMeshFromGeometry).toBe('function');
    });
  });

  describe('analyzeModel', () => {
    const createMockGeometry = (overhangRatio: number = 0.05) => {
      const positionArray = new Float32Array(270);
      const normalArray = new Float32Array(270);

      for (let i = 0; i < normalArray.length; i += 3) {
        const isOverhang = Math.random() < overhangRatio;
        const angle = isOverhang ? 50 : 10;
        const rad = (angle * Math.PI) / 180;
        normalArray[i] = 0;
        normalArray[i + 1] = Math.cos(rad);
        normalArray[i + 2] = Math.sin(rad);
      }

      return {
        setAttribute: vi.fn(),
        getAttribute: vi.fn().mockImplementation((name: string) => {
          if (name === 'position') return { array: positionArray };
          if (name === 'normal') return { array: normalArray };
          return null;
        }),
        computeVertexNormals: vi.fn(),
        computeBoundingBox: vi.fn(),
        computeBoundingSphere: vi.fn(),
        boundingBox: {
          min: { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }) },
          max: { x: 100, y: 50, z: 25, clone: () => ({ x: 100, y: 50, z: 25 }) },
          getSize: (target: any) => { target.x = 100; target.y = 50; target.z = 25; },
        },
      };
    };

    it('should return analysis result with all required fields', () => {
      const geometry = createMockGeometry();
      const result = stlLoader.analyzeModel(geometry as any);

      expect(result).toHaveProperty('wallThickness');
      expect(result).toHaveProperty('overhang');
      expect(result).toHaveProperty('volume');
      expect(result).toHaveProperty('surfaceArea');
      expect(result).toHaveProperty('bounds');
    });

    it('should calculate volume based on bounding box', () => {
      const geometry = createMockGeometry();
      const result = stlLoader.analyzeModel(geometry as any);

      expect(result.volume).toBe(100 * 50 * 25);
    });

    it('should return positive surface area', () => {
      const geometry = createMockGeometry();
      const result = stlLoader.analyzeModel(geometry as any);

      expect(result.surfaceArea).toBeGreaterThan(0);
    });

    it('should analyze wall thickness with status', () => {
      const geometry = createMockGeometry();
      const result = stlLoader.analyzeModel(geometry as any);

      expect(result.wallThickness).toHaveProperty('minThickness');
      expect(result.wallThickness).toHaveProperty('status');
      expect(result.wallThickness).toHaveProperty('areas');
      expect(['good', 'warning', 'critical']).toContain(result.wallThickness.status);
    });

    it('should analyze overhang with status', () => {
      const geometry = createMockGeometry();
      const result = stlLoader.analyzeModel(geometry as any);

      expect(result.overhang).toHaveProperty('angle');
      expect(result.overhang).toHaveProperty('areas');
      expect(result.overhang).toHaveProperty('status');
      expect(['good', 'warning', 'critical']).toContain(result.overhang.status);
    });

    it('should return good overhang status for low overhang ratio', () => {
      const geometry = createMockGeometry(0.05);
      const result = stlLoader.analyzeModel(geometry as any);

      expect(result.overhang.status).toBe('good');
    });

    it('should return warning overhang status for high overhang ratio', () => {
      const geometry = createMockGeometry(0.5);
      const result = stlLoader.analyzeModel(geometry as any);

      expect(result.overhang.status).toBe('warning');
    });

    it('should have correct bounds structure', () => {
      const geometry = createMockGeometry();
      const result = stlLoader.analyzeModel(geometry as any);

      expect(result.bounds.min).toBeDefined();
      expect(result.bounds.max).toBeDefined();
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