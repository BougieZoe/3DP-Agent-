import { type GeometryModel } from './geometryModel';
import { type GeometryGraph } from './geometryGraph';

export interface VertexData {
  positions: Float32Array;
  normals: Float32Array;
  size: { x: number; y: number; z: number };
  triangleCount: number;
}

/**
 * Extract the vertex arrays + bounding-box size for agent analysis.
 *
 * When a GeometryGraph is available, reuses its bounding box (already computed
 * during graph construction) instead of scanning positions again.
 */
export function extractVertexData(model: GeometryModel, graph?: GeometryGraph | null): VertexData {
  const positions = model.positions;

  let size: { x: number; y: number; z: number };
  if (graph) {
    size = graph.boundingBoxDimensions;
  } else {
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
    size = hasData
      ? { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
      : { x: 0, y: 0, z: 0 };
  }

  return {
    positions,
    normals: model.normals,
    size,
    triangleCount: model.triangleCount,
  };
}
