import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * AI Advisor Character Component
 * Design: Floating anime-style character with gentle animations
 * - Floats around the printing chamber
 * - Emits soft glow
 * - Responds to scene interactions
 */

interface AIAdvisorProps {
  position?: [number, number, number];
  scale?: number;
}

export function AIAdvisor({ position = [3, 1, 0], scale = 1 }: AIAdvisorProps) {
  const groupRef = useRef<THREE.Group>(null);
  const floatOffsetRef = useRef(0);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    // Gentle floating animation
    floatOffsetRef.current = Math.sin(clock.getElapsedTime() * 0.5) * 0.3;
    groupRef.current.position.y = position[1] + floatOffsetRef.current;

    // Gentle rotation
    groupRef.current.rotation.z = Math.sin(clock.getElapsedTime() * 0.3) * 0.1;
  });

  return (
    <group ref={groupRef} position={position} scale={scale}>
      {/* Character body - simplified sphere for now */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.6, 32, 32]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.3}
          metalness={0.2}
          roughness={0.6}
        />
      </mesh>

      {/* Head */}
      <mesh position={[0, 0.7, 0]}>
        <sphereGeometry args={[0.4, 32, 32]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.2}
        />
      </mesh>

      {/* Glow aura */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[1.2, 32, 32]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.15}
          transparent
          opacity={0.3}
          wireframe={false}
        />
      </mesh>

      {/* Floating particles around character */}
      <FloatingParticles />
    </group>
  );
}

function FloatingParticles() {
  const particlesRef = useRef<THREE.Points>(null);

  useEffect(() => {
    if (!particlesRef.current) return;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(50 * 3);

    for (let i = 0; i < 50 * 3; i += 3) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1 + Math.random() * 0.5;
      positions[i] = Math.cos(angle) * radius;
      positions[i + 1] = (Math.random() - 0.5) * 1.5;
      positions[i + 2] = Math.sin(angle) * radius;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.08,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8,
    });

    particlesRef.current.geometry = geometry;
    particlesRef.current.material = material;
  }, []);

  useFrame(({ clock }) => {
    if (!particlesRef.current?.geometry?.attributes?.position) return;

    const positionAttr = particlesRef.current.geometry.attributes.position;
    const positions = positionAttr.array as Float32Array;
    const time = clock.getElapsedTime();

    for (let i = 0; i < positions.length; i += 3) {
      const index = i / 3;
      const angle = (index / 50) * Math.PI * 2 + time * 0.5;
      const radius = 1 + Math.sin(time + index) * 0.3;

      positions[i] = Math.cos(angle) * radius;
      positions[i + 2] = Math.sin(angle) * radius;
    }

    positionAttr.needsUpdate = true;
  });

  return <points ref={particlesRef} />;
}
