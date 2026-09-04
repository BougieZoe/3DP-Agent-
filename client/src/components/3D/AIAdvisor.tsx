import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS, ANIMATION, OPACITIES, SIZES } from '@/lib/visualLanguage';

interface AIAdvisorProps {
  position?: [number, number, number];
  scale?: number;
}

export function AIAdvisor({ position = [3, 1, 0], scale = 1 }: AIAdvisorProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();

    groupRef.current.position.y = position[1] + Math.sin(t * ANIMATION.advisor.floatSpeed) * ANIMATION.advisor.floatAmp;
    groupRef.current.rotation.z = Math.sin(t * ANIMATION.advisor.rotateSpeed) * ANIMATION.advisor.rotateAmp;
  });

  const advisorColor = COLORS.advisor.base;

  return (
    <group ref={groupRef} position={position} scale={scale}>
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.6, 32, 32]} />
        <meshStandardMaterial
          color={advisorColor}
          emissive={advisorColor}
          emissiveIntensity={0.3}
          metalness={0.2}
          roughness={0.6}
        />
      </mesh>

      <mesh position={[0, 0.7, 0]}>
        <sphereGeometry args={[0.4, 32, 32]} />
        <meshStandardMaterial
          color={advisorColor}
          emissive={advisorColor}
          emissiveIntensity={0.2}
        />
      </mesh>

      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[SIZES.advisorGlow, 32, 32]} />
        <meshStandardMaterial
          color={advisorColor}
          emissive={advisorColor}
          emissiveIntensity={0.15}
          transparent
          opacity={OPACITIES.overlay}
        />
      </mesh>

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
      color: COLORS.advisor.glow,
      size: SIZES.point,
      sizeAttenuation: true,
      transparent: true,
      opacity: OPACITIES.particle,
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
      const angle = (index / 50) * Math.PI * 2 + time * ANIMATION.advisor.particleOrbitSpeed;
      const radius = 1 + Math.sin(time + index) * ANIMATION.advisor.particleRadiusAmp;

      positions[i] = Math.cos(angle) * radius;
      positions[i + 2] = Math.sin(angle) * radius;
    }

    positionAttr.needsUpdate = true;
  });

  return <points ref={particlesRef} />;
}
