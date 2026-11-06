#!/usr/bin/env node
/**
 * Feasibility check: can a true (solid) offset run in the browser?
 *
 * Not product code. This exists so the decision recorded in AGENTS.md
 * ("Rejected: client-side true offset") stays reproducible instead of
 * becoming folklore.
 *
 * It measures two things on a real STL:
 *   1. manifold 3.5.1 exposes no 3D offset (only CrossSection.offset, 2D).
 *   2. Minkowski sum with a sphere IS a correct ball offset (bounding box
 *      grows by exactly 2r) — but its cost is prohibitive at model scale.
 *
 * Usage:
 *   node scripts/verify-offset-feasibility.mjs path/to/model.stl [targetMm]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve('manifold-3d/manifold.js'));

const Module = (await import(path.join(pkgDir, 'manifold.js'))).default;
const m = await Module({ locateFile: () => path.join(pkgDir, 'manifold.wasm') });
m.setup();

const has3dOffset = typeof m.Manifold.prototype.offset === 'function';
console.log(`3D offset available: ${has3dOffset}`);

function parseBinarySTL(file) {
  const buf = readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(80, true);
  if (buf.byteLength !== 84 + n * 50) throw new Error('not a binary STL');
  const pos = [];
  const seen = new Map();
  const tris = [];
  for (let i = 0; i < n; i++) {
    const base = 84 + i * 50 + 12;
    const tri = [];
    for (let v = 0; v < 3; v++) {
      const x = dv.getFloat32(base + v * 12, true);
      const y = dv.getFloat32(base + v * 12 + 4, true);
      const z = dv.getFloat32(base + v * 12 + 8, true);
      const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
      let id = seen.get(k);
      if (id === undefined) { id = pos.length / 3; seen.set(k, id); pos.push(x, y, z); }
      tri.push(id);
    }
    tris.push(tri);
  }
  return { vertProperties: new Float32Array(pos), triVerts: new Uint32Array(tris.flat()) };
}

const file = process.argv[2];
const targetMm = Number(process.argv[3] ?? 0.8);
if (!file) {
  console.log('No STL given — API check only.');
  process.exit(0);
}

const { vertProperties, triVerts } = parseBinarySTL(file);
let solid;
try {
  solid = new m.Manifold(new m.Mesh({ numProp: 3, vertProperties, triVerts, runIndex: new Uint32Array([0, triVerts.length]) }));
} catch (err) {
  console.log(`Input is not a closed solid (${err.message}) — Minkowski needs one.`);
  process.exit(0);
}

const before = solid.boundingBox();
const beforeX = before.max[0] - before.min[0];
console.log(`input: tris=${solid.numTri()} volume=${solid.volume().toFixed(1)}mm3 bboxX=${beforeX.toFixed(3)} watertight=solid`);

// Ball offset by r = (target - current)/2 per surface.
const r = 0.15;
for (const [segments, label] of [[8, 'coarse'], [16, 'default']]) {
  const t0 = performance.now();
  const out = solid.minkowskiSum(m.Manifold.sphere(r, segments));
  const ms = performance.now() - t0;
  const box = out.boundingBox();
  const afterX = box.max[0] - box.min[0];
  // A ball offset grows every dimension by exactly 2r; anything else is a bug
  // in the operator, not a modelling choice.
  console.log(
    `minkowski(${label} sphere r=${r}): ${ms.toFixed(0)}ms tris ${solid.numTri()} -> ${out.numTri()} ` +
    `status=${out.status()} bboxX grew ${(afterX - beforeX).toFixed(3)} (expected ${(2 * r).toFixed(2)})`,
  );
}
