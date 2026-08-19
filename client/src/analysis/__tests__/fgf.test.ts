import { describe, expect, it } from 'vitest';
import { fromThreeBufferGeometry } from '../geometryConversion';
import { computeFgfMetrics } from '../fgf';
import type { GeometryModel } from '../geometryModel';

function weldedBox(w: number, d: number, h: number, minZ = 0): GeometryModel {
  const v = [
    [0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0],
    [0, 0, h], [w, 0, h], [w, d, h], [0, d, h],
  ].map(p => [p[0], p[1], p[2] + minZ]);
  const faces = [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
    [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ];
  const pos: number[] = [];
  for (const p of v) pos.push(...p);
  const idx: number[] = [];
  for (const f of faces) idx.push(f[0], f[1], f[2], f[0], f[2], f[3]);

  // Build a plain GeometryModel directly (no THREE needed).
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(pos.length),
    indices: new Uint32Array(idx),
    vertexCount: 8,
    triangleCount: 12,
  };
}

describe('FGF large-format metrics', () => {
  it('a small cube is classified small with low warpage risk', () => {
    const r = computeFgfMetrics(weldedBox(20, 20, 20));
    expect(r.partScale).toBe('small');
    expect(r.warpageRisk).toBeLessThan(0.6);
    expect(r.maxDimMm).toBe(20);
  });

  it('a large flat plate is classified large/very-large with high warpage risk', () => {
    const r = computeFgfMetrics(weldedBox(1500, 600, 20));
    expect(['large', 'very-large']).toContain(r.partScale);
    expect(r.warpageRisk).toBeGreaterThan(0.5); // big flat top → thermal warp proxy
    expect(r.maxDimMm).toBe(1500);
  });
});
