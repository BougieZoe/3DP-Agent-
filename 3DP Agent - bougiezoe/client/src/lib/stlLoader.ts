import * as THREE from 'three';

/**
 * STL Loader and Analyzer
 * Handles STL file parsing and printability analysis
 */

type PrintabilityStatus = 'good' | 'warning' | 'critical';

export interface Vec3Data {
  x: number;
  y: number;
  z: number;
}

export interface HoleFeature {
  center: Vec3Data;
  diameter: number;
  radius: number;
  axis: Vec3Data;
  vertices: number;
  type: 'boundary-loop' | 'non-manifold';
}

export interface AnalysisResult {
  wallThickness: {
    minThickness: number;
    averageThickness: number;
    areas: number;
    sampledPoints: number;
    method: string;
    status: PrintabilityStatus;
  };
  overhang: {
    angle: number;
    areas: number;
    maxAngle: number;
    averageAngle: number;
    faceRatio: number;
    area: number;
    samplePoints: Array<Vec3Data & { angle: number }>;
    status: PrintabilityStatus;
  };
  volume: number;
  boundingBoxVolume: number;
  surfaceArea: number;
  mesh: {
    faceCount: number;
    vertexCount: number;
    degenerateFaces: number;
    boundaryEdges: number;
    nonManifoldEdges: number;
    isWatertight: boolean;
    centerOfMass: Vec3Data;
  };
  holes: {
    count: number;
    boundaryLoops: HoleFeature[];
  };
  bounds: {
    min: THREE.Vector3;
    max: THREE.Vector3;
  };
}

interface FaceSample {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  centroid: THREE.Vector3;
  normal: THREE.Vector3;
  area: number;
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

  const boundingBoxVolume = size.x * size.y * size.z;
  const positions = geometry.getAttribute('position').array as Float32Array;
  const faceCount = Math.floor(positions.length / 9);
  const vertexCount = Math.floor(positions.length / 3);
  const faces: FaceSample[] = [];
  let surfaceArea = 0;
  let signedVolume = 0;
  let degenerateFaces = 0;
  const volumeCentroid = new THREE.Vector3();
  const areaCentroid = new THREE.Vector3();

  for (let i = 0; i < positions.length; i += 9) {
    const v1 = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
    const v2 = new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]);
    const v3 = new THREE.Vector3(positions[i + 6], positions[i + 7], positions[i + 8]);

    const edge1 = new THREE.Vector3().subVectors(v2, v1);
    const edge2 = new THREE.Vector3().subVectors(v3, v1);
    const cross = new THREE.Vector3().crossVectors(edge1, edge2);
    const area = cross.length() / 2;
    const centroid = new THREE.Vector3().addVectors(v1, v2).add(v3).multiplyScalar(1 / 3);

    if (area <= 1e-8) {
      degenerateFaces++;
      continue;
    }

    const tetraVolume = v1.dot(new THREE.Vector3().crossVectors(v2, v3)) / 6;
    signedVolume += tetraVolume;
    volumeCentroid.add(new THREE.Vector3().addVectors(v1, v2).add(v3).multiplyScalar(tetraVolume / 4));
    areaCentroid.add(centroid.clone().multiplyScalar(area));
    surfaceArea += area;
    faces.push({
      a: v1,
      b: v2,
      c: v3,
      centroid,
      normal: cross.normalize(),
      area,
    });
  }

  const volume = Math.abs(signedVolume);
  const orientation = signedVolume < 0 ? -1 : 1;
  const centerOfMass = volume > 1e-8
    ? volumeCentroid.multiplyScalar(1 / signedVolume)
    : areaCentroid.multiplyScalar(1 / Math.max(surfaceArea, 1));

  for (const face of faces) {
    face.normal.multiplyScalar(orientation);
  }

  const edgeStats = analyzeEdges(faces);
  const holes = detectBoundaryLoops(edgeStats.boundaryEdges, edgeStats.vertexPositions);
  const overhang = analyzeOverhangs(faces, surfaceArea);
  const wallThickness = estimateWallThickness(geometry, faces, size);

  const wallThicknessStatus =
    wallThickness.minThickness < 1 ? 'critical' : wallThickness.minThickness < 2 ? 'warning' : 'good';
  const overhangStatus =
    overhang.maxAngle >= 70 || overhang.faceRatio > 0.2 ? 'critical' :
    overhang.areas > 0 ? 'warning' :
    'good';

  return {
    wallThickness: {
      minThickness: wallThickness.minThickness,
      averageThickness: wallThickness.averageThickness,
      areas: wallThickness.thinSamples,
      sampledPoints: wallThickness.sampledPoints,
      method: wallThickness.method,
      status: wallThicknessStatus,
    },
    overhang: {
      angle: 45,
      areas: overhang.areas,
      maxAngle: overhang.maxAngle,
      averageAngle: overhang.averageAngle,
      faceRatio: overhang.faceRatio,
      area: overhang.area,
      samplePoints: overhang.samplePoints,
      status: overhangStatus,
    },
    volume,
    boundingBoxVolume,
    surfaceArea,
    mesh: {
      faceCount,
      vertexCount,
      degenerateFaces,
      boundaryEdges: edgeStats.boundaryEdges.length,
      nonManifoldEdges: edgeStats.nonManifoldEdges,
      isWatertight: edgeStats.boundaryEdges.length === 0 && edgeStats.nonManifoldEdges === 0,
      centerOfMass: toVec3Data(centerOfMass),
    },
    holes: {
      count: holes.length,
      boundaryLoops: holes,
    },
    bounds: {
      min: bounds.min.clone(),
      max: bounds.max.clone(),
    },
  };
}

