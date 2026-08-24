/**
 * SlicerBridge Integration Tests
 *
 * Tests the slicerBridge module with real PrusaSlicer CLI.
 * These tests require PrusaSlicer to be installed at the expected path.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createSlicerAdapter,
  dropStlToBed,
  parseGCodeMetadata,
  parseLayers,
  type SlicerProfile,
} from '../slicerBridge';

const PRUSASLICER_PATH = '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer';
const TEST_STL_PATH = path.join(import.meta.dirname, '__fixtures__', 'test_cube.stl');

describe('SlicerBridge', () => {
  let prusaSlicerAvailable = false;

  beforeAll(async () => {
    // Check if PrusaSlicer is available
    const profile: SlicerProfile = {
      id: 'prusaslicer',
      binary: PRUSASLICER_PATH,
    };
    const adapter = createSlicerAdapter(profile);
    prusaSlicerAvailable = await adapter.isAvailable();
    console.log(`PrusaSlicer available: ${prusaSlicerAvailable}`);
  });

  describe('dropStlToBed', () => {
    it('should handle empty buffer', () => {
      const empty = new Uint8Array(0);
      const result = dropStlToBed(empty);
      expect(result).toBe(empty);
    });

    it('should handle buffer too small for header', () => {
      const small = new Uint8Array(80);
      const result = dropStlToBed(small);
      expect(result).toBe(small);
    });

    it('should translate mesh so minZ = 0', () => {
      // Create a simple STL with vertices above Z=0
      const stlBytes = createTestStlWithOffset(5.0);
      const result = dropStlToBed(stlBytes);
      // Result should be different from input (translated)
      expect(result).not.toBe(stlBytes);
    });

    it('should not translate if already on bed', () => {
      // Create a simple STL with vertices starting at Z=0 (minZ = 0)
      const stlBytes = createTestStlOnBed();
      const result = dropStlToBed(stlBytes);
      expect(result).toBe(stlBytes);
    });
  });

  describe('parseGCodeMetadata', () => {
    it('should parse PrusaSlicer metadata', () => {
      const gcode = `
; estimated printing time (normal mode) = 13m 54s
; filament used [g] = 0.79
; layer_height = 0.3
; total layers count = 32
`;
      const metadata = parseGCodeMetadata(gcode);
      expect(metadata.printTimeMinutes).toBeCloseTo(13.9, 1);
      expect(metadata.filamentGrams).toBe(0.79);
      expect(metadata.layerCount).toBe(32);
      expect(metadata.layerHeightMm).toBe(0.3);
    });

    it('should handle missing fields gracefully', () => {
      const gcode = `; some random comment`;
      const metadata = parseGCodeMetadata(gcode);
      expect(metadata.printTimeMinutes).toBe(0);
      expect(metadata.filamentGrams).toBe(0);
      expect(metadata.layerCount).toBe(0);
      expect(metadata.layerHeightMm).toBeNull();
    });

    it('should parse different time formats', () => {
      expect(parseGCodeMetadata('; estimated printing time (normal mode) = 1h 2m 3s').printTimeMinutes).toBeCloseTo(62.05, 1);
      expect(parseGCodeMetadata('; estimated printing time (normal mode) = 42s').printTimeMinutes).toBeCloseTo(0.7, 1);
      expect(parseGCodeMetadata('; estimated printing time (normal mode) = 27m 25s').printTimeMinutes).toBeCloseTo(27.42, 1);
    });

    it('should parse total filament used format', () => {
      const gcode = `
; total filament used [g] = 5.23
; filament used [mm] = 1493.99
`;
      const metadata = parseGCodeMetadata(gcode);
      expect(metadata.filamentGrams).toBe(5.23);
    });
  });

  describe('parseLayers', () => {
    it('should parse PrusaSlicer 2.9+ layer format', () => {
      const gcode = `
;LAYER_CHANGE
;Z:0.35
G1 Z0.35
;LAYER_CHANGE
;Z:0.65
G1 Z0.65
;LAYER_CHANGE
;Z:0.95
G1 Z0.95
`;
      const layers = parseLayers(gcode);
      expect(layers).toHaveLength(3);
      expect(layers[0].zMm).toBe(0.35);
      expect(layers[0].heightMm).toBe(0);
      expect(layers[1].zMm).toBe(0.65);
      expect(layers[1].heightMm).toBeCloseTo(0.3, 2);
      expect(layers[2].zMm).toBe(0.95);
      expect(layers[2].heightMm).toBeCloseTo(0.3, 2);
    });

    it('should parse legacy ;LAYER:n format', () => {
      const gcode = `
;LAYER:0
;Z:0.35
G1 Z0.35
;LAYER:1
;Z:0.65
G1 Z0.65
`;
      const layers = parseLayers(gcode);
      expect(layers).toHaveLength(2);
      expect(layers[0].layerNumber).toBe(0);
      expect(layers[0].zMm).toBe(0.35);
      expect(layers[1].layerNumber).toBe(1);
      expect(layers[1].zMm).toBe(0.65);
    });

    it('should handle empty gcode', () => {
      const layers = parseLayers('');
      expect(layers).toHaveLength(0);
    });
  });

  describe('SlicerAdapter', () => {
    it.skipIf(!prusaSlicerAvailable)('should slice STL to G-code', async () => {
      const stlBytes = await readFile(TEST_STL_PATH);
      const profile: SlicerProfile = {
        id: 'prusaslicer',
        binary: PRUSASLICER_PATH,
      };
      const adapter = createSlicerAdapter(profile);

      const result = await adapter.slice({
        stlBytes,
        fileName: 'test_cube.stl',
        profile,
        autoDropToBed: true,
      });

      expect(result.gcode).toBeTruthy();
      expect(result.metadata.printTimeMinutes).toBeGreaterThan(0);
      expect(result.metadata.layerCount).toBeGreaterThan(0);
      expect(result.layers.length).toBeGreaterThan(0);
    });

    it.skipIf(!prusaSlicerAvailable)('should detect available slicer', async () => {
      const profile: SlicerProfile = {
        id: 'prusaslicer',
        binary: PRUSASLICER_PATH,
      };
      const adapter = createSlicerAdapter(profile);
      const available = await adapter.isAvailable();
      expect(available).toBe(true);
    });

    it('should reject non-absolute binary path', async () => {
      const profile: SlicerProfile = {
        id: 'prusaslicer',
        binary: 'prusaslicer', // Not absolute
      };
      const adapter = createSlicerAdapter(profile);

      await expect(
        adapter.slice({
          stlBytes: new Uint8Array(100),
          profile,
        }),
      ).rejects.toThrow('Refusing to run non-absolute slicer binary');
    });
  });
});

/**
 * Helper to create a simple binary STL with vertices offset by a given Z value.
 */
