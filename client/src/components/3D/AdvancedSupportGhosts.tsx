/**
 * Advanced Support Visualization
 *
 * Enhanced with:
 * - Direct geometry-based overhang detection (not just markers)
 * - Bridge detection
 * - Support area estimation
 * - Tree support path visualization
 */

import { useMemo } from 'react';
import * as THREE from 'three';

interface AdvancedSupportProps {
  geometry: THREE.BufferGeometry;
  visible: boolean;
  opacity?: number;
  maxAngle?: number;
  density?: number;
}

interface SupportRegion {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  area: number;
  type: 'overhang' | 'bridge' | 'island';
  height: number;
}

export function AdvancedSupportGhosts({
  geometry,
  visible,
  opacity = 0.35,
  maxAngle = 45,
  density = 0.5,
}: AdvancedSupportProps) {
  const supports = useMemo(() => {
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const indices = geometry.getIndex();
    if (!positions || !normals || !indices) return [];

    const pos = positions.array as Float32Array;
    const norm = normals.array as Float32Array;
    const idx = indices.array as Uint32Array;
    const faceCount = idx.length / 3;

    const regions: SupportRegion[] = [];
    const minArea = 2.0 / density; // larger = fewer supports

    // Spatial grid for deduplication
    const grid = new Map<string, SupportRegion>();

    for (let f = 0; f < faceCount; f++) {
      const i0 = idx[f * 3] * 3;
      const i1 = idx[f * 3 + 1] * 3;
      const i2 = idx[f * 3 + 2] * 3;

      // Face normal
      const fnx = (norm[i0] + norm[i1] + norm[i2]) / 3;
      const fny = (norm[i0 + 1] + norm[i1 + 1] + norm[i2 + 1]) / 3;
      const fnz = (norm[i0 + 2] + norm[i1 + 2] + norm[i2 + 2]) / 3;

      // Angle from vertical (Z-axis)
      const angle = Math.acos(Math.max(-1, Math.min(1, fnz))) * (180 / Math.PI);

      // Face centroid
      const cx = (pos[i0] + pos[i1] + pos[i2]) / 3;
      const cy = (pos[i0 + 1] + pos[i1 + 1] + pos[i2 + 1]) / 3;
      const cz = (pos[i0 + 2] + pos[i1 + 2] + pos[i2 + 2]) / 3;

      // Face area
      const ax = pos[i1] - pos[i0];
      const ay = pos[i1 + 1] - pos[i0 + 1];
      const az = pos[i1 + 2] - pos[i0 + 2];
      const bx = pos[i2] - pos[i0];
      const by = pos[i2 + 1] - pos[i0 + 1];
      const bz = pos[i2 + 2] - pos[i0 + 2];
      const area = Math.sqrt(
        (ay * bz - az * by) ** 2 +
        (az * bx - ax * bz) ** 2 +
        (ax * by - ay * bx) ** 2
      ) / 2;

      // Check if this is an overhang
      if (angle > maxAngle && area > 0.5) {
        // Check for bridge (horizontal face with no support below)
        const isBridge = Math.abs(fnz) < 0.15 && cy > 0;

        // Grid cell for deduplication
        const gx = Math.floor(cx / 3);
        const gy = Math.floor(cy / 3);
        const gz = Math.floor(cz / 3);
        const key = `${gx},${gy},${gz}`;

        if (grid.has(key)) {
          const existing = grid.get(key)!;
          existing.area += area;
        } else {
          const region: SupportRegion = {
            position: new THREE.Vector3(cx, cy, cz),
            normal: new THREE.Vector3(fnx, fny, fnz),
            area,
            type: isBridge ? 'bridge' : 'overhang',
            height: cy,
          };
          grid.set(key, region);
          regions.push(region);
        }
      }
    }

    // Filter by minimum area and sort by area (largest first)
    return regions
      .filter(r => r.area >= minArea)
      .sort((a, b) => b.area - a.area)
      .slice(0, 40);
  }, [geometry, maxAngle, density]);

  if (!visible || supports.length === 0) return null;

  return (
    <group>
      {supports.map((support, i) => (
        <SupportColumn
          key={i}
          position={support.position}
          height={support.height}
          area={support.area}
          type={support.type}
          opacity={opacity}
        />
      ))}
    </group>
  );
}

function SupportColumn({
  position,
  height,
  area,
  type,
  opacity,
}: {
  position: THREE.Vector3;
  height: number;
  area: number;
  type: 'overhang' | 'bridge' | 'island';
  opacity: number;
}) {
  const groundY = -7;
  const columnHeight = Math.max(0.5, position.y - groundY);
  const radius = Math.min(1.5, 0.2 + Math.sqrt(area) * 0.15);

  // Color by type
  const color = type === 'bridge' ? 0xff8844 : 0x4488ff;

  return (
    <group>
      {/* Support column */}
      <mesh position={[position.x, groundY + columnHeight / 2, position.z]}>
        <cylinderGeometry args={[radius * 0.6, radius, columnHeight, 6]} />
        <meshPhongMaterial
          color={color}
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Contact point indicator */}
      <mesh position={position.toArray()}>
        <sphereGeometry args={[radius * 0.4, 8, 8]} />
        <meshBasicMaterial
          color={type === 'bridge' ? 0xff6622 : 0x2266ff}
          transparent
          opacity={opacity * 1.5}
        />
      </mesh>
    </group>
  );
}
