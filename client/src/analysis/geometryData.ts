import { buildGeometryGraph } from './geometryGraph';
import { type GeometryModel } from './geometryModel';

export interface VertexData {
  positions: Float32Array;
  normals: Float32Array;
  size: { x: number; y: number; z: number };
  triangleCount: number;
}

export function extractVertexData(model: GeometryModel): VertexData {
  const graph = buildGeometryGraph(model);

  if (graph) {
    const size = graph.boundingBoxDimensions;
    return {
      positions: graph.positions,
      normals: graph.normals,
      size,
      triangleCount: graph.triangleCount,
    };
  }

  return {
    positions: model.positions,
    normals: model.normals,
    size: { x: 0, y: 0, z: 0 },
    triangleCount: Math.floor(model.positions.length / 9),
  };
}
