import { LENGTH_UNIT_TO_MM, type LengthUnit } from '@shared/domain/geometry';
import type { GeometryModel } from './geometryModel';

/**
 * Explicitly scale a model's geometry to millimeters for the declared source
 * units, so a non-mm STL is never silently misread as millimeters (a cm model
 * would otherwise be 10× too small and 1000× too light in every downstream
 * metric). Pure: returns a new model, never mutates the input. Normals are
 * preserved because a uniform scale does not change face orientation.
 *
 * No-op (same reference) when the declared unit is already millimeters.
 */
export function scaleToMillimeters(model: GeometryModel, sourceUnit: LengthUnit): GeometryModel {
  const factor = LENGTH_UNIT_TO_MM[sourceUnit];
  if (factor === 1) return model;

  const positions = new Float32Array(model.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = model.positions[i] * factor;
    positions[i + 1] = model.positions[i + 1] * factor;
    positions[i + 2] = model.positions[i + 2] * factor;
  }

  return {
    positions,
    normals: model.normals,
    indices: model.indices,
    vertexCount: model.vertexCount,
    triangleCount: model.triangleCount,
    units: 'mm',
  };
}
