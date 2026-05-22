import * as THREE from 'three';

export interface GeometryModification {
  type: 'wall_thickening' | 'vertex_offset' | 'smooth';
  regions?: number[][];
  amount?: number;
}

export function cloneGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const cloned = geometry.clone();
  cloned.computeVertexNormals();
  return cloned;
}

export function thickenWalls(
  geometry: THREE.BufferGeometry,
  markers: Array<{ severity: number; position: { x: number; y: number; z: number } }>,
  amount: number = 0.5,
): THREE.BufferGeometry {
  const cloned = geometry.clone();
  const pos = cloned.getAttribute('position');
  if (!pos) return cloned;

  const positions = pos.array as Float32Array;
  cloned.computeVertexNormals();
  const normals = cloned.getAttribute('normal')?.array as Float32Array;
  if (!normals) return cloned;

  const affectedVertices = new Set<number>();
  const threshold = 2.0;

  for (const marker of markers) {
    const mx = marker.position.x;
    const my = marker.position.y;
    const mz = marker.position.z;
    const influence = Math.max(0.5, marker.severity) * amount;

    for (let i = 0; i < positions.length; i += 3) {
      const dx = positions[i] - mx;
      const dy = positions[i + 1] - my;
      const dz = positions[i + 2] - mz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < threshold) {
        const falloff = 1 - dist / threshold;
        const offset = influence * falloff;

        positions[i] += normals[i] * offset;
        positions[i + 1] += normals[i + 1] * offset;
        positions[i + 2] += normals[i + 2] * offset;

        affectedVertices.add(Math.floor(i / 3));
      }
    }
  }

  pos.needsUpdate = true;
  cloned.computeVertexNormals();
  cloned.computeBoundingBox();
  cloned.computeBoundingSphere();

  return cloned;
}

export function optimizeOrientation(
  geometry: THREE.BufferGeometry,
): { geometry: THREE.BufferGeometry; rotation: { x: number; y: number; z: number } } {
  const cloned = geometry.clone();
  cloned.computeBoundingBox();
  const box = cloned.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);

  const xyArea = size.x * size.y;
  const xzArea = size.x * size.z;
  const yzArea = size.y * size.z;

  const maxArea = Math.max(xyArea, xzArea, yzArea);
  let rotX = 0, rotY = 0, rotZ = 0;

  if (maxArea === xzArea) {
    rotX = -Math.PI / 2;
  } else if (maxArea === yzArea) {
    rotX = 0;
    rotY = 0;
    rotZ = 0;
  }

  cloned.rotateX(rotX);
  cloned.rotateY(rotY);
  cloned.rotateZ(rotZ);
  cloned.computeVertexNormals();

  return { geometry: cloned, rotation: { x: rotX, y: rotY, z: rotZ } };
}

export function smoothGeometry(
  geometry: THREE.BufferGeometry,
  iterations: number = 1,
): THREE.BufferGeometry {
  const cloned = geometry.clone();
  const pos = cloned.getAttribute('position');
  if (!pos) return cloned;

  const positions = pos.array as Float32Array;
  const vertexCount = positions.length / 3;

  for (let iter = 0; iter < iterations; iter++) {
    const newPositions = new Float32Array(positions);

    for (let i = 3; i < positions.length - 3; i += 3) {
      const neighbors: number[] = [];

      if (i - 9 >= 0) { neighbors.push(i - 9, i - 8, i - 7); }
      if (i + 9 < positions.length) { neighbors.push(i + 9, i + 10, i + 11); }

      if (neighbors.length > 0) {
        let sumX = 0, sumY = 0, sumZ = 0;
        const neighborCount = neighbors.length / 3;
        for (let n = 0; n < neighbors.length; n += 3) {
          sumX += positions[neighbors[n]];
          sumY += positions[neighbors[n + 1]];
          sumZ += positions[neighbors[n + 2]];
        }
        newPositions[i] = positions[i] * 0.5 + (sumX / neighborCount) * 0.5;
        newPositions[i + 1] = positions[i + 1] * 0.5 + (sumY / neighborCount) * 0.5;
        newPositions[i + 2] = positions[i + 2] * 0.5 + (sumZ / neighborCount) * 0.5;
      }
    }

    for (let i = 0; i < positions.length; i++) {
      positions[i] = newPositions[i];
    }
  }

  pos.needsUpdate = true;
  cloned.computeVertexNormals();
  return cloned;
}

export function applySuggestions(
  originalGeometry: THREE.BufferGeometry,
  suggestions: Array<{ type: string; priority: string }>,
  markers: Array<{ severity: number; position: { x: number; y: number; z: number }; type: string }>,
): THREE.BufferGeometry {
  let geo = cloneGeometry(originalGeometry);

  for (const suggestion of suggestions) {
    if (suggestion.type === 'wall_thickening') {
      const wallMarkers = markers.filter(m => m.type === 'thin_wall');
      geo = thickenWalls(geo, wallMarkers, 0.5);
    }
    if (suggestion.type === 'orientation_change') {
      const result = optimizeOrientation(geo);
      geo = result.geometry;
    }
  }

  return geo;
}

export function countTriangles(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  if (!pos) return 0;
  return Math.floor(pos.count / 3);
}
