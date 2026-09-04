/**
 * Advanced Overhang Heatmap
 *
 * Composite scoring combining:
 * - Overhang angle (primary)
 * - Curvature analysis (sharp edges = higher risk)
 * - Wall thickness estimation (thin walls = higher risk)
 * - Bridge detection (horizontal spans = high risk)
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { MATERIALS } from '@/lib/visualLanguage';

interface AdvancedHeatmapProps {
  geometry: THREE.BufferGeometry;
  visible: boolean;
  opacity?: number;
  /** Overhang angle threshold (degrees) */
  overhangThreshold?: number;
  /** Curvature weight (0-1) */
  curvatureWeight?: number;
  /** Thickness weight (0-1) */
  thicknessWeight?: number;
  /** Bridge detection enabled */
  detectBridges?: boolean;
}

export function AdvancedHeatmap({
  geometry,
  visible,
  opacity = 0.7,
  overhangThreshold = 45,
  curvatureWeight = 0.3,
  thicknessWeight = 0.2,
  detectBridges = true,
}: AdvancedHeatmapProps) {
  const heatmapGeo = useMemo(() => {
    const srcPos = geometry.getAttribute('position');
    const srcNorm = geometry.getAttribute('normal');
    const indices = geometry.getIndex();
    if (!srcPos || !srcNorm || !indices) return null;

    const positions = srcPos.array as Float32Array;
    const normals = srcNorm.array as Float32Array;
    const idx = indices.array as Uint32Array;
    const vertexCount = srcPos.count;
    const faceCount = idx.length / 3;

    // 1. Compute per-vertex curvature (normal variation)
    const curvature = computeCurvature(positions, normals, vertexCount, idx, faceCount);

    // 2. Compute per-vertex wall thickness estimate
    const thickness = computeThicknessEstimate(positions, normals, vertexCount);

    // 3. Compute overhang angle per vertex
    const overhang = computeOverhangAngle(normals, vertexCount);

    // 4. Detect bridges (horizontal spans)
    const bridge = detectBridges
      ? computeBridgeScore(positions, normals, idx, faceCount, vertexCount)
      : new Float32Array(vertexCount);

    // 5. Combine into composite score
    const colors = new Float32Array(vertexCount * 3);
    const scores = new Float32Array(vertexCount);

    for (let i = 0; i < vertexCount; i++) {
      const ov = overhang[i] / 90; // normalize to 0-1
      const cu = curvature[i];
      const th = 1 - Math.min(1, thickness[i] / 2); // thin = high score
      const br = bridge[i];

      // Weighted composite
      const score = ov * (1 - curvatureWeight - thicknessWeight)
        + cu * curvatureWeight
        + th * thicknessWeight
        + br * 0.2; // bridges always add risk

      scores[i] = Math.min(1, score);

      // Map score to color: green -> yellow -> orange -> red -> purple
      const { r, g, b } = scoreToColor(score);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(geometry.getIndex()?.clone() ?? new THREE.BufferAttribute(idx.slice(), 1));
    geo.computeVertexNormals();

    return geo;
  }, [geometry, overhangThreshold, curvatureWeight, thicknessWeight, detectBridges]);

  if (!visible || !heatmapGeo) return null;

  return (
    <mesh geometry={heatmapGeo} renderOrder={1}>
      <meshPhongMaterial
        vertexColors
        {...MATERIALS.phongDouble}
        opacity={opacity}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}

// --- Analysis Functions ---

function computeCurvature(
  positions: Float32Array,
  normals: Float32Array,
  vertexCount: number,
  indices: Uint32Array,
  faceCount: number,
): Float32Array {
  const curvature = new Float32Array(vertexCount);
  const faceCountPerVertex = new Uint32Array(vertexCount);

  // Count faces per vertex
  for (let f = 0; f < faceCount; f++) {
    faceCountPerVertex[indices[f * 3]]++;
    faceCountPerVertex[indices[f * 3 + 1]]++;
    faceCountPerVertex[indices[f * 3 + 2]]++;
  }

  // For vertices with multiple faces, compare adjacent face normals
  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3];
    const i1 = indices[f * 3 + 1];
    const i2 = indices[f * 3 + 2];

    // Compare normals of triangle edges
    const compareNormals = (a: number, b: number) => {
      const dot = normals[a * 3] * normals[b * 3]
        + normals[a * 3 + 1] * normals[b * 3 + 1]
        + normals[a * 3 + 2] * normals[b * 3 + 2];
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      curvature[a] = Math.max(curvature[a], angle);
      curvature[b] = Math.max(curvature[b], angle);
    };

    compareNormals(i0, i1);
    compareNormals(i1, i2);
    compareNormals(i2, i0);
  }

  // Normalize to 0-1
  let maxCurv = 0;
  for (let i = 0; i < vertexCount; i++) {
    if (curvature[i] > maxCurv) maxCurv = curvature[i];
  }
  if (maxCurv > 0) {
    for (let i = 0; i < vertexCount; i++) {
      curvature[i] /= maxCurv;
    }
  }

  return curvature;
}

