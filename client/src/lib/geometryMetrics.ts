import * as THREE from 'three';

export interface GeometryMetricsResult {
  bounds: THREE.Box3;
  size: THREE.Vector3;
  positions: Float32Array;
  normals: Float32Array;
  boundingBoxVolume: number;
  surfaceArea: number;
  triangleCount: number;
}

export function computeGeometryMetrics(geometry: THREE.BufferGeometry): GeometryMetricsResult {
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const bounds = geometry.boundingBox!;
  const size = new THREE.Vector3();
  bounds.getSize(size);

  const positions = geometry.getAttribute('position').array as Float32Array;
  const normals = geometry.getAttribute('normal').array as Float32Array;

  return {
    bounds,
    size,
    positions,
    normals,
    boundingBoxVolume: computeBoundingBoxVolume(size),
    surfaceArea: computeSurfaceArea(positions),
    triangleCount: Math.floor(positions.length / 9),
  };
}

export function computeBoundingBoxVolume(size: THREE.Vector3): number {
  return size.x * size.y * size.z;
}

export function computeSurfaceArea(positions: Float32Array): number {
  let surfaceArea = 0;

  for (let i = 0; i < positions.length; i += 9) {
    const v1 = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
    const v2 = new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]);
    const v3 = new THREE.Vector3(positions[i + 6], positions[i + 7], positions[i + 8]);

    const edge1 = new THREE.Vector3().subVectors(v2, v1);
    const edge2 = new THREE.Vector3().subVectors(v3, v1);
    const cross = new THREE.Vector3().crossVectors(edge1, edge2);

    surfaceArea += cross.length() / 2;
  }

  return surfaceArea;
}
