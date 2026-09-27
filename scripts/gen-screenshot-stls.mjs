/**
 * Generate STL files for Playwright screenshot captures.
 * Uses three.js + STLExporter (same as the client code) in Node.js.
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
  // STLExporter returns a DataView — extract the underlying buffer
  const arrayBuffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
  const path = join(OUT, `${name}.stl`);
  writeFileSync(path, Buffer.from(arrayBuffer));
  console.log(`  ${name}.stl — ${geo.getAttribute('position').count} verts, ${geo.index ? geo.index.count / 3 : geo.getAttribute('position').count / 3} tris, ${arrayBuffer.byteLength} bytes`);
}

// --- 1. Tall cylinder (multi-bin varying thickness) ---
function createTallCylinder() {
  const segments = 16, radius = 5, height = 100;
  const vertices = [], normals = [], indices = [];

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    vertices.push(x, y, 0,  x, y, height);
    normals.push(Math.cos(angle), Math.sin(angle), 0,  Math.cos(angle), Math.sin(angle), 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, c, b,  b, c, d);
  }
  // Bottom cap
  const ci = vertices.length / 3;
  vertices.push(0, 0, 0); normals.push(0, 0, -1);
  for (let i = 0; i < segments; i++) indices.push(ci, (i + 1) * 2, i * 2);
  // Top cap
  const ti = vertices.length / 3;
  vertices.push(0, 0, height); normals.push(0, 0, 1);
  for (let i = 0; i < segments; i++) indices.push(ti, i * 2 + 1, (i + 1) * 2 + 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setIndex(indices);
  return geo;
}

// --- 2. Sparse mesh (single large triangle — near-zero volume) ---
function createSparseMesh() {
  const geo = new THREE.BufferGeometry();
  const vertices = new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex([0, 1, 2]);
  return geo;
}

// --- 3. Watertight cube (normal baseline — same as 01) ---
function createWatertightCube() {
  const vertices = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1]);
  const indices = [
    0,2,1, 0,3,2, 4,5,6, 4,6,7, 3,7,6, 3,6,2, 0,1,5, 0,5,4, 0,4,7, 0,7,3, 1,2,6, 1,6,5,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

// --- 4. Open cube (not watertight — for warning screenshot) ---
function createOpenCube() {
  const vertices = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1]);
  const indices = [
    0,2,1, 0,3,2, 3,7,6, 3,6,2, 0,1,5, 0,5,4, 0,4,7, 0,7,3, 1,2,6, 1,6,5,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  return geo;
}

console.log('Generating STL files for screenshot captures:');
geoToStl(createTallCylinder(), 'tall-cylinder');
geoToStl(createSparseMesh(), 'sparse-mesh');
geoToStl(createWatertightCube(), 'watertight-cube');
geoToStl(createOpenCube(), 'open-cube');
console.log(`Done — files in ${OUT}`);
