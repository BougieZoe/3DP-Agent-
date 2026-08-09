/**
 * Z-up physical-truth fixtures.
 *
 * The build axis for 3D printing is Z (slicer convention): the build plate is
 * the z=0 plane, parts are "tall" along +Z, and only faces whose normal points
 * DOWNWARD (nz < 0) are overhang candidates. These fixtures are constructed so
 * their faces carry physically meaningful normals, so tests can assert against
 * real geometry rather than mocks.
 */
import * as THREE from 'three';
import { fromThreeBufferGeometry } from '@/analysis/geometryConversion';
import type { GeometryModel } from '@/analysis/geometryModel';

function toModel(geo: THREE.BufferGeometry): GeometryModel {
  return fromThreeBufferGeometry(geo);
}

/** Solid cube from z=0..size, resting flat on the build plate. */
export function createCubeOnBed(size = 20): THREE.BufferGeometry {
  const s = size;
  const vertices = new Float32Array([
    0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0,
    0, 0, s, s, 0, s, s, s, s, 0, s, s,
  ]);
  // Standard closed-cube winding: bottom face (z=0) normal −Z, top (z=s) +Z.
  const indices = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 3, 7, 6, 3, 6, 2,
    0, 1, 5, 0, 5, 4, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

export function createCubeOnBedModel(size = 20): GeometryModel {
  return toModel(createCubeOnBed(size));
}

/** Vertical wall (normal ±X, nz = 0): never an overhang. */
export function createVerticalWall(depth = 20, height = 20): THREE.BufferGeometry {
  const vertices = new Float32Array([
    0, 0, 0, 0, depth, 0, 0, depth, height, 0, 0, height,
  ]);
  // normal +X
  const indices = [0, 1, 2, 0, 2, 3];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Downward-facing ramp with a given overhang angle from vertical (0 = vertical
 * wall, 90 = horizontal ceiling). Its centroid sits above its own lowest edge,
 * so it is genuinely suspended (not treated as build-plate contact).
 */
export function createOverhangRamp(width: number, depth: number, overhangAngleDeg: number): THREE.BufferGeometry {
  const a = ((90 - overhangAngleDeg) * Math.PI) / 180; // surface slope from horizontal
  const drop = width * Math.tan(a);
  const h = 10;
  const vertices = new Float32Array([
    0, -depth / 2, h,
    0, depth / 2, h,
    width, depth / 2, h - drop,
    width, -depth / 2, h - drop,
  ]);
  // CCW winding → the normal points DOWN (nz < 0): the underside of the ramp.
  const indices = [0, 1, 2, 0, 2, 3];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

/** Upward-facing ramp (normal nz > 0): never an overhang. */
export function createUpwardRamp(width: number, depth: number, slopeDeg: number): THREE.BufferGeometry {
  const rise = width * Math.tan((slopeDeg * Math.PI) / 180);
  const vertices = new Float32Array([
    0, 0, 0, 0, depth, 0, width, depth, rise, width, 0, rise,
  ]);
  // normal points up: (C−A)×(B−A) has nz > 0
  const indices = [0, 2, 1, 0, 3, 2];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

function mergeGeometries(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const pa = a.getAttribute('position').array as Float32Array;
  const pb = b.getAttribute('position').array as Float32Array;
  const ia = a.getIndex().array as number[];
  const ib = b.getIndex().array as number[];

  const positions = new Float32Array(pa.length + pb.length);
  positions.set(pa, 0);
  positions.set(pb, pa.length);

  const vertexOffset = pa.length / 3;
  const indices = [...ia, ...ib.map((i) => i + vertexOffset)];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Horizontal ceiling (normal −Z, 90° overhang) suspended above the bed by an
 * anchor block, so its centroid is genuinely off the build plate.
 */
export function createSuspendedCeiling(width: number, depth: number, height: number): THREE.BufferGeometry {
  const anchor = createCubeOnBed(8);
  const ceilingVertices = new Float32Array([
    0, 0, height, width, 0, height, width, depth, height, 0, depth, height,
  ]);
  const ceiling = new THREE.BufferGeometry();
  ceiling.setAttribute('position', new THREE.BufferAttribute(ceilingVertices, 3));
  ceiling.setIndex([0, 2, 1, 0, 3, 2]); // normal −Z (downward)
  return mergeGeometries(anchor, ceiling);
}

/**
 * Thin flat plate, thickness along X, height along Z, length along Y.
 * Rays cast from either face hit the opposite face at `thickness`.
 */
export function createThinPlate(thickness: number, height = 30, length = 30): THREE.BufferGeometry {
  const vertices = new Float32Array([
    0, 0, 0, 0, length, 0, 0, length, height, 0, 0, height,
    thickness, 0, 0, thickness, length, 0, thickness, length, height, thickness, 0, height,
  ]);
  // face A (x=0) normal −X, face B (x=thickness) normal +X
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Thin-walled hollow tube (Z-up, axis along Z). Wall thickness = `wall`.
 * The marquee fixture for the "thin-walled hollow part" case that a
 * bounding-box minimum can never detect.
 */
export function createThinWalledTube(outerRadius: number, wall: number, height: number, segments = 32): THREE.BufferGeometry {
  const innerRadius = outerRadius - wall;
  const positions: number[] = [];
  const indices: number[] = [];

  // Outer wall (normals point radially outward).
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const base = positions.length / 3;
    positions.push(c0 * outerRadius, s0 * outerRadius, 0);
    positions.push(c1 * outerRadius, s1 * outerRadius, 0);
    positions.push(c1 * outerRadius, s1 * outerRadius, height);
    positions.push(c0 * outerRadius, s0 * outerRadius, height);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Inner wall (reversed winding → normals point radially inward, into the void).
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const base = positions.length / 3;
    positions.push(c0 * innerRadius, s0 * innerRadius, 0);
    positions.push(c1 * innerRadius, s1 * innerRadius, 0);
    positions.push(c1 * innerRadius, s1 * innerRadius, height);
    positions.push(c0 * innerRadius, s0 * innerRadius, height);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  return geo;
}

export function createThinWalledTubeModel(outerRadius: number, wall: number, height: number, segments?: number): GeometryModel {
  return toModel(createThinWalledTube(outerRadius, wall, height, segments));
}

/** Single triangle in the XY plane: raycast cannot find a back surface. */
export function createSingleTriangle(): THREE.BufferGeometry {
  const vertices = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex([0, 1, 2]);
  return geo;
}

export function createSingleTriangleModel(): GeometryModel {
  return toModel(createSingleTriangle());
}
