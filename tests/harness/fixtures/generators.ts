/**
 * S3 — Synthetic Mesh Generators
 *
 * Factory functions that create GeometryModel instances from generation params.
 * Reuses patterns from testMeshes.ts and geometry.ts but follows S3 schema.
 */

import * as THREE from "three";
import {
  createGeometryModel,
  type GeometryModel,
} from "../../../client/src/analysis/geometryModel";
import type { MeshGenerationParams } from "../s3-schema";

/**
 * Generate a GeometryModel from S3 MeshGenerationParams.
 */
export function generateMesh(params: MeshGenerationParams): GeometryModel {
  switch (params.type) {
    case "watertight-cube":
      return createWatertightCube(params.params.size ?? 1);
    case "open-cube":
      return createOpenCube(params.params.size ?? 1);
    case "inverted-normals":
      return createInvertedNormalsCube(params.params.size ?? 1);
    case "disconnected-shells":
      return createDisconnectedShells(params.params.size ?? 1);
    case "non-manifold-edge":
      return createNonManifoldEdge(params.params.size ?? 1);
    case "thin-wall":
      return createThinWall(
        params.params.width ?? 0.5,
        params.params.height ?? 10,
        params.params.depth ?? 10
      );
    case "overhang-plate":
      return createOverhangPlate(
        params.params.size ?? 20,
        params.params.angleDeg ?? 60
      );
    case "large-flat-plate":
      return createLargeFlatPlate(params.params.size ?? 50);
    case "icosphere":
      return createIcosphere(
        params.params.radius ?? 5,
        params.params.segments ?? 2
      );
    case "terrain-grid":
      return createTerrainGrid(
        params.params.size ?? 10,
        params.params.segments ?? 10
      );
    case "single-triangle":
      return createSingleTriangle(params.params.size ?? 10);
    case "thin-walled-tube":
      return createThinWalledTube(
        params.params.outerRadius ?? 5,
        params.params.innerRadius ?? 4.5,
        params.params.height ?? 10
      );
    case "thin-plate":
      return createThinPlate(
        params.params.width ?? 20,
        params.params.height ?? 20,
        params.params.thickness ?? 0.2
      );
    case "suspended-ceiling":
      return createSuspendedCeiling(params.params.size ?? 20);
    case "welded-box":
      return createWeldedBox(params.params.size ?? 10);
    case "box3":
      return createBox3(params.params.size ?? 5);
    case "noisy":
      return createNoisyCube(
        params.params.size ?? 10,
        params.params.noise ?? 0.1
      );
    case "degenerate":
      return createDegenerateMesh();
    case "empty":
      return createEmptyMesh();
    default:
      throw new Error(`Unknown mesh type: ${params.type}`);
  }
}

// ---------------------------------------------------------------------------
// Geometry factories
// ---------------------------------------------------------------------------

function geometryToModel(geometry: THREE.BufferGeometry): GeometryModel {
  const geo = geometry.index ? geometry : geometry.toNonIndexed();
  const positions = geo.attributes.position as THREE.BufferAttribute;
  const normals = geo.attributes.normal as THREE.BufferAttribute;

  return createGeometryModel(
    new Float32Array(positions.array),
    normals
      ? new Float32Array(normals.array)
      : new Float32Array(positions.count * 3),
    geo.index
      ? new Uint32Array((geo.index as THREE.BufferAttribute).array)
      : new Uint32Array(Array.from({ length: positions.count }, (_, i) => i)),
  );
}

function createWatertightCube(size: number): GeometryModel {
  const half = size / 2;
  const vertices = new Float32Array([
    -half, -half, -half,  // 0
    half, -half, -half,  // 1
    half, half, -half,   // 2
    -half, half, -half,  // 3
    -half, -half, half,  // 4
    half, -half, half,   // 5
    half, half, half,    // 6
    -half, half, half,   // 7
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2,  // Bottom
    4, 5, 6, 4, 6, 7,  // Top
    3, 7, 6, 3, 6, 2,  // Back
    0, 1, 5, 0, 5, 4,  // Front
    0, 4, 7, 0, 7, 3,  // Left
    1, 2, 6, 1, 6, 5,  // Right
  ]);
  const normals = new Float32Array(vertices.length);
  return createGeometryModel(vertices, normals, indices);
}

