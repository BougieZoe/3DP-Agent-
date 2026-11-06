import * as THREE from 'three';

/**
 * Weld vertices onto a coarse grid.
 *
 * Why: `parseSTL` dedups on a 1e-8 grid (extremely tight), which is right for
 * a file straight out of a slicer but wrong for a mesh that has been through a
 * geometry kernel: manifold's offset output, serialized to STL (a triangle
 * soup), comes back with vertices that differ in the last float32 bits. Those
 * split into separate vertices, and the analyzer then reports non-manifold
 * edges / "open" for a mesh that is watertight.
 *
 * Observed: a 27,330-triangle offset result re-built as a manifold was
 * watertight, while the same bytes through the app's own import showed 208
 * non-manifold edges. Welding at 1e-4 (0.1 µm) restores the shared topology.
 *
 * Degenerate triangles produced by welding are dropped.
 */
export function weldGeometry(geometry: THREE.BufferGeometry, decimals = 4): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position');
  if (!pos) return geometry;
  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;
  if (triCount === 0) return geometry;

  const scale = Math.pow(10, decimals);
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.round(x * scale)},${Math.round(y * scale)},${Math.round(z * scale)}`;

  const map = new Map<string, number>();
  const outPos: number[] = [];
  const remap = new Int32Array(pos.count).fill(-1);

  const resolve = (i: number): number => {
    const cached = remap[i];
    if (cached !== -1) return cached;
    const key = keyOf(pos.getX(i), pos.getY(i), pos.getZ(i));
    let target = map.get(key);
    if (target === undefined) {
      target = outPos.length / 3;
      map.set(key, target);
      outPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    remap[i] = target;
    return target;
  };

  const outIdx: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const a = resolve(index ? index.getX(t * 3) : t * 3);
    const b = resolve(index ? index.getX(t * 3 + 1) : t * 3 + 1);
    const c = resolve(index ? index.getX(t * 3 + 2) : t * 3 + 2);
    // Welding can collapse a sliver triangle; a degenerate face is worse than
    // a missing one (it reads as a non-manifold edge).
    if (a === b || b === c || a === c) continue;
    outIdx.push(a, b, c);
  }

  const welded = new THREE.BufferGeometry();
  welded.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outPos), 3));
  welded.setIndex(new THREE.BufferAttribute(new Uint32Array(outIdx), 1));
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  if (geometry.groups?.length) {
    welded.addGroup(0, outIdx.length, 0);
  }
  return welded;
}
