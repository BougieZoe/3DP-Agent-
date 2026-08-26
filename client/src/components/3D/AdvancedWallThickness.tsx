/**
 * Advanced Wall Thickness Heatmap — Surface Mapped
 *
 * Industry-standard visualization:
 * - Colors mapped directly on mesh surface (not point cloud)
 * - Smooth gradient: red (thin) → orange → yellow → green → cyan (thick)
 * - Multi-direction spatial sampling for accurate thickness
 * - Triangle-face coloring for smooth interpolation
 *
 * When the analysis pipeline provides a precomputed `thicknessMap` (one value
 * per vertex, computed in the worker — see analysis/surfaceThickness.ts), the
 * component skips its own per-vertex grid search. That search is the expensive
 * main-thread pass that crashed low-memory phones on large meshes; the worker
 * map uses the same algorithm and constants, so colors are identical.
 */

import { useMemo } from 'react';
import * as THREE from 'three';

interface AdvancedWallThicknessProps {
  geometry: THREE.BufferGeometry;
  visible: boolean;
  opacity?: number;
  minThickness?: number;
  maxThickness?: number;
  showThinOnly?: boolean;
  /** Optional precomputed per-vertex thickness (mm), from the analysis worker. */
  thicknessMap?: Float32Array | null;
}

/**
 * Per-vertex thickness via opposite-normal nearest-distance over a 4 mm
 * spatial grid (27-cell neighborhood). This is the fallback path when no
 * worker-computed map is available; the pipeline normally supplies one.
 */
function computePerVertexThickness(
  positions: Float32Array,
  normals: Float32Array,
  vertexCount: number,
  maxThickness: number,
): Float32Array {
  const gridSize = 4;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < vertexCount; i++) {
    const key = `${Math.floor(positions[i * 3] / gridSize)},${Math.floor(positions[i * 3 + 1] / gridSize)},${Math.floor(positions[i * 3 + 2] / gridSize)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(i);
  }

  const thickness = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];

    let minDist = maxThickness;

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

            // Check if normals are roughly opposite (facing each other across thin wall)
            const dot = nx * jnx + ny * jny + nz * jnz;
            if (dot > -0.3) continue;

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

export function AdvancedWallThickness({
  geometry,
  visible,
  opacity = 0.7,
  minThickness = 0.8,
  maxThickness = 4.0,
  showThinOnly = false,
  thicknessMap = null,
}: AdvancedWallThicknessProps) {
  const coloredGeo = useMemo(() => {
    const srcPos = geometry.getAttribute('position');
    const srcNorm = geometry.getAttribute('normal');
    const indices = geometry.getIndex();
    if (!srcPos || !srcNorm || !indices) return null;

    const positions = srcPos.array as Float32Array;
    const normals = srcNorm.array as Float32Array;
    const idx = indices.array as Uint32Array;
    const vertexCount = srcPos.count;

    // Worker-computed map wins when present and sized correctly; otherwise
    // fall back to the local grid search (legacy cached analyses).
    const provided = thicknessMap && thicknessMap.length === vertexCount ? thicknessMap : null;
    const thickness = provided ?? computePerVertexThickness(positions, normals, vertexCount, maxThickness);

    // Map thickness to vertex colors on the mesh surface
    const colors = new Float32Array(vertexCount * 3);

    if (showThinOnly) {
      // Only color thin areas, rest transparent
      for (let i = 0; i < vertexCount; i++) {
        const t = thickness[i];
        if (t <= minThickness) {
          const [r, g, b] = thicknessToColor(t, minThickness, maxThickness);
          colors[i * 3] = r;
          colors[i * 3 + 1] = g;
          colors[i * 3 + 2] = b;
        } else {
          // Gray out thick areas
          colors[i * 3] = 0.3;
          colors[i * 3 + 1] = 0.3;
          colors[i * 3 + 2] = 0.3;
        }
      }
    } else {
      for (let i = 0; i < vertexCount; i++) {
        const [r, g, b] = thicknessToColor(thickness[i], minThickness, maxThickness);
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }
    }

    // Clone geometry with vertex colors
    const geo = geometry.clone();
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return geo;
  }, [geometry, minThickness, maxThickness, showThinOnly, thicknessMap]);

  if (!visible || !coloredGeo) return null;

  return (
    <mesh geometry={coloredGeo} renderOrder={1}>
      <meshPhongMaterial
        vertexColors
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}

function thicknessToColor(t: number, min: number, max: number): [number, number, number] {
  // Industry-standard color ramp:
  // Red (thin/danger) → Orange → Yellow → Green → Cyan (thick/safe)
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [1.0, 0.15, 0.10]],   // Red
    [0.25, [1.0, 0.65, 0.10]],  // Orange
    [0.5, [1.0, 1.0, 0.20]],    // Yellow
    [0.75, [0.30, 0.90, 0.40]], // Green
    [1.0, [0.20, 0.85, 1.00]],  // Cyan
  ];

  const span = max - min;
  const u = span <= 0 ? (t <= min ? 0 : 1) : Math.max(0, Math.min(1, (t - min) / span));

  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i - 1];
    const [t2, c2] = stops[i];
    if (u <= t2) {
      const k = t2 === t1 ? 0 : (u - t1) / (t2 - t1);
      return [
        c1[0] + (c2[0] - c1[0]) * k,
        c1[1] + (c2[1] - c1[1]) * k,
        c1[2] + (c2[2] - c1[2]) * k,
      ];
    }
  }
  return stops[stops.length - 1][1];
}