function computeThicknessEstimate(
  positions: Float32Array,
  normals: Float32Array,
  vertexCount: number,
): Float32Array {
  const thickness = new Float32Array(vertexCount);

  // Fast approximation: thickness ~ distance to nearest opposite-facing vertex
  // Use spatial hashing for O(n) average case
  const gridSize = 5; // mm
  const grid = new Map<string, number[]>();

  // Build spatial index
  for (let i = 0; i < vertexCount; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    const key = `${Math.floor(px / gridSize)},${Math.floor(py / gridSize)},${Math.floor(pz / gridSize)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(i);
  }

  // For each vertex, search nearby cells for opposite-facing vertices
  for (let i = 0; i < vertexCount; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];

    let minDist = 5; // default max thickness

    // Search 3x3x3 neighborhood
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cx = Math.floor(px / gridSize) + dx;
          const cy = Math.floor(py / gridSize) + dy;
          const cz = Math.floor(pz / gridSize) + dz;
          const key = `${cx},${cy},${cz}`;
          const cell = grid.get(key);
          if (!cell) continue;

          for (const j of cell) {
            if (j === i) continue;
            const jnx = normals[j * 3];
            const jny = normals[j * 3 + 1];
            const jnz = normals[j * 3 + 2];

            // Check if normals are roughly opposite (facing each other)
            const dot = nx * jnx + ny * jny + nz * jnz;
            if (dot > -0.3) continue; // not opposite enough

            const dx2 = positions[j * 3] - px;
            const dy2 = positions[j * 3 + 1] - py;
            const dz2 = positions[j * 3 + 2] - pz;
            const dist = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);

            if (dist < minDist && dist > 0.1) {
              minDist = dist;
            }
          }
        }
      }
    }

    thickness[i] = minDist;
  }

  return thickness;
}

function computeOverhangAngle(normals: Float32Array, vertexCount: number): Float32Array {
  const angles = new Float32Array(vertexCount);

  for (let i = 0; i < vertexCount; i++) {
    const nz = normals[i * 3 + 2];
    angles[i] = Math.acos(Math.max(-1, Math.min(1, nz))) * (180 / Math.PI);
  }

  return angles;
}

function computeBridgeScore(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  faceCount: number,
  vertexCount: number,
): Float32Array {
  const bridge = new Float32Array(vertexCount);
  const bridgeFaceCount = new Uint32Array(vertexCount);

  // Limit analysis for very large meshes
  const maxFaces = Math.min(faceCount, 50000);

  for (let f = 0; f < maxFaces; f++) {
    const i0 = indices[f * 3] * 3;
    const i1 = indices[f * 3 + 1] * 3;
    const i2 = indices[f * 3 + 2] * 3;

    // Check if face is roughly horizontal (normal Z ~ 0)
    const nz = (normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2]) / 3;
    const isHorizontal = Math.abs(nz) < 0.2;

    // Check if face has significant span
    const dx = positions[i1] - positions[i0];
    const dy = positions[i1 + 1] - positions[i0 + 1];
    const span = Math.sqrt(dx * dx + dy * dy);

    if (isHorizontal && span > 2.0) {
      bridgeFaceCount[indices[f * 3]]++;
      bridgeFaceCount[indices[f * 3 + 1]]++;
      bridgeFaceCount[indices[f * 3 + 2]]++;
    }
  }

  // Normalize
  for (let i = 0; i < vertexCount; i++) {
    bridge[i] = Math.min(1, bridgeFaceCount[i] / 3);
  }

  return bridge;
}

function scoreToColor(score: number): { r: number; g: number; b: number } {
  if (score <= 0.25) {
    const t = score / 0.25;
    return { r: 0.2 * t, g: 0.8 + 0.2 * t, b: 0.3 - 0.1 * t };
  } else if (score <= 0.5) {
    const t = (score - 0.25) / 0.25;
    return { r: 0.2 + 0.6 * t, g: 1 - 0.3 * t, b: 0.2 - 0.2 * t };
  } else if (score <= 0.75) {
    const t = (score - 0.5) / 0.25;
    return { r: 0.8 + 0.2 * t, g: 0.7 - 0.5 * t, b: 0 };
  } else {
    const t = (score - 0.75) / 0.25;
    return { r: 1 - 0.2 * t, g: 0.2 - 0.2 * t, b: 0.4 + 0.4 * t };
  }
}
