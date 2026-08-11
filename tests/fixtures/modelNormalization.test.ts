/**
 * Viewport camera-fit + unit-reactivity helpers: `normalizeModelGeometry`
 * scales/centers a loaded mesh (so OrbitControls.target (0,0,0) frames it and
 * bounding box/sphere are always fresh), and `fitCameraToGeometry` frames the
 * camera snugly around the model's bounds.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { normalizeModelGeometry, fitCameraToGeometry } from '@/lib/modelNormalization';
import { createCubeOnBed } from './geometry';

function bboxOf(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  return { min: { x: b.min.x, y: b.min.y, z: b.min.z }, max: { x: b.max.x, y: b.max.y, z: b.max.z } };
}

describe('normalizeModelGeometry', () => {
  it('scales a 1-unit cm cube to mm and centers it on the build plate', () => {
    const { geometry, rawGeometry } = normalizeModelGeometry(createCubeOnBed(1), 'cm');
    const box = bboxOf(geometry);
    // 1 unit × 10 = 10 mm; XY center shifted to 0, minZ rests on 0.
    expect(box.min.x).toBeCloseTo(-5, 5);
    expect(box.max.x).toBeCloseTo(5, 5);
    expect(box.min.y).toBeCloseTo(-5, 5);
    expect(box.max.y).toBeCloseTo(5, 5);
    expect(box.min.z).toBeCloseTo(0, 5);
    expect(box.max.z).toBeCloseTo(10, 5);
    // Bounding sphere computed so the camera can frame it.
    expect(geometry.boundingSphere?.radius ?? 0).toBeGreaterThan(0);
    // The raw clone is pristine: still 1 unit and un-centered.
    const rawBox = bboxOf(rawGeometry);
    expect(rawBox.min.x).toBeCloseTo(0, 5);
    expect(rawBox.max.x).toBeCloseTo(1, 5);
  });

  it('centers an mm cube without scaling', () => {
    const { geometry } = normalizeModelGeometry(createCubeOnBed(20), 'mm');
    const box = bboxOf(geometry);
    expect(box.min.x).toBeCloseTo(-10, 5);
    expect(box.max.x).toBeCloseTo(10, 5);
    expect(box.min.z).toBeCloseTo(0, 5);
    expect(box.max.z).toBeCloseTo(20, 5);
  });

  it('does not mutate the input geometry', () => {
    const raw = createCubeOnBed(1);
    normalizeModelGeometry(raw, 'cm');
    const box = bboxOf(raw);
    expect(box.max.x).toBeCloseTo(1, 5); // untouched (still 1 unit)
  });
});

describe('fitCameraToGeometry', () => {
  it('frames the model and points the controls target at its center', () => {
    const { geometry } = normalizeModelGeometry(createCubeOnBed(20), 'mm');
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const controls = { target: new THREE.Vector3(), update: vi.fn() };
    fitCameraToGeometry(camera, controls, geometry);
    expect(controls.update).toHaveBeenCalled();
    // Target = model center (0, 0, height/2).
    expect(controls.target.z).toBeCloseTo(10, 5);
    // Camera moved off the default [0,3,10] and away from the model.
    expect(camera.position.length()).toBeGreaterThan(5);
  });

  it('recomputes bounds when the geometry has none precomputed', () => {
    // A freshly built geometry with no bounding box — fit must still frame it.
    const raw = createCubeOnBed(20);
    expect(raw.boundingBox).toBeNull();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const controls = { target: new THREE.Vector3(), update: () => {} };
    fitCameraToGeometry(camera, controls, raw);
    expect(camera.position.length()).toBeGreaterThan(5);
    expect(controls.target.length() > 0).toBe(true);
  });

  it('frames a scaled model at the appropriate distance', () => {
    // cm cube → 10 mm after normalization; camera distance should scale with it.
    const { geometry } = normalizeModelGeometry(createCubeOnBed(1), 'cm');
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const controls = { target: new THREE.Vector3(), update: () => {} };
    fitCameraToGeometry(camera, controls, geometry);
    const dist = camera.position.distanceTo(controls.target);
    expect(dist).toBeGreaterThan(10);
    expect(dist).toBeLessThan(40);
  });

  it('sets dynamic clipping planes so a large model is not clipped', () => {
    // 1 m part — the default far plane (1000) would cut it off entirely.
    const { geometry } = normalizeModelGeometry(createCubeOnBed(1000), 'mm');
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    const controls = { target: new THREE.Vector3(), update: vi.fn() };
    fitCameraToGeometry(camera, controls, geometry);
    const dist = camera.position.distanceTo(controls.target);
    expect(camera.far).toBeGreaterThan(1000); // old far would have clipped the model
    expect(camera.far).toBeGreaterThan(dist * 10);
    expect(camera.near).toBeLessThan(dist / 10);
    expect(camera.near).toBeGreaterThan(0);
    expect(camera.near).toBeLessThan(camera.far);
  });

  it('accounts for horizontal FOV so a wide model is not pushed out of frame', () => {
    const { geometry } = normalizeModelGeometry(createCubeOnBed(20), 'mm');
    // Narrow viewport (aspect < 1) → smaller horizontal FOV → camera must be
    // farther away for the model to fit horizontally.
    const narrow = new THREE.PerspectiveCamera(60, 0.5, 0.1, 1000);
    const controlsN = { target: new THREE.Vector3(), update: () => {} };
    fitCameraToGeometry(narrow, controlsN, geometry);
    const distNarrow = narrow.position.distanceTo(controlsN.target);

    const wide = new THREE.PerspectiveCamera(60, 2, 0.1, 1000);
    const controlsW = { target: new THREE.Vector3(), update: () => {} };
    fitCameraToGeometry(wide, controlsW, geometry);
    const distWide = wide.position.distanceTo(controlsW.target);

    expect(distNarrow).toBeGreaterThan(distWide);
  });
});
