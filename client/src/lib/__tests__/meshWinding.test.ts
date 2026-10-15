import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ensureOutwardWinding } from '../meshRepair';

/** Unit cube, optionally inside-out. */
function cube(flipped: boolean): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const idx = Array.from(g.index!.array as ArrayLike<number>);
  if (flipped) {
    for (let f = 0; f < idx.length; f += 3) {
      const t = idx[f + 1];
      idx[f + 1] = idx[f + 2];
      idx[f + 2] = t;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position.clone());
  out.setIndex(idx);
  return out;
}

describe('ensureOutwardWinding', () => {
  it('leaves a correct cube alone', () => {
    expect(ensureOutwardWinding(cube(false))).toBe(false);
  });

  it('flips an inside-out cube', () => {
    const g = cube(true);
    expect(ensureOutwardWinding(g)).toBe(true);
    // Second call: already correct, no-op.
    expect(ensureOutwardWinding(g)).toBe(false);
  });

  it('rejects garbage without throwing', () => {
    expect(ensureOutwardWinding(new THREE.BufferGeometry())).toBe(false);
  });
});
