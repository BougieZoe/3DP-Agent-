import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadModelFile, read3mfUnits } from '../modelLoader';
import { geometryToThreeMf } from '../threeMf';

const CUBE_OBJ = `# a simple cube
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3
f 1 3 4
f 5 6 7
f 5 7 8
f 1 2 6
f 1 6 5
f 2 3 7
f 2 7 6
f 3 4 8
f 3 8 7
f 4 1 5
f 4 5 8
`;

describe('loadModelFile — multi-format', () => {
  it('parses OBJ text into a usable triangle geometry', async () => {
    const file = new File([CUBE_OBJ], 'cube.obj', { type: 'text/plain' });
    const loaded = await loadModelFile(file);
    expect(loaded.units).toBeUndefined(); // OBJ carries no units
    expect(loaded.geometry.attributes.position.count).toBeGreaterThan(0);
    // 12 faces → 36 indexed verts on a welded cube (or 36 non-indexed).
    expect(loaded.geometry.index ? loaded.geometry.index.count : loaded.geometry.attributes.position.count).toBeGreaterThanOrEqual(36);
  });

  it('reads the declared unit out of a 3MF package we export', () => {
    // geometryToThreeMf writes unit="millimeter" in the model node.
    const box = new THREE.BoxGeometry(10, 10, 10);
    const buf = geometryToThreeMf(box);
    expect(read3mfUnits(buf)).toBe('mm');
  });

  it('rejects an unsupported extension with a clear error', async () => {
    const file = new File(['garbage'], 'model.step', { type: 'text/plain' });
    await expect(loadModelFile(file)).rejects.toThrow(/STL, OBJ or 3MF/);
  });
});
