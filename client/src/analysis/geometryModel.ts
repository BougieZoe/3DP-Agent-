export interface GeometryModel {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export function createGeometryModel(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
): GeometryModel {
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length > 0 ? indices.length / 3 : positions.length / 9;
  return { positions, normals, indices, vertexCount, triangleCount };
}