function analyzeOverhangs(faces: FaceSample[], totalArea: number) {
  let areas = 0;
  let area = 0;
  let weightedAngle = 0;
  let maxAngle = 0;
  const samplePoints: Array<Vec3Data & { angle: number }> = [];

  for (const face of faces) {
    const downward = Math.max(0, -face.normal.y);
    const angle = Math.asin(Math.max(-1, Math.min(1, downward))) * (180 / Math.PI);

    if (angle > 45) {
      areas++;
      area += face.area;
      weightedAngle += angle * face.area;
      maxAngle = Math.max(maxAngle, angle);

      if (samplePoints.length < 8) {
        samplePoints.push({ ...toVec3Data(face.centroid), angle });
      }
    }
  }

  return {
    areas,
    area,
    maxAngle,
    averageAngle: area > 0 ? weightedAngle / area : 0,
    faceRatio: faces.length > 0 ? areas / faces.length : 0,
    samplePoints,
  };
}

function estimateWallThickness(
  geometry: THREE.BufferGeometry,
  faces: FaceSample[],
  size: THREE.Vector3
) {
  const diagonal = size.length();
  const fallback = Math.min(size.x, size.y, size.z);

  if (faces.length === 0 || diagonal <= 0) {
    return {
      minThickness: fallback,
      averageThickness: fallback,
      thinSamples: 0,
      sampledPoints: 0,
      method: 'bounding-box fallback',
    };
  }

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster();
  raycaster.near = 0;
  raycaster.far = diagonal * 1.5;

  const epsilon = Math.max(diagonal * 1e-5, 0.01);
  const samples = selectWallSamples(faces, 260);
  const thicknesses: number[] = [];

  for (const face of samples) {
    const inward = face.normal.clone().multiplyScalar(-1).normalize();
    const origin = face.centroid.clone().addScaledVector(inward, epsilon);
    raycaster.set(origin, inward);

    const hit = raycaster
      .intersectObject(mesh, false)
      .find(intersection => intersection.distance > epsilon * 2);

    if (hit) {
      thicknesses.push(hit.distance + epsilon);
    }
  }

  if (thicknesses.length === 0) {
    return {
      minThickness: fallback,
      averageThickness: fallback,
      thinSamples: 0,
      sampledPoints: 0,
      method: 'bounding-box fallback',
    };
  }

  const minThickness = Math.min(...thicknesses);
  const averageThickness = thicknesses.reduce((sum, value) => sum + value, 0) / thicknesses.length;

  return {
    minThickness,
    averageThickness,
    thinSamples: thicknesses.filter(value => value < 2).length,
    sampledPoints: thicknesses.length,
    method: 'inward raycast samples',
  };
}