function createOpenCube(size: number): GeometryModel {
  const half = size / 2;
  const vertices = new Float32Array([
    -half, -half, -half,  // 0
    half, -half, -half,  // 1
    half, half, -half,   // 2
    -half, half, -half,  // 3
    -half, -half, half,  // 4
    half, -half, half,   // 5
    half, half, half,    // 6
    -half, half, half,   // 7
  ]);
  // Cube without top face (indices 12-17 removed)
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2,  // Bottom
    3, 7, 6, 3, 6, 2,  // Back
    0, 1, 5, 0, 5, 4,  // Front
    0, 4, 7, 0, 7, 3,  // Left
    1, 2, 6, 1, 6, 5,  // Right
  ]);
  const normals = new Float32Array(vertices.length);
  return createGeometryModel(vertices, normals, indices);
}

function createInvertedNormalsCube(size: number): GeometryModel {
  const half = size / 2;
  const vertices = new Float32Array([
    -half, -half, -half,  // 0
    half, -half, -half,  // 1
    half, half, -half,   // 2
    -half, half, -half,  // 3
    -half, -half, half,  // 4
    half, -half, half,   // 5
    half, half, half,    // 6
    -half, half, half,   // 7
  ]);
  // Cube with inverted winding order (flipped normals)
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,  // Bottom (inverted)
    4, 6, 5, 4, 7, 6,  // Top (inverted)
    3, 6, 7, 3, 2, 6,  // Back (inverted)
    0, 5, 1, 0, 4, 5,  // Front (inverted)
    0, 7, 4, 0, 3, 7,  // Left (inverted)
    1, 6, 2, 1, 5, 6,  // Right (inverted)
  ]);
  const normals = new Float32Array(vertices.length);
  return createGeometryModel(vertices, normals, indices);
}

function createDisconnectedShells(size: number): GeometryModel {
  const half = size / 2;
  const offset = size * 2;
  const vertices = new Float32Array([
    // Cube 1
    -half - offset, -half, -half,  // 0
    half - offset, -half, -half,  // 1
    half - offset, half, -half,   // 2
    -half - offset, half, -half,  // 3
    -half - offset, -half, half,  // 4
    half - offset, -half, half,   // 5
    half - offset, half, half,    // 6
    -half - offset, half, half,   // 7
    // Cube 2
    -half + offset, -half, -half,  // 8
    half + offset, -half, -half,  // 9
    half + offset, half, -half,   // 10
    -half + offset, half, -half,  // 11
    -half + offset, -half, half,  // 12
    half + offset, -half, half,   // 13
    half + offset, half, half,    // 14
    -half + offset, half, half,   // 15
  ]);
  const indices = new Uint32Array([
    // Cube 1
    0, 2, 1, 0, 3, 2,  // Bottom
    4, 5, 6, 4, 6, 7,  // Top
    3, 7, 6, 3, 6, 2,  // Back
    0, 1, 5, 0, 5, 4,  // Front
    0, 4, 7, 0, 7, 3,  // Left
    1, 2, 6, 1, 6, 5,  // Right
    // Cube 2
    8, 10, 9, 8, 11, 10,  // Bottom
    12, 13, 14, 12, 14, 15,  // Top
    11, 15, 14, 11, 14, 10,  // Back
    8, 9, 13, 8, 13, 12,  // Front
    8, 12, 15, 8, 15, 11,  // Left
    9, 10, 14, 9, 14, 13,  // Right
  ]);
  const normals = new Float32Array(vertices.length);
  return createGeometryModel(vertices, normals, indices);
}

