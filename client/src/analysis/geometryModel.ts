import type { LengthUnit } from '@shared/domain/geometry';

export interface GeometryModel {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  /**
   * Units the positions are expressed in. The analysis pipeline works in
   * millimeters — callers must normalize non-mm geometry (e.g. via
   * `scaleToMillimeters`) before analysis, never silently assume mm.
   */
  units: LengthUnit;
}

export function createGeometryModel(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  units: LengthUnit = 'mm',
): GeometryModel {
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length > 0 ? indices.length / 3 : positions.length / 9;
  return { positions, normals, indices, vertexCount, triangleCount, units };
}
