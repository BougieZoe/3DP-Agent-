import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fromThreeBufferGeometry } from '../geometryConversion';
import { computeResinMetrics } from '../resin';

// Welded cube (8 shared vertices, 12 triangles) — like a real STL after
// vertex welding. THREE.BoxGeometry uses per-face vertices, which is an
// unrealistic edge case for printability analysis.
function weldedCube(w: number, minZ: number): { pos: Float32Array; idx: Uint32Array } {
  const h = w, d = w;
  const v = [
    [0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0],
    [0, 0, d], [w, 0, d], [w, h, d], [0, h, d],
  ].map(p => [p[0], p[1], p[2] + minZ]);
  const faces = [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
    [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ];
  const pos: number[] = [];
  for (const p of v) pos.push(...p);
  const idx: number[] = [];
  for (const f of faces) idx.push(f[0], f[1], f[2], f[0], f[2], f[3]);
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

function toModel(cube: { pos: Float32Array; idx: Uint32Array }): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(cube.pos, 3));
  g.setIndex(new THREE.BufferAttribute(cube.idx, 1));
  g.computeVertexNormals();
  return g;
}

describe('resin printability metrics', () => {
  it('a plain welded cube is 1 shell, no islands, low-ish suction risk', () => {
    const result = computeResinMetrics(fromThreeBufferGeometry(toModel(weldedCube(20, 0))));
    expect(result.shellCount).toBe(1);
    expect(result.islandCount).toBe(0);
    expect(result.enclosedCavity).toBe(false);
    expect(result.orientation).toBeDefined();
  });

  it('detects a floating disconnected cube as an island', () => {
    // bottom cube on the plate + top cube floating 10mm above
    const bottom = weldedCube(20, 0);
    const top = weldedCube(20, 40); // bottom at z=40, gap 40-20=20mm above
    const merged: { pos: Float32Array; idx: Uint32Array } = {
      pos: new Float32Array([...bottom.pos, ...top.pos]),
      idx: new Uint32Array([...bottom.idx, ...top.idx.map(i => i + 8)]),
    };
    const result = computeResinMetrics(fromThreeBufferGeometry(toModel(merged)));
    expect(result.shellCount).toBeGreaterThanOrEqual(2);
    expect(result.islandCount).toBeGreaterThanOrEqual(1);
  });
});
