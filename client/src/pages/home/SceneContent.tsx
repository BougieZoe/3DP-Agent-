import { Grid } from '@react-three/drei';
import type { UploadedModel } from '@/components/STLUploadHandler';
import { ModelDisplay } from './ModelDisplay';
import { FloatingParticles } from './FloatingParticles';

export function SceneContent({ model }: { model: UploadedModel | null }) {
  return (
    <>
      <ambientLight intensity={0.25} color={0x001a2a} />
      <directionalLight position={[10, 10, 5]} intensity={1.4} color={0x00ffcc} />
      <directionalLight position={[-8, 6, -8]} intensity={0.5} color={0x0044ff} />
      <pointLight position={[0, 8, 0]} intensity={0.6} color={0x00ffcc} distance={25} />
      <ModelDisplay model={model} />
      <FloatingParticles />
      <Grid args={[40, 40]} cellSize={1} cellThickness={0.3} cellColor="#061a1a"
        sectionSize={5} sectionThickness={0.8} sectionColor="#0a2e2e"
        fadeDistance={28} fadeStrength={1} position={[0, -7, 0]} />
    </>
  );
}
