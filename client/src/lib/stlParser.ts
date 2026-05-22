import * as THREE from 'three';

export function parseSTL(arrayBuffer: ArrayBuffer): THREE.BufferGeometry {
  const view = new DataView(arrayBuffer);
  const isASCII = isASCIISTL(arrayBuffer);

  if (isASCII) {
    return parseASCIISTL(new TextDecoder().decode(arrayBuffer));
  }

  return parseBinarySTL(view);
}

export function isASCIISTL(arrayBuffer: ArrayBuffer): boolean {
  const view = new Uint8Array(arrayBuffer);
  const header = new TextDecoder().decode(view.slice(0, 5));
  return header === 'solid';
}

function parseBinarySTL(view: DataView): THREE.BufferGeometry {
  const faces = view.getUint32(80, true);
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const normals: number[] = [];

  let offset = 84;

  for (let i = 0; i < faces; i++) {
    const nx = view.getFloat32(offset, true);
    offset += 4;
    const ny = view.getFloat32(offset, true);
    offset += 4;
    const nz = view.getFloat32(offset, true);
    offset += 4;

    for (let j = 0; j < 3; j++) {
      vertices.push(view.getFloat32(offset, true));
      offset += 4;
      vertices.push(view.getFloat32(offset, true));
      offset += 4;
      vertices.push(view.getFloat32(offset, true));
      offset += 4;

      normals.push(nx, ny, nz);
    }

    offset += 2;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));

  return geometry;
}

function parseASCIISTL(stlString: string): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const normals: number[] = [];

  const facetPattern = /facet\s+normal\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+outer\s+loop([\s\S]*?)endloop/g;
  const vertexPattern = /vertex\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/g;

  let facetMatch;

  while ((facetMatch = facetPattern.exec(stlString)) !== null) {
    const normalX = parseFloat(facetMatch[1]);
    const normalY = parseFloat(facetMatch[3]);
    const normalZ = parseFloat(facetMatch[5]);
    const vertexBlock = facetMatch[7];

    vertexPattern.lastIndex = 0;

    let vertexMatch;
    let vertexCount = 0;

    while ((vertexMatch = vertexPattern.exec(vertexBlock)) !== null && vertexCount < 3) {
      vertices.push(
        parseFloat(vertexMatch[1]),
        parseFloat(vertexMatch[3]),
        parseFloat(vertexMatch[5]),
      );
      normals.push(normalX, normalY, normalZ);
      vertexCount++;
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));

  return geometry;
}
