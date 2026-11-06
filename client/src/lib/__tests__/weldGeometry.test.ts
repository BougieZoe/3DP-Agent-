import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weldGeometry } from '../weldGeometry';

/** Two triangles that should share an edge but disagree in the last bits. */
function splitSeam(): THREE.BufferGeometry {
  const eps = 1e-7;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    1, 0, 0 + eps, 0, 1, 0, 0, 0, 1,
  ]), 3));
  return geo;
}

describe('weldGeometry', () => {
  it('merges near-identical vertices into shared topology', () => {
    const welded = weldGeometry(splitSeam(), 4);
    expect(welded.getIndex()!.count).toBe(6);
    // 6 raw vertices -> 4 distinct positions: (0,0,0), (1,0,0), (0,1,0), (0,0,1)
    expect(welded.getAttribute('position').count).toBe(4);
  });

  it('keeps the original triangles when nothing is weldable', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      5, 5, 5, 6, 5, 5, 5, 6, 5,
    ]), 3));
    const welded = weldGeometry(geo, 4);
    expect(welded.getIndex()!.count).toBe(6);
    expect(welded.getAttribute('position').count).toBe(6);
  });

  it('drops degenerate triangles created by welding', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0, 0, 1, 0, 0, 1e-6, 0, 0,   // collapses: b and c land on the same grid point
      0, 0, 0, 0, 1, 0, 0, 0, 1,
    ]), 3));
    const welded = weldGeometry(geo, 4);
    expect(welded.getIndex()!.count).toBe(3);
  });
});
