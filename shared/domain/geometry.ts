export interface Vector3Value {
  x: number;
  y: number;
  z: number;
}

/**
 * Units a source file may be authored in. STL carries no unit information, so
 * the unit must be declared explicitly — otherwise a cm/inch model is silently
 * misread as millimeters (10× / 25.4× error on every dimension and volume).
 */
export type LengthUnit = 'mm' | 'cm' | 'inch';

/** Scale factor to convert a length expressed in the given unit to millimeters. */
export const LENGTH_UNIT_TO_MM: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  inch: 25.4,
};

export interface ModelSource {
  id: string;
  fileName: string;
  fileSizeBytes?: number;
  fileType: 'stl' | 'unknown';
  /** Declared units of the source file; analysis is normalized to millimeters. */
  units?: LengthUnit;
}

export interface GeometryBounds {
  min: Vector3Value;
  max: Vector3Value;
  size: Vector3Value;
}

export interface GeometryMetrics {
  bounds: GeometryBounds;
  triangleCount: number;
  surfaceAreaMm2: number;
  boundingBoxVolumeMm3: number;
  meshVolumeMm3?: number;
}

export function toVector3Value(value: Vector3Value): Vector3Value {
  return {
    x: value.x,
    y: value.y,
    z: value.z,
  };
}

export function createGeometryBounds(min: Vector3Value, max: Vector3Value): GeometryBounds {
  const normalizedMin = toVector3Value(min);
  const normalizedMax = toVector3Value(max);

  return {
    min: normalizedMin,
    max: normalizedMax,
    size: {
      x: normalizedMax.x - normalizedMin.x,
      y: normalizedMax.y - normalizedMin.y,
      z: normalizedMax.z - normalizedMin.z,
    },
  };
}
