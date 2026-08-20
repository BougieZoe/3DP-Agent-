// client/src/lib/modelLoader.ts
//
// Multi-format model loading for the analysis pipeline: STL (existing),
// OBJ, and 3MF. OBJ/3MF are parsed with three-stdlib loaders (already a
// dependency); 3MF additionally carries its units in the package, so we read
// them instead of asking the user to guess — that removes the "I declared cm
// but it was mm" class of wrong numbers.

import * as THREE from 'three';
import { OBJLoader, ThreeMFLoader } from 'three-stdlib';
import { unzipSync } from 'fflate';
import { loadSTLFile } from './stlLoader';
import type { LengthUnit } from '@shared/domain/geometry';

export interface LoadedModel {
  geometry: THREE.BufferGeometry;
  /** Detected unit (3MF declares its unit; STL/OBJ do not). */
  units?: LengthUnit;
}

/** Merge every mesh inside an Object3D (OBJ/3MF return a Group) into one BufferGeometry. */
function mergeObject3D(root: THREE.Object3D): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) geoms.push(mesh.geometry);
  });
  if (geoms.length === 0) return new THREE.BufferGeometry();

  const allPos: number[] = [];
  const allIdx: number[] = [];
  let offset = 0;
  let hasIndex = false;
  for (const g of geoms) {
    const pos = g.getAttribute('position');
    if (!pos) continue;
    for (let i = 0; i < pos.count; i++) {
      allPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    const idx = g.getIndex();
    if (idx) {
      hasIndex = true;
      for (let i = 0; i < idx.count; i++) allIdx.push(idx.getX(i) + offset);
    } else {
      // Non-indexed (typical of OBJ): every 3 consecutive vertices = 1 triangle.
      hasIndex = true;
      for (let i = 0; i < pos.count; i++) allIdx.push(i + offset);
    }
    offset += pos.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allPos), 3));
  if (hasIndex) out.setIndex(new THREE.BufferAttribute(new Uint32Array(allIdx), 1));
  out.computeVertexNormals();
  return out;
}

/**
 * Read the declared unit out of a 3MF package (3D/3dmodel.model → <model unit="…">).
 * Missing attribute defaults to millimeter per the 3MF spec.
 */
export function read3mfUnits(buffer: ArrayBuffer): LengthUnit | undefined {
  try {
    const zip = unzipSync(new Uint8Array(buffer));
    const model = zip['3D/3dmodel.model'];
    if (!model) return 'mm'; // spec default
    const xml = new TextDecoder().decode(model);
    const m = xml.match(/<model[^>]*\bunit="([^"]+)"/);
    const unit = m?.[1];
    if (unit === 'millimeter' || unit === undefined) return 'mm';
    if (unit === 'centimeter') return 'cm';
    if (unit === 'inch') return 'inch';
    return undefined; // micron / foot / meter — let the user choose
  } catch {
    return undefined;
  }
}

export async function loadModelFile(file: File): Promise<LoadedModel> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.stl')) {
    return { geometry: await loadSTLFile(file) };
  }
  if (lower.endsWith('.obj')) {
    const text = await file.text();
    return { geometry: mergeObject3D(new OBJLoader().parse(text)) };
  }
  if (lower.endsWith('.3mf')) {
    const buffer = await file.arrayBuffer();
    const obj = new ThreeMFLoader().parse(buffer);
    return { geometry: mergeObject3D(obj), units: read3mfUnits(buffer) };
  }
  throw new Error('Unsupported file type — use STL, OBJ or 3MF');
}
