import * as THREE from 'three';

export interface IndexedTriangle {
  a: number;
  b: number;
  c: number;
}

const VERTEX_EQUALITY_EPSILON = 1e-8;

function vec3Key(x: number, y: number, z: number): string {
  const r = VERTEX_EQUALITY_EPSILON;
  return `${Math.round(x / r)},${Math.round(y / r)},${Math.round(z / r)}`;
}

function deduplicateVertices(
  rawPositions: number[],
  rawNormals: number[],
): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const vertMap = new Map<string, number>();
  const outPos: number[] = [];
  const outNorm: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < rawPositions.length; i += 3) {
    const x = rawPositions[i], y = rawPositions[i + 1], z = rawPositions[i + 2];
    const key = vec3Key(x, y, z);
    const nx = rawNormals[i], ny = rawNormals[i + 1], nz = rawNormals[i + 2];

    let existing = vertMap.get(key);
    if (existing === undefined) {
      existing = outPos.length / 3;
      vertMap.set(key, existing);
      outPos.push(x, y, z);
      outNorm.push(nx, ny, nz);
    }
    indices.push(existing);
  }

  return {
    positions: new Float32Array(outPos),
    normals: new Float32Array(outNorm),
    indices: new Uint32Array(indices),
  };
}

function parseBinarySTLIndexed(view: DataView): THREE.BufferGeometry {
  const faces = view.getUint32(80, true);
  const geometry = new THREE.BufferGeometry();
  const rawPositions: number[] = [];
  const rawNormals: number[] = [];

  let offset = 84;

  for (let i = 0; i < faces; i++) {
    const nx = view.getFloat32(offset, true); offset += 4;
    const ny = view.getFloat32(offset, true); offset += 4;
    const nz = view.getFloat32(offset, true); offset += 4;

    for (let j = 0; j < 3; j++) {
      rawPositions.push(view.getFloat32(offset, true)); offset += 4;
      rawPositions.push(view.getFloat32(offset, true)); offset += 4;
      rawPositions.push(view.getFloat32(offset, true)); offset += 4;
      rawNormals.push(nx, ny, nz);
    }

    offset += 2;
  }

  const { positions, normals, indices } = deduplicateVertices(rawPositions, rawNormals);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return geometry;
}

function parseASCIISTLIndexed(stlString: string): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const rawPositions: number[] = [];
  const rawNormals: number[] = [];

  const facetPattern = /facet\s+normal\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+outer\s+loop([\s\S]*?)endloop/g;
  const vertexPattern = /vertex\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/g;

  let facetMatch;
  while ((facetMatch = facetPattern.exec(stlString)) !== null) {
    const normalX = parseFloat(facetMatch[1]);
    const normalY = parseFloat(facetMatch[3]);
    const normalZ = parseFloat(facetMatch[5]);
    const vertexBlock = facetMatch[7];

    vertexPattern.lastIndex = 0;
    let vertexCount = 0;
    let vertexMatch;

    while ((vertexMatch = vertexPattern.exec(vertexBlock)) !== null && vertexCount < 3) {
      rawPositions.push(
        parseFloat(vertexMatch[1]),
        parseFloat(vertexMatch[3]),
        parseFloat(vertexMatch[5]),
      );
      rawNormals.push(normalX, normalY, normalZ);
      vertexCount++;
    }
  }

  const { positions, normals, indices } = deduplicateVertices(rawPositions, rawNormals);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return geometry;
}

export function isASCIISTL(arrayBuffer: ArrayBuffer): boolean {
  const view = new Uint8Array(arrayBuffer);
  const header = new TextDecoder().decode(view.slice(0, 5));
  return header === 'solid';
}

export function parseSTL(arrayBuffer: ArrayBuffer): THREE.BufferGeometry {
  const isASCII = isASCIISTL(arrayBuffer);

  if (isASCII) {
    return parseASCIISTLIndexed(new TextDecoder().decode(arrayBuffer));
  }
  return parseBinarySTLIndexed(new DataView(arrayBuffer));
}
