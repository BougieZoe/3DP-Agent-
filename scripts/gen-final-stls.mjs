/**
 * Generate STL files for the final screenshot round.
 * Mesh A: thin wall (0.4mm) — must produce red bar in histogram
 * Mesh B: stepped wall (0.5mm + 4mm) — genuine bimodal distribution
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

const OUT = join(import.meta.dirname, '..', 'docs', '_stls');
mkdirSync(OUT, { recursive: true });

function geoToStl(geo, name) {
  const mesh = new THREE.Mesh(geo);
  const exporter = new STLExporter();
  const result = exporter.parse(mesh, { binary: true });
  const arrayBuffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
  const path = join(OUT, `${name}.stl`);
  writeFileSync(path, Buffer.from(arrayBuffer));
  console.log(`  ${name}.stl — ${geo.getAttribute('position').count} verts, ${geo.index ? geo.index.count / 3 : geo.getAttribute('position').count / 3} tris, ${arrayBuffer.byteLength} bytes`);
}

// --- Mesh A: thin wall (0.4mm) from testMeshes.ts:createThinWall ---
function createThinWall() {
  const segments = 10;
  const positions = [];
  const indices = [];

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

// --- Mesh B: stepped wall — left half 0.5mm, right half 4mm ---
// This produces a genuine bimodal distribution in the histogram.
function createSteppedWall() {
  const vertices = [];
  const indices = [];

  // Left half: x=[0,5], y=[0,10], z=[0,0.5] (thin)
  // Right half: x=[5,10], y=[0,10], z=[0,4] (thick)
  //
  // Bottom face (z=0): 6 vertices
  //   L0=(0,0,0) L1=(5,0,0) L2=(5,10,0) L3=(0,10,0)
  //   R1=(5,0,0) R2=(5,10,0) R4=(10,0,0) R5=(10,10,0)
  // Top face thin (z=0.5): L4=(0,0,0.5) L5=(5,0,0.5) L6=(5,10,0.5) L7=(0,10,0.5)
  // Top face thick (z=4): R6=(5,0,4) R7=(5,10,4) R8=(10,0,4) R9=(10,10,4)

  // Shared vertices:
  // 0: (0,0,0)    1: (5,0,0)    2: (5,10,0)    3: (0,10,0)
  // 4: (10,0,0)   5: (10,10,0)
  // 6: (0,0,0.5)  7: (5,0,0.5)  8: (5,10,0.5)  9: (0,10,0.5)
  // 10: (5,0,4)   11: (5,10,4)  12: (10,0,4)   13: (10,10,4)

  const v = [
    [0,0,0],    // 0
    [5,0,0],    // 1
    [5,10,0],   // 2
    [0,10,0],   // 3
    [10,0,0],   // 4
    [10,10,0],  // 5
    [0,0,0.5],  // 6
    [5,0,0.5],  // 7
    [5,10,0.5], // 8
    [0,10,0.5], // 9
    [5,0,4],    // 10
    [5,10,4],   // 11
    [10,0,4],   // 12
    [10,10,4],  // 13
  ];

  // Faces (CCW winding for outward normals)
  const faces = [
    // Bottom face (z=0, normal -Z)
    [0,2,1], [0,3,2],
    // Right bottom extension (z=0)
    [1,5,4], [1,2,5],

    // Left top face (z=0.5, normal +Z)
    [6,7,8], [6,8,9],
    // Right top face (z=4, normal +Z)
    [10,12,13], [10,13,11],

    // Front face thin (y=0, normal -Y): 0,1,7,6
    [0,1,7], [0,7,6],
    // Front face thick (y=0): 1,4,12,10
    [1,4,12], [1,12,10],
    // Front step face (y=0, connecting thin top to thick top): 7,10,11,8
    [7,10,11], [7,11,8],

    // Back face thin (y=10, normal +Y): 3,9,8,2
    [3,9,8], [3,8,2],
    // Back face thick (y=10): 2,11,13,5
    [2,11,13], [2,13,5],
    // Back step face: 8,11,10,7 → but reversed for +Y
    [8,11,10], [8,10,7],  // actually need to check normal direction

    // Left face (x=0, normal -X): 0,6,9,3
    [0,6,9], [0,9,3],
    // Right face (x=10, normal +X): 4,5,13,12
    [4,5,13], [4,13,12],
  ];

  // Build indexed geometry
  const vertMap = new Map();
  const outPos = [];
  const outIdx = [];

  for (const face of faces) {
    for (const vi of face) {
      const key = v[vi].join(',');
      let idx = vertMap.get(key);
      if (idx === undefined) {
        idx = outPos.length / 3;
        vertMap.set(key, idx);
        outPos.push(...v[vi]);
      }
      outIdx.push(idx);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outPos), 3));
  geo.setIndex(outIdx);
  geo.computeVertexNormals();
  return geo;
}

console.log('Generating STL files for final round:');
geoToStl(createThinWall(), 'thin-wall-04mm');
geoToStl(createSteppedWall(), 'stepped-wall');
console.log(`Done — files in ${OUT}`);
