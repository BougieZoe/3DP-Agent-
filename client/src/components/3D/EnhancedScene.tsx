import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Preload } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Enhanced 3D Scene with Premium Visual Effects
 * Design: Warm pastel pink, ethereal atmosphere, high-end rendering
 */

function AdvancedParticleSystem() {
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = 1500;

  useEffect(() => {
    if (!particlesRef.current) return;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 30;
      positions[i + 1] = (Math.random() - 0.5) * 30;
      positions[i + 2] = (Math.random() - 0.5) * 30;

      velocities[i] = (Math.random() - 0.5) * 0.006;
      velocities[i + 1] = (Math.random() - 0.5) * 0.006;
      velocities[i + 2] = (Math.random() - 0.5) * 0.006;

      sizes[i / 3] = Math.random() * 0.15;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      color: 0xf4a9b4,
      size: 0.1,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.6,
    });

    particlesRef.current.geometry = geometry;
    particlesRef.current.material = material;
  }, []);

  useFrame(() => {
    if (!particlesRef.current) return;

    const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
    const velocities = particlesRef.current.geometry.attributes.velocity.array as Float32Array;

    for (let i = 0; i < positions.length; i += 3) {
      positions[i] += velocities[i];
      positions[i + 1] += velocities[i + 1];
      positions[i + 2] += velocities[i + 2];

      if (Math.abs(positions[i]) > 15) velocities[i] *= -1;
      if (Math.abs(positions[i + 1]) > 15) velocities[i + 1] *= -1;
      if (Math.abs(positions[i + 2]) > 15) velocities[i + 2] *= -1;
    }

    particlesRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return <points ref={particlesRef} />;
}

function EnhancedPrintingChamber() {
  const groupRef = useRef<THREE.Group>(null);
  const innerGlowRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.0002;
    }

    if (innerGlowRef.current) {
      const material = innerGlowRef.current.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = 0.2 + Math.sin(clock.getElapsedTime() * 1.5) * 0.15;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Outer chamber cylinder */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[3.8, 3.8, 5.5, 48]} />
        <meshStandardMaterial
          color={0xfdf2f8}
          metalness={0.2}
          roughness={0.8}
          transparent
          opacity={0.7}
        />
      </mesh>

      {/* Top glowing ring - enhanced */}
      <mesh position={[0, 2.75, 0]}>
        <torusGeometry args={[4, 0.25, 16, 128]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.7}
          metalness={0.9}
          roughness={0.1}
        />
      </mesh>

      {/* Bottom glowing ring - enhanced */}
      <mesh position={[0, -2.75, 0]}>
        <torusGeometry args={[4, 0.25, 16, 128]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.7}
          metalness={0.9}
          roughness={0.1}
        />
      </mesh>

      {/* Center platform - elevated */}
      <mesh position={[0, -3.2, 0]}>
        <cylinderGeometry args={[3.2, 3.2, 0.5, 48]} />
        <meshStandardMaterial
          color={0xfdf2f8}
          metalness={0.35}
          roughness={0.65}
        />
      </mesh>

      {/* Inner glow sphere - pulsing */}
      <mesh ref={innerGlowRef} position={[0, 0, 0]}>
        <sphereGeometry args={[2.8, 48, 48]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.25}
          transparent
          opacity={0.12}
        />
      </mesh>

      {/* Vertical light beams */}
      <mesh position={[2, 0, 0]}>
        <boxGeometry args={[0.1, 5, 0.1]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.4}
          transparent
          opacity={0.3}
        />
      </mesh>
      <mesh position={[-2, 0, 0]}>
        <boxGeometry args={[0.1, 5, 0.1]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.4}
          transparent
          opacity={0.3}
        />
      </mesh>
    </group>
  );
}

function PremiumLighting() {
  return (
    <>
      {/* Ambient light - soft warm */}
      <ambientLight intensity={0.65} color={0xfdf2f8} />

      {/* Key light - warm pink */}
      <directionalLight
        position={[7, 7, 7]}
        intensity={1.4}
        color={0xf4a9b4}
        castShadow
      />

      {/* Fill light - cool white */}
      <directionalLight position={[-7, 5, -7]} intensity={0.85} color={0xffffff} />

      {/* Point light - chamber center */}
      <pointLight
        position={[0, 0, 0]}
        intensity={1.1}
        color={0xf4a9b4}
        distance={14}
      />

      {/* Rim light */}
      <directionalLight position={[0, 0, -10]} intensity={0.6} color={0xf4a9b4} />
    </>
  );
}

export function EnhancedSceneContent() {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(0, 2.5, 11);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return (
    <>
      <PremiumLighting />
      <EnhancedPrintingChamber />
      <AdvancedParticleSystem />
    </>
  );
}
