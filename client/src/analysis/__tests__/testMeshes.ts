import * as THREE from 'three';
import { fromThreeBufferGeometry } from '../geometryConversion';
import type { GeometryModel } from '../geometryModel';

function geoToModel(geo: THREE.BufferGeometry): GeometryModel {
  return fromThreeBufferGeometry(geo);
}

export function createWatertightCube(): THREE.BufferGeometry {
  const vertices = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1]);
  const indices = [
    0,2,1, 0,3,2, 4,5,6, 4,6,7, 3,7,6, 3,6,2, 0,1,5, 0,5,4, 0,4,7, 0,7,3, 1,2,6, 1,6,5,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

export function createOpenCube(): THREE.BufferGeometry {
  const vertices = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1]);
  const indices = [
    0,2,1, 0,3,2, 3,7,6, 3,6,2, 0,1,5, 0,5,4, 0,4,7, 0,7,3, 1,2,6, 1,6,5,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

export function createCubeWithInvertedNormals(): THREE.BufferGeometry {
  const vertices = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1]);
  const indices = [
    0,1,2, 0,2,3, 4,5,6, 4,6,7, 3,7,6, 3,6,2, 0,1,5, 0,5,4, 0,4,7, 0,7,3, 1,2,6, 1,6,5,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

export function createDisconnectedShells(): THREE.BufferGeometry {
  const vertices = new Float32Array([
    0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1,
    3,0,0, 4,0,0, 4,1,0, 3,1,0, 3,0,1, 4,0,1, 4,1,1, 3,1,1,
  ]);
  const indices = [
    0,2,1, 0,3,2, 4,5,6, 4,6,7, 3,7,6, 3,6,2, 0,1,5, 0,5,4, 0,4,7, 0,7,3, 1,2,6, 1,6,5,
    8,10,9, 8,11,10, 12,13,14, 12,14,15, 11,15,14, 11,14,10, 8,9,13, 8,13,12, 8,12,15, 8,15,11, 9,10,14, 9,14,13,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

export function createNonManifoldEdge(): THREE.BufferGeometry {
  const vertices = new Float32Array([0,0,0, 1,0,0, 0,1,0, 1,1,0, 0,0,1]);
  const indices = [0,1,2, 1,3,2, 1,2,4];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

export function createNonIndexedGeometry(): THREE.BufferGeometry {
  const vertices = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,0,0, 1,1,0, 0,1,0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  return geo;
}

export function createSingleTriangle(): THREE.BufferGeometry {
  const vertices = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex([0,1,2]);
  return geo;
}

export function createLargeFlatPlate(length: number = 100): THREE.BufferGeometry {
  const h = length / 2;
  const vertices = new Float32Array([
    -h, 0, -h,  h, 0, -h,  h, 0, h,  -h, 0, h,
  ]);
  const indices = [0, 2, 1,  0, 3, 2];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

export function createThinWall(segments: number = 10): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const x = t * 10;
    positions.push(x, 0, 0, x, 0, 0.4, x, 1, 0, x, 1, 0.4);

    const base = i * 4;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    if (i > 0) {
      const prev = (i - 1) * 4;
      indices.push(prev + 1, base, prev + 2, base + 2, prev + 2, base);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  return geo;
}

export function createIcosphere(subdivisions: number = 0): THREE.BufferGeometry {
  const src = new THREE.IcosahedronGeometry(1, subdivisions);
  const rawPos = src.getAttribute('position').array as Float32Array;
  const vertMap = new Map<string, number>();
  const outPos: number[] = [];
  const outIdx: number[] = [];
  for (let i = 0; i < rawPos.length; i += 3) {
    const key = `${rawPos[i].toFixed(6)},${rawPos[i+1].toFixed(6)},${rawPos[i+2].toFixed(6)}`;
    let idx = vertMap.get(key);
    if (idx === undefined) {
      idx = outPos.length / 3;
      vertMap.set(key, idx);
      outPos.push(rawPos[i], rawPos[i+1], rawPos[i+2]);
    }
    outIdx.push(idx);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outPos), 3));
  geo.setIndex(outIdx);
  geo.computeVertexNormals();
  return geo;
}

export function createTerrainGrid(size: number, rows: number, cols: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c / (cols - 1)) * size;
      const z = (r / (rows - 1)) * size;
      const y = Math.sin(x * 0.5) * Math.cos(z * 0.5) * 0.3;
      positions.push(x, y, z);
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i0 = r * cols + c;
      const i1 = r * cols + c + 1;
      const i2 = (r + 1) * cols + c;
      const i3 = (r + 1) * cols + c + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  return geo;
}

export function createOverhangPlate(width: number, depth: number, angleDeg: number): THREE.BufferGeometry {
  const a = (angleDeg * Math.PI) / 180;
  const height = depth * Math.tan(a);
  const vertices = new Float32Array([
    -width / 2, 0,      -depth / 2,
    width / 2,  0,      -depth / 2,
    width / 2,  height,  depth / 2,
    -width / 2, height,  depth / 2,
  ]);
  const indices = [0, 2, 1,  0, 3, 2];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

export function createWatertightCubeModel(): GeometryModel {
  return geoToModel(createWatertightCube());
}
export function createOpenCubeModel(): GeometryModel {
  return geoToModel(createOpenCube());
}
export function createCubeWithInvertedNormalsModel(): GeometryModel {
  return geoToModel(createCubeWithInvertedNormals());
}
export function createDisconnectedShellsModel(): GeometryModel {
  return geoToModel(createDisconnectedShells());
}
export function createNonManifoldEdgeModel(): GeometryModel {
  return geoToModel(createNonManifoldEdge());
}
export function createNonIndexedModel(): GeometryModel {
  return geoToModel(createNonIndexedGeometry());
}
export function createSingleTriangleModel(): GeometryModel {
  return geoToModel(createSingleTriangle());
}
export function createThinWallModel(segments?: number): GeometryModel {
  return geoToModel(createThinWall(segments));
}
export function createIcosphereModel(subdivisions?: number): GeometryModel {
  return geoToModel(createIcosphere(subdivisions));
}
export function createTerrainGridModel(size: number, rows: number, cols: number): GeometryModel {
  return geoToModel(createTerrainGrid(size, rows, cols));
}
