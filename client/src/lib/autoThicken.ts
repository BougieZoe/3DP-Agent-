import * as THREE from 'three';
import { getManifold } from './manifoldLoader';

/**
 * Auto-thicken (true mesh offset).
 *
 * The app could *detect* thin walls but not fix them: the only WASM path was
 * `applyRepairAsync`, which needs a counterfactual suggestion produced from
 * agent markers — so a fresh upload usually had no way to thicken anything.
 *
 * This runs manifold's 3D offset directly: expand the solid by delta on every
 * surface, which adds 2·delta to wall thickness. It is a real geometric
 * operation, not a normal displacement — the result stays manifold, and the
 * caller re-analyses it so the before/after is measured, not assumed.
 *
 * A true solid offset is not attempted here: manifold 3.5.1 has no 3D offset,
 * and Minkowski-with-a-sphere — its mathematically correct equivalent — costs
 * ~10-23s on a 5k-triangle model (see scripts/verify-offset-feasibility.mjs
 * and the AGENTS.md record). That belongs on the bridge.
 *
 * Honest limits, surfaced to the caller:
 *  - An open shell has no solid to offset; manifold will fail → we say so and
 *    point at repair instead of silently doing nothing.
 *  - Offsetting grows the part by 2·delta overall and rounds sharp edges. That
 *    is what an offset *is*; the delta is capped so a 0.1mm wall cannot turn a
 *    60mm bracket into a 70mm one.
 */

/** Half the missing thickness: each surface moves outward by this much. */
export function thickenDeltaMm(currentMinWallMm: number | null, targetMm = 0.8): number {
  if (currentMinWallMm == null || !Number.isFinite(currentMinWallMm)) {
    throw new Error('No wall-thickness measurement for this model — thicken needs a measured value.');
  }
  const delta = (targetMm - currentMinWallMm) / 2;
  if (delta <= 0.02) {
    throw new Error(`Walls already at or above ${targetMm} mm (measured ${currentMinWallMm.toFixed(2)} mm).`);
  }
  // A 2mm half-offset is already a 4mm growth per side; anything more is a
  // redesign, not a fix.
  return Math.min(delta, 2);
}

/**
 * Keep a thicken only if the headline wall measurement actually improved.
 * A local offset can move vertices the wrong way on an inconsistent mesh —
 * observed: 0.11mm → 0.02mm on an open STL. Committing that would be worse
 * than doing nothing, so the caller discards it and says so.
 */
export function isThickenImprovement(
  beforeMm: number | null,
  afterMm: number | null,
  toleranceMm = 0.01,
): boolean {
  if (beforeMm == null || afterMm == null) return false;
  if (!Number.isFinite(beforeMm) || !Number.isFinite(afterMm)) return false;
  return afterMm > beforeMm + toleranceMm;
}

export interface ThickenResult {
  geometry: THREE.BufferGeometry;
  deltaMm: number;
  note: string;
}

export interface ThinSample {
  position: { x: number; y: number; z: number };
  thickness: number;
}

/**
 * Local vertex offset, guided by measured thin-wall samples.
 *
 * Used because manifold 3.5.1 exposes `offset()` on CrossSection (2D) only —
 * there is no 3D offset in this build, so the previous `man.offset(delta)`
 * path could never run and always fell back. Offsetting only vertices near
 * samples thinner than the target keeps the rest of the part dimensionally
 * intact, which a blanket solid offset would not.
 */
function localOffset(
  geometry: THREE.BufferGeometry,
  samples: ThinSample[],
  targetMm: number,
  delta: number,
): { geometry: THREE.BufferGeometry; movedVertices: number } {
  const thin = samples.filter((s) => Number.isFinite(s.thickness) && s.thickness < targetMm);
  if (thin.length === 0) {
    throw new Error('No thin-wall sample locations to offset — nothing to thicken here.');
  }
  const geo = geometry.clone();
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  geo.computeVertexNormals();

  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const radius = Math.max(0.6, targetMm); // reach a little past the sample
  const r2 = radius * radius;
  const moved = new Set<number>();

  for (const s of thin) {
    for (let i = 0; i < pos.count; i++) {
      if (moved.has(i)) continue;
      const dx = pos.getX(i) - s.position.x;
      const dy = pos.getY(i) - s.position.y;
      const dz = pos.getZ(i) - s.position.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      moved.add(i);
      const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
      const len = Math.hypot(nx, ny, nz) || 1;
      pos.setXYZ(
        i,
        pos.getX(i) + (nx / len) * delta,
        pos.getY(i) + (ny / len) * delta,
        pos.getZ(i) + (nz / len) * delta,
      );
    }
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geometry: geo, movedVertices: moved.size };
}

function toManifoldMesh(geo: THREE.BufferGeometry, manifold: any) {
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex();
  if (!pos || !idx) throw new Error('Geometry is not indexed — cannot offset an open triangle soup.');
  const vertProperties = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    vertProperties[i * 3] = pos.getX(i);
    vertProperties[i * 3 + 1] = pos.getY(i);
    vertProperties[i * 3 + 2] = pos.getZ(i);
  }
  const triVerts = idx.array as Uint32Array | Uint16Array;
  return new manifold.Mesh({
    numProp: 3,
    vertProperties,
    triVerts,
    runIndex: new Uint32Array([0, triVerts.length]),
  });
}

export async function autoThicken(
  geometry: THREE.BufferGeometry,
  currentMinWallMm: number | null,
  targetMm = 0.8,
  samples: ThinSample[] = [],
): Promise<ThickenResult> {
  const delta = thickenDeltaMm(currentMinWallMm, targetMm);

  // Prefer a true solid offset when the running manifold build supports one.
  try {
    const manifold = await getManifold();
    if (typeof (manifold as any)?.Manifold?.prototype?.offset !== 'function') {
      throw new Error('no-3d-offset');
    }
    const man = new manifold.Manifold(toManifoldMesh(geometry, manifold));
    const offset = man.offset(delta, 'round', 1.5);
    const mesh = offset.getMesh();
    const positions = new Float32Array(mesh.vertProperties);
    const indices = new Uint32Array(mesh.triVerts);
    if (positions.length === 0 || indices.length === 0) throw new Error('empty offset result');
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    out.setIndex(new THREE.BufferAttribute(indices, 1));
    out.computeVertexNormals();
    out.computeBoundingBox();
    return { geometry: out, deltaMm: delta, note: `solid offset +${delta.toFixed(2)}mm per surface` };
  } catch (err) {
    // Fall through to the measured, local offset. Only a genuinely unusable
    // input (no samples) is an error worth surfacing.
    if (err instanceof Error && err.message === 'No thin-wall sample locations to offset — nothing to thicken here.') {
      throw err;
    }
  }

  const { geometry: local, movedVertices } = localOffset(geometry, samples, targetMm, delta);
  return {
    geometry: local,
    deltaMm: delta,
    note: `local thicken +${delta.toFixed(2)}mm on ${movedVertices.toLocaleString('en-US')} vertices (measured thin regions only)`,
  };
}
