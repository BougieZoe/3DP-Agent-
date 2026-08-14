import * as THREE from 'three';
import { LENGTH_UNIT_TO_MM, type LengthUnit } from '@shared/domain/geometry';

export interface NormalizedModelGeometry {
  /**
   * Render/analysis geometry: scaled to millimeters, centered so minZ rests on
   * the build plate (Z = 0) and the (X, Y) center is at the origin — so
   * OrbitControls.target (0,0,0) frames it — with normals, bounding box and
   * bounding sphere recomputed.
   */
  geometry: THREE.BufferGeometry;
  /** Pristine clone of the source geometry (unscaled, un-centered). */
  rawGeometry: THREE.BufferGeometry;
}

/**
 * Normalize a freshly loaded STL for rendering + analysis:
 *  - scale non-mm geometry to millimeters explicitly from the declared units;
 *  - center the bounding box on the build plate (see {@link NormalizedModelGeometry});
 *  - recompute vertex normals, bounding box and bounding sphere.
 *
 * Pure: never mutates the input. The returned `rawGeometry` clone is the source
 * of truth for later unit changes, so toggling units always re-scales from the
 * original geometry instead of stacking scale operations.
 */
export function normalizeModelGeometry(raw: THREE.BufferGeometry, units: LengthUnit): NormalizedModelGeometry {
  const geometry = raw.clone();

  const factor = LENGTH_UNIT_TO_MM[units];
  if (factor !== 1) geometry.scale(factor, factor, factor);

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const box = geometry.boundingBox;
  if (box) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    geometry.translate(-center.x, -center.y, -box.min.z);
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return { geometry, rawGeometry: raw.clone() };
}

export interface CameraControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

/**
 * Frame the camera (and OrbitControls) snugly around a model's bounding
 * sphere, looking at the model center. Recomputes the bounds defensively so a
 * stale bounding box (e.g. after scaling) can never leave the model
 * off-center or out of frame.
 */
export function fitCameraToGeometry(
  camera: THREE.PerspectiveCamera | THREE.Camera,
  controls: CameraControlsLike | null | undefined,
  geometry: THREE.BufferGeometry,
): void {
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const box = geometry.boundingBox;
  const sphere = geometry.boundingSphere;
  if (!box) return;

  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const radius = sphere?.radius ?? Math.max(size.x, size.y, size.z) / 2;

  // Frame the bounding sphere within BOTH the vertical and horizontal FOV —
  // the narrower one binds, so long/wide models (cars, beams) are never
  // clipped or pushed out of frame by the viewport aspect ratio.
  const isPerspective = camera instanceof THREE.PerspectiveCamera;
  const fovV = isPerspective && camera.fov > 0 ? (camera.fov * Math.PI) / 180 : Math.PI / 3;
  const aspect = isPerspective && camera.aspect > 0 ? camera.aspect : 1;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect);
  const minFov = Math.min(fovV, fovH);
  const distance = (radius / Math.sin(minFov / 2)) * 1.1;
  if (!(distance > 0) || !Number.isFinite(distance)) return;

  // Offset view direction; the camera sits exactly `distance` from the center.
  const dir = new THREE.Vector3(0.65, 0.5, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.lookAt(center);

  if (isPerspective) {
    // Dynamic clipping planes: the default near/far (0.1 / 1000) clip tiny
    // models on the near plane and make large models (e.g. a 2 m part) vanish
    // past the far plane. Scale both around the camera distance and refresh
    // the projection matrix immediately.
    camera.near = Math.max(distance / 100, 1e-4);
    camera.far = Math.max(distance * 100, camera.near + 1);
    camera.updateProjectionMatrix();
  }

  if (controls) {
    controls.target.copy(center);
    controls.update();
  }
}
