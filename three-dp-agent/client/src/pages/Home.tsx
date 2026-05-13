import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Preload } from '@react-three/drei';
import * as THREE from 'three';
import { AIAdvisor } from '@/components/3D/AIAdvisor';
import { SupplierConsultation } from '@/components/SupplierConsultation';
import { STLUploadHandler, UploadedModel } from '@/components/STLUploadHandler';
import { AnalysisResults } from '@/components/AnalysisResults';
import { Language, getTranslation, translations } from '@/lib/i18n';
import { toast } from 'sonner';

function ParticleSystem() {
  const particlesRef = useRef<THREE.Points>(null);
  const particleCount = 1200;

  useEffect(() => {
    if (!particlesRef.current) return;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 25;
      positions[i + 1] = (Math.random() - 0.5) * 25;
      positions[i + 2] = (Math.random() - 0.5) * 25;

      velocities[i] = (Math.random() - 0.5) * 0.008;
      velocities[i + 1] = (Math.random() - 0.5) * 0.008;
      velocities[i + 2] = (Math.random() - 0.5) * 0.008;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const material = new THREE.PointsMaterial({
      color: 0xf4a9b4,
      size: 0.08,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.5,
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

      if (Math.abs(positions[i]) > 12.5) velocities[i] *= -1;
      if (Math.abs(positions[i + 1]) > 12.5) velocities[i + 1] *= -1;
      if (Math.abs(positions[i + 2]) > 12.5) velocities[i + 2] *= -1;
    }

    particlesRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return <points ref={particlesRef} />;
}

function PrintingChamber({ uploadedModel }: { uploadedModel: UploadedModel | null }) {
  const groupRef = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Mesh | null>(null);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.0003;
    }
    if (modelRef.current) {
      modelRef.current.rotation.y += 0.001;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Chamber */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[3.5, 3.5, 5, 32]} />
        <meshStandardMaterial
          color={0xfdf2f8}
          metalness={0.25}
          roughness={0.75}
          transparent
          opacity={0.75}
        />
      </mesh>

      {/* Top Ring */}
      <mesh position={[0, 2.5, 0]}>
        <torusGeometry args={[3.7, 0.2, 16, 100]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.6}
          metalness={0.85}
          roughness={0.15}
        />
      </mesh>

      {/* Bottom Ring */}
      <mesh position={[0, -2.5, 0]}>
        <torusGeometry args={[3.7, 0.2, 16, 100]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.6}
          metalness={0.85}
          roughness={0.15}
        />
      </mesh>

      {/* Base */}
      <mesh position={[0, -3, 0]}>
        <cylinderGeometry args={[3, 3, 0.4, 32]} />
        <meshStandardMaterial
          color={0xfdf2f8}
          metalness={0.3}
          roughness={0.7}
        />
      </mesh>

      {/* Glow Sphere */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[2.5, 32, 32]} />
        <meshStandardMaterial
          color={0xf4a9b4}
          emissive={0xf4a9b4}
          emissiveIntensity={0.2}
          transparent
          opacity={0.15}
        />
      </mesh>

      {/* Uploaded Model */}
      {uploadedModel && (
        <primitive
          ref={modelRef}
          object={uploadedModel.mesh}
          scale={0.01}
          position={[0, -1, 0]}
        />
      )}
    </group>
  );
}

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.7} color={0xfdf2f8} />
      <directionalLight position={[6, 6, 6]} intensity={1.3} color={0xf4a9b4} castShadow />
      <directionalLight position={[-6, 4, -6]} intensity={0.9} color={0xffffff} />
      <pointLight position={[0, 0, 0]} intensity={1} color={0xf4a9b4} distance={12} />
    </>
  );
}

function SceneContent({ uploadedModel }: { uploadedModel: UploadedModel | null }) {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(0, 2.5, 10);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return (
    <>
      <Lighting />
      <PrintingChamber uploadedModel={uploadedModel} />
      <AIAdvisor position={[4, 1.5, 2]} scale={0.8} />
      <ParticleSystem />
    </>
  );
}