function createTestStlWithOffset(zOffset: number): Uint8Array {
  const size = 20;
  const half = size / 2;

  // Simple cube vertices
  const vertices = [
    [-half, -half, -half + zOffset],
    [half, -half, -half + zOffset],
    [half, half, -half + zOffset],
    [-half, half, -half + zOffset],
    [-half, -half, half + zOffset],
    [half, -half, half + zOffset],
    [half, half, half + zOffset],
    [-half, half, half + zOffset],
  ];

  // 12 triangles (2 per face)
  const triangles = [
    [0, 2, 1], [0, 3, 2], // Bottom
    [4, 5, 6], [4, 6, 7], // Top
    [0, 1, 5], [0, 5, 4], // Front
    [2, 3, 7], [2, 7, 6], // Back
    [0, 4, 7], [0, 7, 3], // Left
    [1, 2, 6], [1, 6, 5], // Right
  ];

  // Binary STL: 80 header + 4 count + 12 triangles * 50 bytes each
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);

  // Header (80 bytes of zeros)
  // Triangle count
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const tri of triangles) {
    // Normal vector (will be computed by slicer)
    view.setFloat32(offset, 0, true);
    view.setFloat32(offset + 4, 0, true);
    view.setFloat32(offset + 8, 0, true);

    // Vertices
    for (let i = 0; i < 3; i++) {
      const [x, y, z] = vertices[tri[i]];
      view.setFloat32(offset + 12 + i * 12, x, true);
      view.setFloat32(offset + 16 + i * 12, y, true);
      view.setFloat32(offset + 20 + i * 12, z, true);
    }

    // Attribute byte count
    view.setUint16(offset + 48, 0, true);

    offset += 50;
  }

  return new Uint8Array(buffer);
}

/**
 * Helper to create a simple binary STL with vertices starting at Z=0 (on bed).
 */
function createTestStlOnBed(): Uint8Array {
  const size = 20;
  const half = size / 2;

  // Simple cube vertices starting at Z=0
  const vertices = [
    [-half, -half, 0],
    [half, -half, 0],
    [half, half, 0],
    [-half, half, 0],
    [-half, -half, size],
    [half, -half, size],
    [half, half, size],
    [-half, half, size],
  ];

  // 12 triangles (2 per face)
  const triangles = [
    [0, 2, 1], [0, 3, 2], // Bottom
    [4, 5, 6], [4, 6, 7], // Top
    [0, 1, 5], [0, 5, 4], // Front
    [2, 3, 7], [2, 7, 6], // Back
    [0, 4, 7], [0, 7, 3], // Left
    [1, 2, 6], [1, 6, 5], // Right
  ];

  // Binary STL: 80 header + 4 count + 12 triangles * 50 bytes each
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);

  // Header (80 bytes of zeros)
  // Triangle count
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const tri of triangles) {
    // Normal vector (will be computed by slicer)
    view.setFloat32(offset, 0, true);
    view.setFloat32(offset + 4, 0, true);
    view.setFloat32(offset + 8, 0, true);

    // Vertices
    for (let i = 0; i < 3; i++) {
      const [x, y, z] = vertices[tri[i]];
      view.setFloat32(offset + 12 + i * 12, x, true);
      view.setFloat32(offset + 16 + i * 12, y, true);
      view.setFloat32(offset + 20 + i * 12, z, true);
    }

    // Attribute byte count
    view.setUint16(offset + 48, 0, true);

    offset += 50;
  }

  return new Uint8Array(buffer);
}
