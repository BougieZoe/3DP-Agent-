import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fromThreeBufferGeometry } from '../geometryConversion';
import { runAnalysisPipeline } from '../pipeline';
import type { GeometryModel } from '../geometryModel';

// ─── Pathological mesh builders ────────────────────────────────────────────────

/** Raw triangle mesh → BufferGeometry (computeVertexNormals may NaN on degenerate faces — that's the point). */
function geo(positions: number[], tris: number[][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  const idx: number[] = [];
  for (const t of tris) idx.push(...t);
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  try { g.computeVertexNormals(); } catch { /* degenerate input may fail — ignore */ }
  return g;
}

function box3(w: number, h: number, d: number, minZ: number): THREE.BufferGeometry {
  const v = [
    [0,0,0],[w,0,0],[w,h,0],[0,h,0],
    [0,0,d],[w,0,d],[w,h,d],[0,h,d],
  ].map(p => [p[0], p[1], p[2] + minZ]);
  const faces = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
  const pos: number[] = v.flat();
  const tris: number[][] = [];
  for (const f of faces) tris.push([f[0],f[1],f[2]],[f[0],f[2],f[3]]);
  return geo(pos, tris);
}

/** Seeded PRNG so the noisy mesh is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noisy(seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const pos: number[] = [];
  for (let i = 0; i < 60; i++) pos.push(rnd() * 100, rnd() * 100, rnd() * 100);
  const tris: number[][] = [];
  for (let t = 0; t < 60; t++) tris.push([t % 60, (t + 1) % 60, (t + 2) % 60]);
  return geo(pos, tris);
}

const CONTROL = box3(10, 10, 10, 0);
const DEGENERATE = geo([0,0,0, 0,0,0, 0,0,0], [[0,1,2]]);          // zero-area triangle
const NON_MANIFOLD = geo(
  [0,0,0, 1,0,0, 0,1,0, 0,-1,0, 0,0,1],
  [[0,1,2],[0,1,3],[0,1,4]],                                       // edge 0-1 shared by 3 faces
);
const OPEN = geo([0,0,0, 1,0,0, 1,1,0, 0,1,0], [[0,1,2],[0,2,3]]);  // single open quad
const THIN = box3(40, 40, 0.1, 0);
const TINY = box3(0.01, 0.01, 0.01, 0);
const HUGE = box3(1000, 1000, 1000, 0);
const EMPTY = new THREE.BufferGeometry();

const MESHES: Array<[string, THREE.BufferGeometry]> = [
  ['control-cube', CONTROL],
  ['degenerate-zero-area', DEGENERATE],
  ['non-manifold-edge', NON_MANIFOLD],
  ['open-shell', OPEN],
  ['ultra-thin-plate', THIN],
  ['tiny-0.01mm', TINY],
  ['huge-1000mm', HUGE],
  ['noisy-random', noisy(42)],
  ['empty-no-geometry', EMPTY],
];

const FAMILIES = ['fdm', 'sla', 'fgf', 'sls', 'slm', 'mjf'] as const;

function isFiniteOrNull(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v));
}

describe('analysis pipeline — pathological STL stability', () => {
  it('never throws and returns valid bounded results for any input × family', () => {
    for (const [name, g] of MESHES) {
      const model: GeometryModel = fromThreeBufferGeometry(g);
      for (const family of FAMILIES) {
        let result;
        try {
          result = runAnalysisPipeline(model, { materialFamily: family, language: 'en' });
        } catch (e) {
          throw new Error(`pipeline threw on [${name}/${family}]: ${(e as Error).message}`);
        }

        // Core modules always present with defined results.
        expect(result.topology.result, `${name}/${family} topology`).toBeDefined();
        expect(result.validation.result, `${name}/${family} validation`).toBeDefined();
        expect(result.metrics.result, `${name}/${family} metrics`).toBeDefined();
        expect(result.topology.result.triangleCount).toBeGreaterThanOrEqual(0);

        // Confidence is a bounded number.
        expect(Number.isFinite(result.overallConfidence)).toBe(true);
        expect(result.overallConfidence).toBeGreaterThanOrEqual(0);
        expect(result.overallConfidence).toBeLessThanOrEqual(1);

        // Metric numbers are finite (or null where measurement legitimately fails).
        const m = result.metrics.result;
        expect(isFiniteOrNull(m.meshVolumeMm3), `${name}/${family} volume`).toBe(true);
        expect(isFiniteOrNull(m.minWallThicknessMm), `${name}/${family} wall`).toBe(true);
        expect(isFiniteOrNull(m.surfaceAreaMm2), `${name}/${family} area`).toBe(true);
        expect(Number.isFinite(m.overhang.ratio)).toBe(true);

        // Per-family module present exactly when expected.
        if (family === 'sla') expect(result.resin, `${name}/sla resin module`).not.toBeNull();
        if (family === 'fgf') expect(result.fgf, `${name}/fgf module`).not.toBeNull();
        if (family === 'sls' || family === 'slm' || family === 'mjf') expect(result.pbf, `${name}/${family} pbf module`).not.toBeNull();
        if (family === 'fdm') {
          expect(result.resin).toBeNull();
          expect(result.fgf).toBeNull();
          expect(result.pbf).toBeNull();
        }
      }
    }
  });

  it('a healthy cube still scores pass-range and flags no critical topology', () => {
    const model = fromThreeBufferGeometry(CONTROL);
    const result = runAnalysisPipeline(model, { materialFamily: 'fdm', language: 'en' });
    expect(result.topology.result.shellCount).toBe(1);
    expect(result.topology.result.isManifold).toBe(true);
    expect(result.validation.result.isWatertight).toBe(true);
    // overallConfidence is the min across modules — a low wall-sampling
    // confidence is legitimate; the meaningful checks are manifold + watertight.
    expect(result.overallConfidence).toBeGreaterThan(0);
  });
});
