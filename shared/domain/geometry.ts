export interface Vector3Value {
  x: number;
  y: number;
  z: number;
}

export interface ModelSource {
  id: string;
  fileName: string;
  fileSizeBytes?: number;
  fileType: 'stl' | 'unknown';
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
