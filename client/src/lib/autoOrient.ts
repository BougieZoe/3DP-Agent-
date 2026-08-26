/**
 * Auto-orientation for 3D models
 *
 * Detects the natural "bottom" face of a model and orients it to sit flat
 * on the build plate, so the model looks natural when first loaded.
 */

import * as THREE from 'three';

/**
 * Auto-orient a geometry so its largest flat face sits on the build plate (Z=0).
 * This makes models look natural when first loaded instead of showing their bottom.
 */
export function autoOrientGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  // In-place: callers pass a freshly-normalized geometry they own exclusively
  // (normalizeModelGeometry already cloned the source), so the extra clone
  // here was a full duplicate of a potentially huge position/index buffer on
  // the main thread.
  const oriented = geometry;
  oriented.computeVertexNormals();
  oriented.computeBoundingBox();

  const box = oriented.boundingBox;
  if (!box) return oriented;

  const size = new THREE.Vector3();
  box.getSize(size);

  // Find the largest axis-aligned face direction
  // For most models, the "bottom" is the largest flat face
  const faceAreas = [
    { axis: 'x', area: size.y * size.z },
    { axis: 'y', area: size.x * size.z },
    { axis: 'z', area: size.x * size.y },
  ];

  // Sort by area (largest first)
  faceAreas.sort((a, b) => b.area - a.area);

  // Check which faces are actually flat by sampling normals
  const positions = oriented.getAttribute('position');
  const normals = oriented.getAttribute('normal');

  if (!positions || !normals) return oriented;

  // Sample faces to find the flattest large face
  const bestFace = findFlattestLargeFace(oriented, faceAreas);

  if (bestFace) {
    // Rotate so the flattest face is on the bottom (Z=0)
    applyOrientation(oriented, bestFace);
  }

  return oriented;
}

interface FaceInfo {
  axis: string;
  direction: number; // +1 or -1
  flatness: number;  // 0-1, how flat the face is
  area: number;
}

function findFlattestLargeFace(
  geometry: THREE.BufferGeometry,
  faceAreas: { axis: string; area: number }[]
): FaceInfo | null {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const indices = geometry.getIndex();

  if (!positions || !normals) return null;

  const vertexCount = positions.count;
  const faceCount = indices ? indices.count / 3 : vertexCount / 3;

  // For each axis direction, check how flat the face is
  for (const { axis, area } of faceAreas) {
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

    // Sample normals to check flatness
    let normalSum = 0;
    let normalCount = 0;

    for (let i = 0; i < Math.min(faceCount, 1000); i++) {
      const faceIdx = i * 3;
      const vi = indices ? indices.getX(faceIdx) : faceIdx;
      const nz = normals.getX(vi + axisIdx);
      normalSum += Math.abs(nz);
      normalCount++;
    }

    const avgNormal = normalSum / normalCount;
    const flatness = Math.abs(avgNormal);

    // If the face is reasonably flat (>70% of normals aligned), use it
    if (flatness > 0.7) {
      // Determine direction: positive or negative
      let posCount = 0;
      let negCount = 0;
      for (let i = 0; i < Math.min(vertexCount, 1000); i++) {
        const val = positions.getX(i + axisIdx);
        if (val > 0) posCount++;
        else negCount++;
      }

      return {
        axis,
        direction: posCount > negCount ? 1 : -1,
        flatness,
        area,
      };
    }
  }

  return null;
}

function applyOrientation(geometry: THREE.BufferGeometry, face: FaceInfo): void {
  // Rotate geometry so the identified face is on the bottom
  const { axis, direction } = face;

  if (axis === 'z' && direction === 1) {
    // Already oriented correctly (top facing up)
    return;
  }

  if (axis === 'z' && direction === -1) {
    // Flip Z
    geometry.rotateX(Math.PI);
  } else if (axis === 'x') {
    // Rotate X to Z
    if (direction === 1) {
      geometry.rotateY(-Math.PI / 2);
    } else {
      geometry.rotateY(Math.PI / 2);
    }
  } else if (axis === 'y') {
    // Rotate Y to Z
    if (direction === 1) {
      geometry.rotateX(Math.PI / 2);
    } else {
      geometry.rotateX(-Math.PI / 2);
    }
  }
}

/**
 * Get a suggested camera position for a freshly loaded model.
 * Returns a position that shows the model from a natural 3/4 view.
 */
export function getSuggestedCameraPosition(geometry: THREE.BufferGeometry): {
  position: THREE.Vector3;
  target: THREE.Vector3;
} {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;

  if (!box) {
    return {
      position: new THREE.Vector3(5, 5, 5),
      target: new THREE.Vector3(0, 0, 0),
    };
  }

  const center = new THREE.Vector3();
  box.getCenter(center);

  const size = new THREE.Vector3();
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 1.5;

  // Natural 3/4 view from slightly above and to the right
  const position = new THREE.Vector3(
    center.x + distance * 0.65,
    center.y + distance * 0.5,
    center.z + distance * 1.0,
  );

  return { position, target: center };
}
