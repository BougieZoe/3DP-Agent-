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
} from "../../client/src/analysis/geometryModel";
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

  return createGeometryModel({
    positions: new Float32Array(positions.array),
    normals: normals
      ? new Float32Array(normals.array)
      : new Float32Array(positions.count * 3),
    indices: geo.index
      ? new Uint32Array((geo.index as THREE.BufferAttribute).array)
      : new Uint32Array(Array.from({ length: positions.count }, (_, i) => i)),
  });
}

function createWatertightCube(size: number): GeometryModel {
  const geometry = new THREE.BoxGeometry(size, size, size);
  return geometryToModel(geometry);
}

function createOpenCube(size: number): GeometryModel {
  const geometry = new THREE.BoxGeometry(size, size, size);
  // Remove top face (indices 12-17 for a box)
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const indices = geometry.index as THREE.BufferAttribute;
  const newIndices: number[] = [];
  for (let i = 0; i < indices.count; i += 3) {
    const a = indices.getX(i);
    const b = indices.getX(i + 1);
    const c = indices.getX(i + 2);
    // Get z-coordinates of triangle vertices
    const az = positions.getZ(a);
    const bz = positions.getZ(b);
    const cz = positions.getZ(c);
    // Skip top face (all z > size/2 - epsilon)
    if (
      az > size / 2 - 0.001 &&
      bz > size / 2 - 0.001 &&
      cz > size / 2 - 0.001
    ) {
      continue;
    }
    newIndices.push(a, b, c);
  }
  geometry.setIndex(newIndices);
  return geometryToModel(geometry);
}

function createInvertedNormalsCube(size: number): GeometryModel {
  const geometry = new THREE.BoxGeometry(size, size, size);
  geometry.computeVertexNormals();
  // Flip normals
  const normals = geometry.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < normals.count; i++) {
    normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
  }
  return geometryToModel(geometry);
}

function createDisconnectedShells(size: number): GeometryModel {
  const geo1 = new THREE.BoxGeometry(size, size, size);
  geo1.translate(-size, 0, 0);
  const geo2 = new THREE.BoxGeometry(size, size, size);
  geo2.translate(size, 0, 0);

  const merged = mergeGeometries([geo1, geo2]);
  return geometryToModel(merged);
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
  return createGeometryModel({
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
  });
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
