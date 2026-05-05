import { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AnalysisVisualization } from './AnalysisAnnotations';

interface ModelPreviewProps {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  analysis: any;
  showAnnotations?: boolean;
}

export function ModelPreview({
  mesh,
  geometry,
  analysis,
  showAnnotations = true,
}: ModelPreviewProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  // 计算模型的缩放和位移（一次性计算，不要累加）
  const transform = useMemo(() => {
    if (!geometry) return { scale: 1, position: new THREE.Vector3(0, 0, 0) };

    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return { scale: 1, position: new THREE.Vector3(0, 0, 0) };

    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 5 / maxDim;

    const center = new THREE.Vector3();
    box.getCenter(center);

    return {
      scale,
      position: center.multiplyScalar(-1),
    };
  }, [geometry]);

  // 自动调整相机
  useEffect(() => {
    if (!geometry?.boundingBox || !(camera instanceof THREE.PerspectiveCamera)) return;

    const box = geometry.boundingBox;
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);

    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 2;

    camera.position.set(cameraZ * 0.6, cameraZ * 0.4, cameraZ);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [geometry, camera]);

  // 旋转动画
  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.003;
    }
  });

  if (!mesh || !geometry) {
    return null;
  }

  return (
    <group ref={groupRef} position={[0, 0, 0]} scale={transform.scale}>
      {/* 直接使用 JSX 创建 mesh，而不是 primitive */}
      <mesh
        geometry={geometry}
        material={mesh.material as THREE.Material}
        position={[transform.position.x, transform.position.y, transform.position.z]}
      />

      {/* Enhanced Lighting for Model Visibility - CAD Style */}
      <directionalLight position={[5, 8, 5]} intensity={1.2} color={0xffffff} castShadow />
      <directionalLight position={[-5, 6, -5]} intensity={0.9} color={0xf4a9b4} castShadow />
      <pointLight position={[0, 5, 0]} intensity={1.5} color={0xffffff} />
      <ambientLight intensity={0.8} color={0xfdf2f8} />

      {/* Analysis Annotations */}
      {showAnnotations && analysis && (
        <AnalysisVisualization geometry={geometry} analysis={analysis} />
      )}
    </group>
  );
}
