/**
 * S3 — Debug Script
 *
 * Dumps the actual structure of the analysis pipeline output.
 */
import { runAnalysisPipeline } from "../client/src/analysis/pipeline";
import { createGeometryModel } from "../client/src/analysis/geometryModel";

function createTestCube() {
  // Simple 20mm cube
  const positions = new Float32Array([
    // Front face
    -10, -10, 10,  10, -10, 10,  10, 10, 10,
    -10, -10, 10,  10, 10, 10,  -10, 10, 10,
    // Back face
    -10, -10, -10,  -10, 10, -10,  10, 10, -10,
    -10, -10, -10,  10, 10, -10,  10, -10, -10,
    // Top face
    -10, 10, -10,  -10, 10, 10,  10, 10, 10,
    -10, 10, -10,  10, 10, 10,  10, 10, -10,
    // Bottom face
    -10, -10, -10,  10, -10, -10,  10, -10, 10,
    -10, -10, -10,  10, -10, 10,  -10, -10, 10,
    // Right face
    10, -10, -10,  10, 10, -10,  10, 10, 10,
    10, -10, -10,  10, 10, 10,  10, -10, 10,
    // Left face
    -10, -10, -10,  -10, -10, 10,  -10, 10, 10,
    -10, -10, -10,  -10, 10, 10,  -10, 10, -10,
  ]);

  const normals = new Float32Array(positions.length);
  // Simple normals for each face (front, back, top, bottom, right, left)
  const faceNormals = [
    [0, 0, 1],   // front
    [0, 0, -1],  // back
    [0, 1, 0],   // top
    [0, -1, 0],  // bottom
    [1, 0, 0],   // right
    [-1, 0, 0],  // left
  ];
  for (let i = 0; i < 6; i++) {
    const faceStart = i * 18;
    const [nx, ny, nz] = faceNormals[i];
    for (let j = 0; j < 6; j++) {
      normals[faceStart + j * 3] = nx;
      normals[faceStart + j * 3 + 1] = ny;
      normals[faceStart + j * 3 + 2] = nz;
    }
  }

  const indices = new Uint32Array(Array.from({ length: 36 }, (_, i) => i));

  return createGeometryModel(positions, normals, indices);
}

async function main() {
  const model = createTestCube();
  console.log("Model:", {
    vertices: model.vertexCount,
    triangles: model.triangleCount,
  });

  const result = runAnalysisPipeline(model);

  console.log("\n=== UnifiedAnalysis Structure ===");
  console.log("Keys:", Object.keys(result));

  console.log("\n=== topology ===");
  console.log("topology keys:", Object.keys(result.topology));
  console.log("topology.moduleName:", result.topology.moduleName);
  console.log("topology.result keys:", Object.keys(result.topology.result));
  console.log("topology.result:", result.topology.result);

  console.log("\n=== validation ===");
  console.log("validation keys:", Object.keys(result.validation));
  console.log("validation.result keys:", Object.keys(result.validation.result));
  console.log("validation.result:", result.validation.result);

  console.log("\n=== metrics ===");
  console.log("metrics keys:", Object.keys(result.metrics));
  console.log("metrics.result keys:", Object.keys(result.metrics.result));
  console.log("metrics.result:", result.metrics.result);

  console.log("\n=== bedFit ===");
  console.log("bedFit:", result.bedFit);

  console.log("\n=== support ===");
  console.log("support:", result.support);

  console.log("\n=== printTime ===");
  console.log("printTime:", result.printTime);

  console.log("\n=== thermal ===");
  console.log("thermal:", result.thermal);

  console.log("\n=== overallConfidence ===");
  console.log("overallConfidence:", result.overallConfidence);
}

main();
