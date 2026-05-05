import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Preload } from '@react-three/drei';
import * as THREE from 'three';

/**
 * 3DP Agent 3D Scene
 * Design: Warm pastel pink, minimalist, immersive 3D storytelling
 * - Soft lighting with global illumination feel
 * - Particle system for ethereal atmosphere
 * - Camera scroll-driven animation
 */

function ParticleSystem() {
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = 1000;

  useEffect(() => {
    if (!particlesRef.current) return;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 20;
      positions[i + 1] = (Math.random() - 0.5) * 20;
      positions[i + 2] = (Math.random() - 0.5) * 20;

      velocities[i] = (Math.random() - 0.5) * 0.01;
      velocities[i + 1] = (Math.random() - 0.5) * 0.01;
      velocities[i + 2] = (Math.random() - 0.5) * 0.01;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

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

      // Wrap around boundaries
      if (Math.abs(positions[i]) > 10) velocities[i] *= -1;
      if (Math.abs(positions[i + 1]) > 10) velocities[i + 1] *= -1;
      if (Math.abs(positions[i + 2]) > 10) velocities[i + 2] *= -1;
    }

    particlesRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return <points ref={particlesRef} />;
}

function PrintingChamber() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.0005;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Main chamber cylinder */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[3, 3, 4, 32]} />
        <meshStandardMaterial
          color={0xfdf2f8}
          metalness={0.3}
          roughness={0.7}
          transparent
          opacity={0.8}
        />
      </mesh>

      {/* Glowing ring */}
      <mesh position={[0, 2, 0]}>
        <torusGeometry args={[3.2, 0.15, 16, 100]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.5}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>

      {/* Bottom ring */}
      <mesh position={[0, -2, 0]}>
        <torusGeometry args={[3.2, 0.15, 16, 100]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.5}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>

      {/* Center platform */}
      <mesh position={[0, -2.5, 0]}>
        <cylinderGeometry args={[2.5, 2.5, 0.3, 32]} />
        <meshStandardMaterial
          color={0xfdf2f8}
          metalness={0.4}
          roughness={0.6}
        />
      </mesh>
    </group>
  );
}

function Lighting() {
  return (
    <>
      {/* Ambient light for overall illumination */}
      <ambientLight intensity={0.6} color={0xfdf2f8} />

      {/* Key light - warm pink */}
      <directionalLight
        position={[5, 5, 5]}
        intensity={1.2}
        color={0xf4a9b4}
        castShadow
      />

      {/* Fill light - soft white */}
      <directionalLight
        position={[-5, 3, -5]}
        intensity={0.8}
        color={0xffffff}
      />

      {/* Point light inside chamber */}
      <pointLight
        position={[0, 0, 0]}
        intensity={0.8}
        color={0xf4a9b4}
        distance={10}
      />
    </>
  );
}

function SceneContent() {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(0, 2, 8);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return (
    <>
      <Lighting />
      <PrintingChamber />
      <ParticleSystem />
    </>
  );
}

export function Scene3D() {
  return (
    <Canvas
      className="w-full h-screen"
      gl={{
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      }}
      style={{ background: '#fdf2f8' }}
    >
      <PerspectiveCamera makeDefault position={[0, 2, 8]} fov={75} />
      <SceneContent />
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.5} />
      <Preload all />
    </Canvas>
  );
}
