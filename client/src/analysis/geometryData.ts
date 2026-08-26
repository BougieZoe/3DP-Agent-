import { type GeometryModel } from './geometryModel';

export interface VertexData {
  positions: Float32Array;
  normals: Float32Array;
  size: { x: number; y: number; z: number };
  triangleCount: number;
}

/**
 * Extract the vertex arrays + bounding-box size for agent analysis.
 *
 * The previous implementation built the full geometry graph just to read the
 * bounding box — on a 1.5M-triangle model that was a ~1.5 GB allocation on the
 * main thread (agent runs happen on the UI thread). The bounding box is a
 * trivial O(n) scan; compute it directly.
 */
export function extractVertexData(model: GeometryModel): VertexData {
  const positions = model.positions;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const hasData = Number.isFinite(minX) && maxX >= minX;

  return {
    positions,
    normals: model.normals,
    size: hasData
      ? { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
      : { x: 0, y: 0, z: 0 },
    triangleCount: model.triangleCount,
  };
}