function selectWallSamples(faces: FaceSample[], limit: number) {
  if (faces.length <= limit) return faces;

  const sorted = [...faces].sort((a, b) => b.area - a.area);
  const step = Math.max(1, Math.floor(sorted.length / limit));
  const samples: FaceSample[] = [];

  for (let i = 0; i < sorted.length && samples.length < limit; i += step) {
    samples.push(sorted[i]);
  }

  return samples;
}

function analyzeEdges(faces: FaceSample[]) {
  const edges = new Map<string, number>();
  const edgeVertices = new Map<string, [string, string]>();
  const vertexPositions = new Map<string, THREE.Vector3>();

  for (const face of faces) {
    const keys = [vertexKey(face.a), vertexKey(face.b), vertexKey(face.c)];
    vertexPositions.set(keys[0], face.a);
    vertexPositions.set(keys[1], face.b);
    vertexPositions.set(keys[2], face.c);

    for (const [from, to] of [[keys[0], keys[1]], [keys[1], keys[2]], [keys[2], keys[0]]]) {
      const edgeKey = from < to ? `${from}|${to}` : `${to}|${from}`;
      edges.set(edgeKey, (edges.get(edgeKey) ?? 0) + 1);
      edgeVertices.set(edgeKey, from < to ? [from, to] : [to, from]);
    }
  }

  const boundaryEdges: Array<[string, string]> = [];
  let nonManifoldEdges = 0;

  for (const [edgeKey, count] of Array.from(edges.entries())) {
    if (count === 1) {
      const edge = edgeVertices.get(edgeKey);
      if (edge) boundaryEdges.push(edge);
    } else if (count > 2) {
      nonManifoldEdges++;
    }
  }

  return { boundaryEdges, nonManifoldEdges, vertexPositions };
}

function detectBoundaryLoops(
  boundaryEdges: Array<[string, string]>,
  vertexPositions: Map<string, THREE.Vector3>
): HoleFeature[] {
  const adjacency = new Map<string, string[]>();

  for (const [a, b] of boundaryEdges) {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  }

  const visitedEdges = new Set<string>();
  const loops: HoleFeature[] = [];

  for (const [start, neighbors] of Array.from(adjacency.entries())) {
    for (const next of neighbors) {
      const firstEdge = edgeKey(start, next);
      if (visitedEdges.has(firstEdge)) continue;

      const loop = [start];
      let previous = start;
      let current = next;
      visitedEdges.add(firstEdge);

      while (current !== start && loop.length <= boundaryEdges.length + 1) {
        loop.push(current);
        const candidates = adjacency.get(current) ?? [];
        const candidate = candidates.find(value => value !== previous && !visitedEdges.has(edgeKey(current, value)))
          ?? candidates.find(value => value !== previous);

        if (!candidate) break;
        visitedEdges.add(edgeKey(current, candidate));
        previous = current;
        current = candidate;
      }

      if (loop.length >= 3) {
        loops.push(buildHoleFeature(loop, vertexPositions));
      }
    }
  }

  return loops.slice(0, 12);
}

function buildHoleFeature(loop: string[], vertexPositions: Map<string, THREE.Vector3>): HoleFeature {
  const points = loop.map(key => vertexPositions.get(key)).filter(Boolean) as THREE.Vector3[];
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const radius = points.reduce((sum, point) => sum + point.distanceTo(center), 0) / points.length;
  const axis = estimateLoopAxis(points);

  return {
    center: toVec3Data(center),
    radius,
    diameter: radius * 2,
    axis: toVec3Data(axis),
    vertices: points.length,
    type: 'boundary-loop',
  };
}

function estimateLoopAxis(points: THREE.Vector3[]) {
  if (points.length < 3) return new THREE.Vector3(0, 1, 0);

  const normal = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    normal.x += (current.y - next.y) * (current.z + next.z);
    normal.y += (current.z - next.z) * (current.x + next.x);
    normal.z += (current.x - next.x) * (current.y + next.y);
  }

  return normal.lengthSq() > 0 ? normal.normalize() : new THREE.Vector3(0, 1, 0);
}

function vertexKey(vertex: THREE.Vector3) {
  return `${vertex.x.toFixed(4)},${vertex.y.toFixed(4)},${vertex.z.toFixed(4)}`;
}

function edgeKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function toVec3Data(vector: THREE.Vector3): Vec3Data {
  return { x: vector.x, y: vector.y, z: vector.z };
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
