import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface RiskMarkerData {
  position: { x: number; y: number; z: number };
  severity: number;
  type: string;
}

interface RiskAnimationProps {
  markers: RiskMarkerData[];
  visible: boolean;
}

function PulsingSphere({ position, severity, type }: { position: [number, number, number]; severity: number; type: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const color = type === 'thin_wall' ? '#ff4444' : type === 'delamination' ? '#ff8800' : '#ff44ff';
  const baseScale = 0.2 + severity * 0.6;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const pulse = 1 + Math.sin(clock.getElapsedTime() * 2 + severity * 3) * 0.3;
    ref.current.scale.setScalar(baseScale * pulse);
    const mat = ref.current.material as THREE.MeshPhongMaterial;
    mat.opacity = 0.3 + severity * 0.4 + Math.sin(clock.getElapsedTime() * 2.5 + severity * 2) * 0.15;
  });

  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.3, 12, 12]} />
      <meshPhongMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.5}
        transparent
        opacity={0.5}
        depthWrite={false}
      />
    </mesh>
  );
}

export function RiskAnimation({ markers, visible }: RiskAnimationProps) {
  const riskPoints = useMemo(() => {
    return markers
      .filter(m => m.position && ['thin_wall', 'delamination', 'stress_concentration'].includes(m.type))
      .slice(0, 25)
      .map(m => ({
        position: [m.position.x, m.position.y, m.position.z] as [number, number, number],
        severity: m.severity,
        type: m.type,
      }));
  }, [markers]);

  if (!visible || riskPoints.length === 0) return null;

  return (
    <group>
      {riskPoints.map((point, i) => (
        <PulsingSphere key={i} position={point.position} severity={point.severity} type={point.type} />
      ))}
    </group>
  );
}
