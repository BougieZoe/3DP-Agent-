import { useMemo } from 'react';
import * as THREE from 'three';
import { COLORS, MATERIALS } from '@/lib/visualLanguage';

interface SupportGhostsProps {
  markers: Array<{ position: { x: number; y: number; z: number }; severity: number }>;
  /** Model geometry — the bed level (minZ) is read from its bounding box. */
  geometry: THREE.BufferGeometry;
  visible: boolean;
}

export interface SupportColumn {
  height: number;
  radius: number;
  position: { x: number; y: number; z: number };
  severity: number;
}

/**
 * Pure column layout — unit-tested without WebGL. Columns grow from the bed
 * (minZ) toward each marker ALONG Z (data frame is Z-up). At most 30,
 * markers at/below the bed are skipped, output is fully deterministic.
 */
export function computeSupportColumns(
  markers: Array<{ position: { x: number; y: number; z: number }; severity: number }>,
  groundZ: number,
): SupportColumn[] {
  const valid = markers.filter(m => m.position && typeof m.position.x === 'number');
  const out: SupportColumn[] = [];
  for (const marker of valid.slice(0, 30)) {
    const height = marker.position.z - groundZ;
    if (height <= 0) continue;
    out.push({
      height,
      radius: 0.15 + marker.severity * 0.3,
      position: { x: marker.position.x, y: marker.position.y, z: groundZ + height / 2 },
      severity: marker.severity,
    });
  }
  return out;
}

export function SupportGhosts({ markers, geometry, visible, opacity = 0.35 }: SupportGhostsProps & { opacity?: number }) {
  const columns = useMemo(() => {
    geometry.computeBoundingBox();
    const groundZ = geometry.boundingBox!.min.z;
    return computeSupportColumns(markers, groundZ).map((col) => {
      // CylinderGeometry grows along Y — rotate once onto Z, then position
      // via the mesh only (never bake + offset, that doubled the old columns).
      const geo = new THREE.CylinderGeometry(col.radius * 0.6, col.radius, Math.max(0.5, col.height), 6);
      geo.rotateX(Math.PI / 2);
      return {
        geometry: geo,
        position: new THREE.Vector3(col.position.x, col.position.y, col.position.z),
        severity: col.severity,
      };
    });
  }, [markers, geometry]);

  if (!visible || columns.length === 0) return null;

  return (
    <group>
      {columns.map((col, i) => (
        <mesh key={i} geometry={col.geometry} position={col.position}>
          <meshPhongMaterial
            color={COLORS.support.overhang}
            {...MATERIALS.phongDouble}
            opacity={opacity}
          />
        </mesh>
      ))}
    </group>
  );
}
