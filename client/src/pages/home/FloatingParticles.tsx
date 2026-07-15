import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function FloatingParticles() {
  const ref = useRef<THREE.Points>(null);
  const count = 600;

  useEffect(() => {
    if (!ref.current) return;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      pos[i] = (Math.random() - 0.5) * 30;
      pos[i+1] = (Math.random() - 0.5) * 20;
      pos[i+2] = (Math.random() - 0.5) * 30;
      vel[i] = (Math.random() - 0.5) * 0.003;
      vel[i+1] = (Math.random() - 0.5) * 0.003;
      vel[i+2] = (Math.random() - 0.5) * 0.003;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(vel, 3));
    ref.current.geometry = geo;
    ref.current.material = new THREE.PointsMaterial({
      color: 0x00ffcc, size: 0.06, transparent: true, opacity: 0.35,
    });
  }, []);

  useFrame(() => {
    if (!ref.current?.geometry?.attributes?.position) return;
    const pos = ref.current.geometry.attributes.position.array as Float32Array;
    const vel = ref.current.geometry.attributes.velocity.array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] += vel[i]; pos[i+1] += vel[i+1]; pos[i+2] += vel[i+2];
      if (Math.abs(pos[i]) > 15) vel[i] *= -1;
      if (Math.abs(pos[i+1]) > 10) vel[i+1] *= -1;
      if (Math.abs(pos[i+2]) > 15) vel[i+2] *= -1;
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return <points ref={ref} />;
}
