import * as THREE from 'three';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

export function countTriangles(geometry: THREE.BufferGeometry): number {
  return geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
}

/**
 * Reduce a mesh toward a target triangle count using quadratic simplification
 * — a real prep step for large AI/scan meshes so the analysis stays fast and
 * the export is manageable. Returns the input unchanged when already under the
 * target.
 */
export function decimateGeometry(
  geometry: THREE.BufferGeometry,
  targetTriangles: number,
): THREE.BufferGeometry {
  const current = countTriangles(geometry);
  if (current <= targetTriangles) return geometry;

  const working = geometry.index ? geometry : mergeVertices(geometry);
  if (!working.attributes.normal) working.computeVertexNormals();
  const modifier = new SimplifyModifier();

  // SimplifyModifier can error ("No next vertex") and return an EMPTY mesh if
  // asked to remove too many triangles at once. Decimate in conservative passes
  // and bail to the last valid geometry if the modifier ever loses everything.
  let result = working;
  let guard = 0;
  while (countTriangles(result) > targetTriangles && guard < 12) {
    const now = countTriangles(result);
    const desired = now - targetTriangles;
    const remove = Math.max(1, Math.min(Math.floor(now * 0.4), desired));
    const next = modifier.modify(result, remove);
    if (!next.attributes.position || next.attributes.position.count === 0) break;
    result = next;
    guard++;
  }

  if (result === working) {
    // Nothing could be safely removed — return the original unchanged.
    return geometry;
  }
  const out = result.index ? result : mergeVertices(result);
  out.computeVertexNormals();
  return out;
}

/** Export a BufferGeometry to a binary STL ArrayBuffer. */
export function geometryToStl(geometry: THREE.BufferGeometry): ArrayBuffer {
  const out = new STLExporter().parse(new THREE.Mesh(geometry), { binary: true });
  return out instanceof DataView
    ? out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
    : new TextEncoder().encode(String(out)).buffer;
}
