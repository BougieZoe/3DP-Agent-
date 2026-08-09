import type { GeometryModel } from './geometryModel';

/**
 * Auto-bed placement: translate a mesh so its minimum Z rests exactly on the
 * build plate (Z = 0), aligning its bounding-box bottom face with the
 * build-volume floor.
 *
 * Build axis is Z (slicer convention). This is the placement step a slicer
 * performs before cutting the part — it removes any vertical offset so the
 * lowest vertex sits on the plate. Pure: returns a new model and never mutates
 * the input. Normals are preserved because a translation is
 * orientation-preserving.
 *
 * When the mesh is already on the bed (minZ === 0), the SAME reference is
 * returned (zero-copy no-op) — callers must treat results as immutable.
 */
export function dropToBed(model: GeometryModel): GeometryModel {
  const { positions } = model;
  let minZ = Infinity;
  for (let i = 2; i < positions.length; i += 3) {
    const z = positions[i];
    if (z < minZ) minZ = z;
  }

  // Empty / non-finite geometry: nothing to place.
  if (!Number.isFinite(minZ)) return model;
  // Already on the bed: zero-copy no-op.
  if (minZ === 0) return model;

  const translated = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    translated[i] = positions[i];
    translated[i + 1] = positions[i + 1];
    translated[i + 2] = positions[i + 2] - minZ;
  }

  return {
    positions: translated,
    normals: model.normals,
    indices: model.indices,
    vertexCount: model.vertexCount,
    triangleCount: model.triangleCount,
    units: model.units,
  };
}
