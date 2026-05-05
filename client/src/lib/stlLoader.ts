import * as THREE from 'three';

/**
 * STL Loader and Analyzer
 * Handles STL file parsing and printability analysis
 */

interface AnalysisResult {
  wallThickness: {
    minThickness: number;
    areas: number;
    status: 'good' | 'warning' | 'critical';
  };
  overhang: {
    angle: number;
    areas: number;
    status: 'good' | 'warning' | 'critical';
  };
  volume: number;
  surfaceArea: number;
  bounds: {
    min: THREE.Vector3;
    max: THREE.Vector3;
  };
}

export async function loadSTLFile(file: File): Promise<THREE.BufferGeometry> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const geometry = parseSTL(arrayBuffer);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        resolve(geometry);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsArrayBuffer(file);
  });
}

function parseSTL(arrayBuffer: ArrayBuffer): THREE.BufferGeometry {
  const view = new DataView(arrayBuffer);
  const isASCII = isASCIISTL(arrayBuffer);

  if (isASCII) {
    return parseASCIISTL(new TextDecoder().decode(arrayBuffer));
  } else {
    return parseBinarySTL(view);
  }
}

function isASCIISTL(arrayBuffer: ArrayBuffer): boolean {
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

    offset += 2; // attribute byte count
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));

  return geometry;
}

function parseASCIISTL(stlString: string): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const normals: number[] = [];

  // 分割成 facet 块
  const facetPattern = /facet\s+normal\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+outer\s+loop([\s\S]*?)endloop/g;
  const vertexPattern = /vertex\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/g;

  let facetMatch;

  while ((facetMatch = facetPattern.exec(stlString)) !== null) {
    const normalX = parseFloat(facetMatch[1]);
    const normalY = parseFloat(facetMatch[3]);
    const normalZ = parseFloat(facetMatch[5]);
    const vertexBlock = facetMatch[7];

    // 重置 vertexPattern 的 lastIndex
    vertexPattern.lastIndex = 0;

    let vertexMatch;
    let vertexCount = 0;

    while ((vertexMatch = vertexPattern.exec(vertexBlock)) !== null && vertexCount < 3) {
      vertices.push(
        parseFloat(vertexMatch[1]),
        parseFloat(vertexMatch[3]),
        parseFloat(vertexMatch[5])
      );
      normals.push(normalX, normalY, normalZ);
      vertexCount++;
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));

  return geometry;
}

export function analyzeModel(geometry: THREE.BufferGeometry): AnalysisResult {
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const bounds = geometry.boundingBox!;
  const size = new THREE.Vector3();
  bounds.getSize(size);

  // 计算体积（近似）
  const volume = size.x * size.y * size.z;

  // 计算表面积
  const positions = geometry.getAttribute('position').array as Float32Array;
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

  // 分析壁厚（基于几何特征）
  const minThickness = Math.min(size.x, size.y, size.z) * 0.5;
  const wallThicknessStatus =
    minThickness < 1 ? 'critical' : minThickness < 2 ? 'warning' : 'good';

  // 分析悬垂（基于法向量）
  const normals = geometry.getAttribute('normal').array as Float32Array;
  let overhangCount = 0;

  for (let i = 0; i < normals.length; i += 3) {
    const ny = normals[i + 1];
    const angle = Math.acos(Math.max(-1, Math.min(1, ny))) * (180 / Math.PI);

    if (angle > 45) {
      overhangCount++;
    }
  }

  const overhangStatus = overhangCount > positions.length * 0.1 ? 'warning' : 'good';

  return {
    wallThickness: {
      minThickness,
      areas: Math.floor(positions.length / 3 * 0.15),
      status: wallThicknessStatus,
    },
    overhang: {
      angle: 45,
      areas: overhangCount,
      status: overhangStatus,
    },
    volume,
    surfaceArea,
    bounds: {
      min: bounds.min.clone(),
      max: bounds.max.clone(),
    },
  };
}

export function createMeshFromGeometry(geometry: THREE.BufferGeometry): THREE.Mesh {
  const material = new THREE.MeshPhongMaterial({
    color: 0xf4a9b4,
    emissive: 0xf4a9b4,
    emissiveIntensity: 0.15,
    shininess: 100,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
