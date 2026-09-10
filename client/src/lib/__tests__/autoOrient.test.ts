import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { autoOrientGeometry } from '../autoOrient';

function sizes(g: THREE.BufferGeometry): [number, number, number] {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  return [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
}

/** Flat box seated on the plate, like a caller-normalized model. */
function flatBox(sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(0, 0, sz / 2);
  return g;
}

/** Synthetic wall_tower: 60×20×3 base + six thin walls (0.4–2.0) along Y. */
function wallTowerLike(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.BoxGeometry(60, 20, 3);
  base.translate(0, 0, 1.5);
  parts.push(base);
  const thicknesses = [0.4, 0.6, 0.8, 1.0, 1.5, 2.0];
  const gap = (60 - thicknesses.reduce((s, t) => s + t, 0)) / 7;
  let x = -30 + gap;
  for (const t of thicknesses) {
    const wall = new THREE.BoxGeometry(t, 16, 25);
    wall.translate(x + t / 2, 0, 3 + 12.5);
    parts.push(wall);
    x += t + gap;
  }
  return mergeGeometries(parts)!;
}

describe('autoOrientGeometry', () => {
  it('leaves an already-flat wall tower alone (no X↔Z swap)', () => {
    const [x, y, z] = sizes(autoOrientGeometry(wallTowerLike()));
    expect(x).toBeCloseTo(60, 8);
    expect(y).toBeCloseTo(20, 8);
    expect(z).toBeCloseTo(28, 8);
  });

  it('leaves a flat box and a cube untouched', () => {
    expect(sizes(autoOrientGeometry(flatBox(60, 20, 28)))).toEqual([
      expect.closeTo(60, 8),
      expect.closeTo(20, 8),
      expect.closeTo(28, 8),
    ]);
    expect(sizes(autoOrientGeometry(flatBox(20, 20, 20)))).toEqual([
      expect.closeTo(20, 8),
      expect.closeTo(20, 8),
      expect.closeTo(20, 8),
    ]);
  });

  it('lays a tall standing box flat', () => {
    const [x, y, z] = sizes(autoOrientGeometry(flatBox(28, 20, 60)));
    expect(z).toBeCloseTo(20, 8); // thinnest horizontal extent becomes height
    expect(x * y).toBeCloseTo(28 * 60, 6);
  });

  it('lays a thin plate flat no matter which way it starts', () => {
    const rotations: Array<(g: THREE.BufferGeometry) => void> = [
      (g) => {},
      (g) => g.rotateX(Math.PI / 2),
      (g) => g.rotateX(-Math.PI / 2),
      (g) => g.rotateY(Math.PI / 2),
      (g) => g.rotateY(-Math.PI / 2),
      (g) => g.rotateX(Math.PI),
    ];
    for (const rotate of rotations) {
      const g = new THREE.BoxGeometry(60, 40, 2);
      rotate(g);
      g.computeBoundingBox();
      g.translate(0, 0, -g.boundingBox!.min.z); // seat on plate like normalize does
      expect(sizes(autoOrientGeometry(g))[2]).toBeCloseTo(2, 8);
    }
  });

  it('handles non-indexed geometry', () => {
    const g = new THREE.BoxGeometry(60, 20, 28).toNonIndexed();
    g.translate(0, 0, 14);
    const [x, y, z] = sizes(autoOrientGeometry(g));
    expect(x).toBeCloseTo(60, 8);
    expect(y).toBeCloseTo(20, 8);
    expect(z).toBeCloseTo(28, 8);
  });
});