export default function Home() {
  const [language, setLanguage] = useState<Language>('en');
  const [uploadedModel, setUploadedModel] = useState<UploadedModel | null>(null);

  const t = (key: keyof typeof translations.en) => getTranslation(language, key);

  const handleModelLoaded = (model: UploadedModel) => {
    setUploadedModel(model);
    toast.success('STL file loaded successfully!');
  };

  const handleError = (error: string) => {
    toast.error(error);
  };

  return (
    <div className="relative w-full bg-background text-foreground">
      {/* HERO SECTION - Full 3D Scene */}
      <section className="relative w-full h-screen overflow-hidden">
        <Canvas
          className="w-full h-full"
          gl={{
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true,
          }}
          style={{ background: '#fdf2f8' }}
        >
          <PerspectiveCamera makeDefault position={[0, 2.5, 10]} fov={75} />
          <SceneContent uploadedModel={uploadedModel} />
          <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.3} />
          <Preload all />
        </Canvas>

        {/* UI Overlay on Hero */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-center space-y-4">
            <div className="font-serif text-6xl font-bold text-foreground opacity-90">
              {t('title')}
            </div>
            <div className="font-mono text-sm tracking-widest text-muted-foreground opacity-70">
              {t('subtitle')}
            </div>
          </div>

          {!uploadedModel && (
            <div className="absolute bottom-8 animate-bounce">
              <div className="font-mono text-xs text-muted-foreground opacity-50">
                {t('scrollHint')}
              </div>
            </div>
          )}
        </div>

        {/* Language Selector */}
        <div className="absolute top-6 right-6 flex gap-3 pointer-events-auto">
          {(['en', 'ja', 'zh'] as Language[]).map((lang) => (
            <button
              key={lang}
              onClick={() => setLanguage(lang)}
              className={`font-mono text-xs px-3 py-2 rounded transition-colors ${
                language === lang
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      {/* CONTENT SECTIONS */}
      <section className="min-h-screen bg-background px-8 py-20 flex items-center">
        <div className="max-w-2xl mx-auto space-y-8">
          <div className="space-y-4">
            <h2 className="font-serif text-5xl font-bold text-foreground">
              {t('designIntelligence')}
            </h2>
            <p className="font-mono text-sm text-muted-foreground leading-relaxed">
              {t('designDesc')}
            </p>
          </div>
        </div>
      </section>

      {/* UPLOAD SECTION */}
      <section className="min-h-screen bg-secondary/30 px-8 py-20 flex items-center">
        <div className="max-w-2xl mx-auto space-y-8 w-full">
          <div className="space-y-6">
            <h2 className="font-serif text-5xl font-bold text-foreground">
              {t('beginAnalysis')}
            </h2>

            <STLUploadHandler onModelLoaded={handleModelLoaded} onError={handleError} />
          </div>
        </div>
      </section>

      {/* ANALYSIS RESULTS SECTION */}
      {uploadedModel && (
        <section className="min-h-screen bg-background px-8 py-20 flex items-center">
          <div className="max-w-2xl mx-auto w-full">
            <AnalysisResults model={uploadedModel} language={language} />
          </div>
        </section>
      )}

      {/* FEATURES SECTION */}
      <section className="min-h-screen bg-background px-8 py-20">
        <div className="max-w-4xl mx-auto space-y-16">
          <h2 className="font-serif text-5xl font-bold text-foreground text-center">
            {t('analysisFeatures')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            {[
              {
                title: t('wallThickness'),
                desc: t('wallThicknessDesc'),
              },
              {
                title: t('overhangDetection'),
                desc: t('overhangDesc'),
              },
              {
                title: t('materialOptimization'),
                desc: t('materialDesc'),
              },
              {
                title: t('supplierMatching'),
                desc: t('supplierDesc'),
              },
            ].map((feature, idx) => (
              <div key={idx} className="space-y-3">
                <h3 className="font-serif text-2xl font-bold text-foreground">
                  {feature.title}
                </h3>
                <p className="font-mono text-sm text-muted-foreground leading-relaxed">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SUPPLIER CONSULTATION */}
      <SupplierConsultation />

      {/* FOOTER */}
      <footer className="bg-secondary/50 px-8 py-12 border-t border-border">
        <div className="max-w-4xl mx-auto text-center space-y-4">
          <p className="font-mono text-xs text-muted-foreground opacity-70">
            {t('footer')}
          </p>
        </div>
      </footer>
    </div>
  );
}
