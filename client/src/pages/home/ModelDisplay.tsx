import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { UploadedModel } from '@/components/STLUploadHandler';

export function ModelDisplay({ model }: { model: UploadedModel | null }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const autoRotate = useRef(true);

  useEffect(() => {
    if (!model?.geometry?.boundingBox) return;
    const box = model.geometry.boundingBox;
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 2.5;
    camera.position.set(dist * 0.7, dist * 0.5, dist);
    camera.lookAt(center);
    autoRotate.current = false;
    setTimeout(() => { autoRotate.current = true; }, 100);
  }, [model, camera]);

  useFrame(({ clock }) => {
    if (meshRef.current && autoRotate.current) {
      meshRef.current.rotation.y = clock.getElapsedTime() * 0.25;
    }
  });

  if (!model) {
    return (
      <group>
        <mesh>
          <boxGeometry args={[3, 3, 3]} />
          <meshBasicMaterial color={0x00ffcc} wireframe transparent opacity={0.12} />
        </mesh>
      </group>
    );
  }

  const mat = new THREE.MeshPhongMaterial({
    color: 0x003333,
    emissive: 0x00ffcc,
    emissiveIntensity: 0.06,
    side: THREE.DoubleSide,
    shininess: 100,
    specular: new THREE.Color(0x00ffcc),
  });

  return <mesh ref={meshRef} geometry={model.geometry} material={mat} />;
}
