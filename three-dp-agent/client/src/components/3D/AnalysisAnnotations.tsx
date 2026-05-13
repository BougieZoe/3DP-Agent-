import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface AnnotationProps {
  position: [number, number, number];
  label: string;
  type: 'warning' | 'critical' | 'info';
}

const typeColors = {
  warning: 0xffd700,
  critical: 0xff6b6b,
  info: 0x4ecdc4,
};

export function AnalysisAnnotation({ position, label, type }: AnnotationProps) {
  const groupRef = useRef<THREE.Group>(null);
  const sphereRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y += Math.sin(state.clock.elapsedTime * 2) * 0.01;
      groupRef.current.rotation.z += 0.01;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Indicator Sphere */}
      <mesh ref={sphereRef}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial
          color={typeColors[type]}
          emissive={typeColors[type]}
          emissiveIntensity={0.8}
          wireframe={true}
        />
      </mesh>

      {/* Glow Effect */}
      <mesh>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshStandardMaterial
          color={typeColors[type]}
          transparent={true}
          opacity={0.2}
          emissive={typeColors[type]}
          emissiveIntensity={0.4}
        />
      </mesh>

      {/* Pulse Ring */}
      <mesh>
        <torusGeometry args={[0.6, 0.05, 8, 32]} />
        <meshStandardMaterial
          color={typeColors[type]}
          emissive={typeColors[type]}
          emissiveIntensity={0.6}
        />
      </mesh>
    </group>
  );
}

interface AnalysisVisualizationProps {
  geometry: THREE.BufferGeometry;
  analysis: any;
}

export function AnalysisVisualization({ geometry, analysis }: AnalysisVisualizationProps) {
  if (!analysis || !analysis.wallThickness || !analysis.overhang) {
    return null;
  }

  const annotations: AnnotationProps[] = [];

  // Generate annotations based on analysis
  if (analysis.wallThickness.status === 'critical') {
    annotations.push({
      position: [0, -1, 0],
      label: 'Critical Wall Thickness',
      type: 'critical',
    });
  } else if (analysis.wallThickness.status === 'warning') {
    annotations.push({
      position: [0.5, -0.5, 0.5],
      label: 'Thin Walls Detected',
      type: 'warning',
    });
  }

  if (analysis.overhang.status === 'warning') {
    annotations.push({
      position: [-0.5, 0.5, 0.5],
      label: 'Overhang Areas',
      type: 'warning',
    });
  }

  return (
    <>
      {annotations.map((ann, idx) => (
        <AnalysisAnnotation key={idx} {...ann} />
      ))}
    </>
  );
}
