import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fromThreeBufferGeometry } from '../geometryConversion';
import { computePbfMetrics } from '../pbf';
import type { GeometryModel } from '../geometryModel';

// Welded boxes — 8 shared vertices, 12 triangles per box. `winding` picks the
// face order so normals point outward (+1) or inward (−1, for an internal
// cavity whose faces face into the void).
function box3(w: number, h: number, d: number, minZ: number, winding: 1 | -1): { pos: number[]; faces: number[][] } {
  const v = [
    [0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0],
    [0, 0, d], [w, 0, d], [w, h, d], [0, h, d],
  ].map(p => [p[0], p[1], p[2] + minZ]);
  const outward = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const inward = [[1, 2, 3, 0], [7, 6, 5, 4], [4, 5, 1, 0], [5, 6, 2, 1], [6, 7, 3, 2], [7, 4, 0, 3]];
  return { pos: v.flat(), faces: winding === 1 ? outward : inward };
}

function toModel(boxes: Array<{ pos: number[]; faces: number[][] }>): GeometryModel {
  const pos: number[] = [];
  const idx: number[] = [];
  let vOffset = 0;
  for (const b of boxes) {
    pos.push(...b.pos);
    for (const f of b.faces) idx.push(f[0] + vOffset, f[1] + vOffset, f[2] + vOffset, f[0] + vOffset, f[2] + vOffset, f[3] + vOffset);
    vOffset += b.pos.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  return fromThreeBufferGeometry(g);
}

describe('computePbfMetrics', () => {
  it('a solid cube has one shell and no powder trap', () => {
    const r = computePbfMetrics(toModel([box3(10, 10, 10, 0, 1)]), 'sls');
    expect(r.shellCount).toBe(1);
    expect(r.powderTrap).toBe(false);
  });

  it('detects an enclosed cavity (powder trap) from nested shells', () => {
    // 10 mm outer box with a 5 mm inward-wound box inside → 2 disconnected shells.
    const r = computePbfMetrics(toModel([box3(10, 10, 10, 0, 1), box3(5, 5, 5, 2.5, -1)]), 'slm');
    expect(r.shellCount).toBe(2);
    expect(r.powderTrap).toBe(true);
  });

  it('flags a large flat plate as the warpage driver', () => {
    // 40×40×1 horizontal plate → the two 40×40 faces are near-horizontal
    // (normals ±Z), 1600 mm² each out of 3360 mm² total.
    const r = computePbfMetrics(toModel([box3(40, 40, 1, 0, 1)]), 'slm');
    expect(r.largestFlatPlateMm2).toBeGreaterThan(1500);
    expect(r.flatPlateRatio).toBeGreaterThan(0.8);
    expect(r.distortionRisk).toBeGreaterThan(0.3);
  });

  it('polymer PBF is self-supporting, metal is not', () => {
    const model = toModel([box3(10, 10, 10, 0, 1)]);
    expect(computePbfMetrics(model, 'sls').selfSupporting).toBe(true);
    expect(computePbfMetrics(model, 'mjf').selfSupporting).toBe(true);
    expect(computePbfMetrics(model, 'slm').selfSupporting).toBe(false);
  });

  it('carries the kind through', () => {
    expect(computePbfMetrics(toModel([box3(10, 10, 10, 0, 1)]), 'sls').kind).toBe('sls');
    expect(computePbfMetrics(toModel([box3(10, 10, 10, 0, 1)]), 'slm').kind).toBe('slm');
  });
});
