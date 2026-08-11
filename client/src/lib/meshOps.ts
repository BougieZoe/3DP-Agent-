import * as THREE from 'three';
import { SimplifyModifier, mergeVertices } from 'three-stdlib';

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
  const toRemove = current - targetTriangles;
  if (toRemove <= 0) return geometry;

  const working = geometry.index ? geometry : mergeVertices(geometry);
  const result = new SimplifyModifier().modify(working, Math.round(toRemove));
  result.computeVertexNormals();
  return result;
}
