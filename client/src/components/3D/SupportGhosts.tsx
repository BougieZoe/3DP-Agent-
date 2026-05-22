import { useMemo } from 'react';
import * as THREE from 'three';

interface SupportGhostsProps {
  markers: Array<{ position: { x: number; y: number; z: number }; severity: number }>;
  visible: boolean;
  groundY?: number;
}

export function SupportGhosts({ markers, visible, groundY = -7, opacity = 0.35 }: SupportGhostsProps & { opacity?: number }) {
  const columns = useMemo(() => {
    const valid = markers.filter(m => m.position && typeof m.position.x === 'number');
    if (valid.length === 0) return [];

    return valid.slice(0, 30).map((marker, index) => {
      const height = marker.position.y - groundY;
      if (height <= 0) return null;

      const radius = 0.15 + marker.severity * 0.3;
      const geo = new THREE.CylinderGeometry(radius * 0.6, radius, Math.max(0.5, height), 6);
      geo.translate(marker.position.x, groundY + height / 2, marker.position.z);
      geo.rotateY(Math.random() * Math.PI);

      return {
        geometry: geo,
        position: new THREE.Vector3(marker.position.x, groundY + height / 2, marker.position.z),
        severity: marker.severity,
      };
    }).filter(Boolean) as Array<{ geometry: THREE.BufferGeometry; position: THREE.Vector3; severity: number }>;
  }, [markers, groundY]);

  if (!visible || columns.length === 0) return null;

  return (
    <group>
      {columns.map((col, i) => (
        <mesh key={i} geometry={col.geometry} position={col.position}>
          <meshPhongMaterial
            color={0x4488ff}
            transparent
            opacity={opacity}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