function createNonManifoldEdge(size: number): GeometryModel {
  // Create two triangles sharing an edge but with non-manifold configuration
  const vertices = new Float32Array([
    // Triangle 1
    0,
    0,
    0,
    size,
    0,
    0,
    size / 2,
    size,
    0,
    // Triangle 2 (shares edge 0-1, but also connects to a third vertex)
    0,
    0,
    0,
    size,
    0,
    0,
    size / 2,
    -size,
    0,
    // Triangle 3 (creates non-manifold edge at 0-1)
    0,
    0,
    0,
    size,
    0,
    0,
    0,
    0,
    size,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometryToModel(geometry);
}

function createThinWall(
  width: number,
  height: number,
  depth: number
): GeometryModel {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  return geometryToModel(geometry);
}

function createOverhangPlate(size: number, angleDeg: number): GeometryModel {
  const geometry = new THREE.BoxGeometry(size, 0.5, size);
  // Rotate to create overhang
  const rad = (angleDeg * Math.PI) / 180;
  geometry.rotateX(rad);
  return geometryToModel(geometry);
}

function createLargeFlatPlate(size: number): GeometryModel {
  const geometry = new THREE.BoxGeometry(size, 0.5, size);
  return geometryToModel(geometry);
}

function createIcosphere(radius: number, segments: number): GeometryModel {
  const geometry = new THREE.IcosahedronGeometry(radius, segments);
  return geometryToModel(geometry);
}

function createTerrainGrid(size: number, segments: number): GeometryModel {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  // Add some height variation
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    positions.setZ(i, Math.sin(x * 0.5) * Math.cos(y * 0.5) * 0.5);
  }
  geometry.computeVertexNormals();
  // Rotate to be horizontal
  geometry.rotateX(-Math.PI / 2);
  return geometryToModel(geometry);
}

function createSingleTriangle(size: number): GeometryModel {
  const vertices = new Float32Array([0, 0, 0, size, 0, 0, size / 2, size, 0]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometryToModel(geometry);
}

function createThinWalledTube(
  outerRadius: number,
  innerRadius: number,
  height: number
): GeometryModel {
  const outer = new THREE.CylinderGeometry(
    outerRadius,
    outerRadius,
    height,
    32
  );
  const inner = new THREE.CylinderGeometry(
    innerRadius,
    innerRadius,
    height,
    32
  );
  // Create tube by subtracting inner from outer (simplified: just outer shell)
  return geometryToModel(outer);
}

function createThinPlate(
  width: number,
  height: number,
  thickness: number
): GeometryModel {
  const geometry = new THREE.BoxGeometry(width, thickness, height);
  return geometryToModel(geometry);
}

function createSuspendedCeiling(size: number): GeometryModel {
  const geometry = new THREE.BoxGeometry(size, 0.3, size);
  geometry.translate(0, size / 2, 0);
  return geometryToModel(geometry);
}

function createWeldedBox(size: number): GeometryModel {
  const geometry = new THREE.BoxGeometry(size, size, size);
  return geometryToModel(geometry);
}

function createBox3(size: number): GeometryModel {
  const geometry = new THREE.BoxGeometry(size, size, size);
  return geometryToModel(geometry);
}

function createNoisyCube(size: number, noise: number): GeometryModel {
  const geometry = new THREE.BoxGeometry(size, size, size, 10, 10, 10);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    positions.setX(i, positions.getX(i) + (Math.random() - 0.5) * noise);
    positions.setY(i, positions.getY(i) + (Math.random() - 0.5) * noise);
    positions.setZ(i, positions.getZ(i) + (Math.random() - 0.5) * noise);
  }
  geometry.computeVertexNormals();
  return geometryToModel(geometry);
}

function createDegenerateMesh(): GeometryModel {
  // Create a mesh with degenerate triangles (zero area)
  const vertices = new Float32Array([
    0,
    0,
    0,
    0,
    0,
    0, // Degenerate: all same point
    0,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0, // Degenerate: two same points
    1,
    0,
    0,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  return geometryToModel(geometry);
}

function createEmptyMesh(): GeometryModel {
  return createGeometryModel(
    new Float32Array(0),
    new Float32Array(0),
    new Uint32Array(0),
  );
}

function mergeGeometries(
  geometries: THREE.BufferGeometry[]
): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const geo of geometries) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const idx = geo.index as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }

    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(idx.getX(i) + vertexOffset);
      }
    }

    vertexOffset += pos.count;
  }

  merged.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(positions), 3)
  );
  if (indices.length > 0) {
    merged.setIndex(indices);
  }
  merged.computeVertexNormals();
  return merged;
}
