import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BlenderAdapter } from '../blenderAdapter';

let adapter: BlenderAdapter;

beforeAll(async () => {
  adapter = new BlenderAdapter();
  await adapter.init();
}, 30000);

afterAll(async () => {
  await adapter.dispose();
});

describe('BlenderAdapter', () => {
  it('creates a cube mesh', async () => {
    const obj = await adapter.createMesh('cube', { size: 2 });
    expect(obj.name).toBeTruthy();
    expect(obj.vertexCount).toBe(8);
    expect(obj.faceCount).toBe(6);
    expect(obj.boundingBox.min).toBeDefined();
    expect(obj.boundingBox.max).toBeDefined();
  }, 15000);

  it('creates a sphere mesh', async () => {
    const obj = await adapter.createMesh('sphere', { size: 1 });
    expect(obj.vertexCount).toBeGreaterThan(100);
    expect(obj.faceCount).toBeGreaterThan(100);
  }, 15000);

  it('queries scene after creating objects', async () => {
    await adapter.createMesh('cube', { size: 1 });
    const scene = await adapter.queryScene();
    expect(scene.objects.length).toBeGreaterThanOrEqual(1);
    expect(scene.totalVertices).toBeGreaterThan(0);
  }, 15000);

  it('sets material on object', async () => {
    const obj = await adapter.createMesh('cube', { size: 1 });
    await expect(
      adapter.setMaterial(obj.name, { x: 0.8, y: 0.2, z: 0.2 }, 0.4, 0.1)
    ).resolves.not.toThrow();
  }, 15000);

  it('renders to PNG', async () => {
    const result = await adapter.render({
      width: 400,
      height: 300,
      engine: 'eevee',
      outputFormat: 'png',
    });
    expect(result.imagePath).toBeTruthy();
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
    expect(result.fileSizeBytes).toBeGreaterThan(1000);
  }, 20000);

  it('exports STL', async () => {
    await adapter.createMesh('cube', { size: 2 });
    const result = await adapter.export('/tmp/blender_adapter_test.stl', 'stl');
    expect(result.filePath).toBe('/tmp/blender_adapter_test.stl');
    expect(result.fileSizeBytes).toBeGreaterThan(100);
  }, 15000);

  it('imports and queries an STL', async () => {
    const obj = await adapter.importMesh('/tmp/blender_adapter_test.stl');
    expect(obj.vertexCount).toBe(8);
    expect(obj.faceCount).toBeGreaterThanOrEqual(6); // STL triangulates quads → 12 tris
  }, 15000);
});
