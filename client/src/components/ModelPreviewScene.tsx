import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Preload } from '@react-three/drei';
import { ModelPreview } from './3D/ModelPreview';
import { UploadedModel } from './STLUploadHandler';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ModelPreviewSceneProps {
  model: UploadedModel;
}

function SceneContent({ model }: ModelPreviewSceneProps) {
  const { camera, scene } = useThree();
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    if (!model?.geometry?.boundingBox) return;

    const box = model.geometry.boundingBox;
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 2;

    camera.position.set(cameraZ * 0.6, cameraZ * 0.4, cameraZ);
    camera.lookAt(center);

    if (controlsRef.current) {
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  }, [model, camera]);

  return (
    <>
      {/* Premium Lighting Setup - CAD Style */}
      <ambientLight intensity={0.9} color={0xfdf2f8} />
      <directionalLight position={[8, 8, 8]} intensity={1.4} color={0xffffff} castShadow />
      <directionalLight position={[-8, 6, -8]} intensity={0.9} color={0xf4a9b4} castShadow />
      <pointLight position={[5, 5, 5]} intensity={0.8} color={0xffffff} />
      <pointLight position={[-5, -5, -5]} intensity={0.6} color={0xf4a9b4} />

      {/* Model Preview */}
      <ModelPreview
        mesh={model.mesh}
        geometry={model.geometry}
        analysis={model.analysis}
        showAnnotations={true}
      />

      {/* Reference Grid */}
      <gridHelper args={[20, 20, 0xf4a9b4, 0xfdf2f8]} position={[0, -5, 0]} />

      {/* OrbitControls */}
      <OrbitControls
        ref={controlsRef}
        autoRotate
        autoRotateSpeed={3}
        enableZoom={true}
        enablePan={true}
        enableRotate={true}
      />
    </>
  );
}

export function ModelPreviewScene({ model }: ModelPreviewSceneProps) {
  if (!model?.mesh || !model?.geometry) {
    return (
      <div className="w-full h-96 rounded-lg overflow-hidden bg-gradient-to-b from-pink-50 to-pink-100 flex items-center justify-center border border-pink-200">
        <p className="text-muted-foreground font-mono text-sm">Loading model...</p>
      </div>
    );
  }

  return (
    <div className="w-full h-96 rounded-lg overflow-hidden bg-gradient-to-b from-pink-50 to-pink-100 shadow-lg border border-pink-200">
      <Canvas
        gl={{
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: true,
        }}
      >
        <PerspectiveCamera makeDefault position={[5, 5, 5]} fov={75} />
        <SceneContent model={model} />
        <Preload all />
      </Canvas>
    </div>
  );
}
