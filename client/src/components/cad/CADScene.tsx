import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { CADDesign, buildCADGroup } from "@/lib/cadGenerator";
import { EmptyPreview } from "./EmptyPreview";

export function CADScene({
  design,
  groupRef,
}: {
  design: CADDesign | null;
  groupRef: React.RefObject<THREE.Group | null>;
}) {
  const { camera } = useThree();

  useEffect(() => {
    if (!groupRef.current || !design) return;
    groupRef.current.clear();
    const generated = buildCADGroup(design);
    groupRef.current.add(generated);

    const box = new THREE.Box3().setFromObject(groupRef.current);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    groupRef.current.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 1.6;
    camera.position.set(dist * 0.7, dist * 0.55, dist);
    camera.lookAt(0, 0, 0);
    if (camera instanceof THREE.PerspectiveCamera)
      camera.updateProjectionMatrix();
  }, [design, groupRef, camera]);

  return (
    <>
      <ambientLight intensity={0.45} color={0xb9f8ff} />
      <directionalLight position={[8, 9, 6]} intensity={1.5} color={0xffffff} />
      <directionalLight
        position={[-9, 5, -5]}
        intensity={0.65}
        color={0x3cf0b6}
      />
      <pointLight position={[0, 7, 8]} intensity={0.5} color={0x50a7ff} />
      <group ref={groupRef}>{!design && <EmptyPreview />}</group>
      <Grid
        args={[500, 500]}
        cellSize={10}
        cellThickness={0.35}
        cellColor="#0b2b33"
        sectionSize={50}
        sectionThickness={0.9}
        sectionColor="#124650"
        fadeDistance={450}
        fadeStrength={1}
        position={[0, -0.02, 0]}
      />
      <OrbitControls enableDamping dampingFactor={0.08} />
    </>
  );
}
