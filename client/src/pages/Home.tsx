import { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { STLUploadHandler, UploadedModel } from '@/components/STLUploadHandler';
import { ChatPanel } from '@/components/ChatPanel';
import { CADWorkspace } from '@/components/CADWorkspace';
import { APIKeyModal } from '@/components/APIKeyModal';
import { generateQuickReport, ModelData } from '@/lib/ruleEngine';
import { getActiveProvider, hasAnyKey } from '@/lib/apiKeys';
import { Language } from '@/lib/i18n';
import { toast } from 'sonner';

// ─── 3D Helpers ────────────────────────────────────────────────────────────────

function FloatingParticles() {
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

function ModelDisplay({ model }: { model: UploadedModel | null }) {
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

function SceneContent({ model }: { model: UploadedModel | null }) {
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

// ─── Metric Row ────────────────────────────────────────────────────────────────

function MetricRow({ label, value, unit = '', highlight = false }: {
  label: string; value: string | number; unit?: string; highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`text-xs font-mono ${highlight ? 'text-primary' : 'text-foreground'}`}>
        {value}{unit && <span className="text-muted-foreground/50 ml-1 text-xs">{unit}</span>}
      </span>
    </div>
  );
}

function StatusChip({ status }: { status: 'good' | 'warning' | 'critical' }) {
  const cfg = {
    good:     { label: 'NOMINAL',  cls: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5' },
    warning:  { label: 'CAUTION', cls: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5' },
    critical: { label: 'CRITICAL', cls: 'text-red-400 border-red-400/30 bg-red-400/5' },
  }[status];
  return <span className={`text-xs font-mono px-2 py-0.5 border rounded-sm ${cfg.cls}`}>{cfg.label}</span>;
}

// ─── Home ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [language, setLanguage] = useState<Language>('en');
  const [uploadedModel, setUploadedModel] = useState<UploadedModel | null>(null);
  const [tab, setTab] = useState<'geometry' | 'report' | 'chat'>('geometry');
  const [workspace, setWorkspace] = useState<'analyze' | 'cad'>('analyze');
  const [showAPIModal, setShowAPIModal] = useState(false);
  const [quickReport, setQuickReport] = useState('');
  const [reportLoading, setReportLoading] = useState(false);

  const handleModelLoaded = (model: UploadedModel) => {
    setUploadedModel(model);
    setTab('geometry');
    setQuickReport('');
    toast.success('STL parsed — ' + model.fileName);
  };

  const getModelData = (): ModelData | null => {
    if (!uploadedModel) return null;
    return {
      fileName: uploadedModel.fileName,
      wallThickness: uploadedModel.analysis.wallThickness,
      overhang: uploadedModel.analysis.overhang,
      volume: uploadedModel.analysis.volume,
      surfaceArea: uploadedModel.analysis.surfaceArea,
      dims: {
        x: uploadedModel.analysis.bounds.max.x - uploadedModel.analysis.bounds.min.x,
        y: uploadedModel.analysis.bounds.max.y - uploadedModel.analysis.bounds.min.y,
        z: uploadedModel.analysis.bounds.max.z - uploadedModel.analysis.bounds.min.z,
      },
    };
  };

  const handleGenerateReport = () => {
    const md = getModelData();
    if (!md) return;
    setReportLoading(true);
    setTimeout(() => {
      setQuickReport(generateQuickReport(md, language));
      setReportLoading(false);
    }, 600);
  };

  const analysis = uploadedModel?.analysis;
  const modelData = getModelData();
  const providerLabel = getActiveProvider() ? { claude: 'Claude', openai: 'GPT-4o', gemini: 'Gemini', deepseek: 'DeepSeek' }[getActiveProvider()!] : null;

  return (
    <div className="relative w-full min-h-screen bg-background grid-bg overflow-x-hidden">
      {showAPIModal && <APIKeyModal onClose={() => setShowAPIModal(false)} />}

      {/* ── Header ── */}
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-5 py-3 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
          <span className="text-sm font-mono text-primary tracking-widest">3DP AGENT</span>
          <span className="text-xs text-muted-foreground/50 hidden sm:block">v2.0 // STL Analysis</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center border border-border rounded-sm overflow-hidden">
            {(['analyze', 'cad'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setWorkspace(mode)}
                className={`text-xs font-mono px-3 py-1 transition-all ${
                  workspace === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-primary'
                }`}
              >
                {mode === 'analyze' ? 'ANALYZE' : 'CAD STUDIO'}
              </button>
            ))}
          </div>
          {/* Language */}
          <div className="flex items-center gap-0.5">
            {(['en', 'ja', 'zh'] as Language[]).map(lang => (
              <button key={lang} onClick={() => setLanguage(lang)}
                className={`text-xs font-mono px-2 py-1 rounded-sm transition-all ${
                  language === lang ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-primary'
                }`}>
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
          {/* API config */}
          <button onClick={() => setShowAPIModal(true)}
            className={`text-xs font-mono px-3 py-1 border rounded-sm transition-all ${
              hasAnyKey()
                ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
            }`}>
            {providerLabel ? `AI: ${providerLabel}` : 'API KEYS'}
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      {workspace === 'cad' ? (
        <main className="pt-20 px-4 pb-4 min-h-screen">
          <div className="sm:hidden mb-3 grid grid-cols-2 border border-border rounded-sm overflow-hidden">
            {(['analyze', 'cad'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setWorkspace(mode)}
                className={`text-xs font-mono px-3 py-2 transition-all ${
                  workspace === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-primary'
                }`}
              >
                {mode === 'analyze' ? 'ANALYZE' : 'CAD STUDIO'}
              </button>
            ))}
          </div>
          <CADWorkspace language={language} />
        </main>
      ) : (
      <div className="pt-14 flex flex-col lg:flex-row min-h-screen">

        {/* Left: 3D Viewport */}
        <div className="lg:w-1/2 h-[45vh] lg:h-[calc(100vh-3.5rem)] lg:sticky lg:top-14 border-b lg:border-b-0 lg:border-r border-border relative">
          <div className="absolute top-3 left-4 z-10 font-mono text-xs text-muted-foreground/40 space-y-0.5 hidden lg:block">
            <div>// VIEWPORT</div>
            <div>// drag: rotate · scroll: zoom</div>
          </div>
          <Canvas gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}>
            <PerspectiveCamera makeDefault position={[0, 3, 10]} fov={60} />
            <SceneContent model={uploadedModel} />
            <OrbitControls enablePan={false} autoRotate={!uploadedModel} autoRotateSpeed={0.4} />
          </Canvas>
          {uploadedModel && (
            <div className="absolute bottom-3 left-4 text-xs font-mono text-muted-foreground/30">
              {uploadedModel.fileName}
            </div>
          )}
        </div>

        {/* Right: Panel */}
        <div className="lg:w-1/2 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto">
          <div className="p-5 space-y-5">

            {/* Upload */}
            <div>
              <div className="text-xs text-muted-foreground/50 mb-2 font-mono tracking-widest">// INPUT</div>
              <STLUploadHandler onModelLoaded={handleModelLoaded} onError={e => toast.error(e)} />
            </div>

            {/* Analysis tabs */}
            {analysis && modelData && (
              <div className="space-y-0 fade-up">
                {/* Tabs */}
                <div className="flex border-b border-border">
                  {(['geometry', 'report', 'chat'] as const).map(t => (
                    <button key={t} onClick={() => setTab(t)}
                      className={`text-xs font-mono px-4 py-2.5 border-b-2 transition-all ${
                        tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}>
                      {t === 'geometry' ? 'GEOMETRY' : t === 'report' ? 'REPORT' : 'CHAT AI'}
                    </button>
                  ))}
                </div>

                {/* GEOMETRY TAB */}
                {tab === 'geometry' && (
                  <div className="space-y-4 pt-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 border border-border rounded-sm bg-card">
                        <div className="text-xs text-muted-foreground mb-2 font-mono">WALL THICKNESS</div>
                        <StatusChip status={analysis.wallThickness.status} />
                      </div>
                      <div className="p-3 border border-border rounded-sm bg-card">
                        <div className="text-xs text-muted-foreground mb-2 font-mono">OVERHANG</div>
                        <StatusChip status={analysis.overhang.status} />
                      </div>
                    </div>
                    <div className="border border-border rounded-sm bg-card p-4">
                      <div className="text-xs text-muted-foreground mb-3 font-mono tracking-widest">GEOMETRY DATA</div>
                      <MetricRow label="MIN THICKNESS" value={analysis.wallThickness.minThickness.toFixed(3)} unit="mm" highlight />
                      <MetricRow label="VOLUME" value={analysis.volume.toFixed(1)} unit="mm³" />
                      <MetricRow label="SURFACE AREA" value={analysis.surfaceArea.toFixed(1)} unit="mm²" />
                      <MetricRow label="DIM X" value={modelData.dims.x.toFixed(2)} unit="mm" />
                      <MetricRow label="DIM Y" value={modelData.dims.y.toFixed(2)} unit="mm" />
                      <MetricRow label="DIM Z" value={modelData.dims.z.toFixed(2)} unit="mm" />
                      <MetricRow label="OVERHANG FACES" value={analysis.overhang.areas} />
                    </div>
                    <button onClick={() => setTab('report')}
                      className="w-full py-2.5 text-xs font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all">
                      GENERATE REPORT →
                    </button>
                  </div>
                )}

                {/* REPORT TAB */}
                {tab === 'report' && (
                  <div className="pt-4 space-y-4">
                    {!quickReport && (
                      <button onClick={handleGenerateReport} disabled={reportLoading}
                        className="w-full py-3 text-xs font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all disabled:opacity-50">
                        {reportLoading ? '▋ ANALYZING...' : '⚡ GENERATE QUICK REPORT (FREE)'}
                      </button>
                    )}
                    {quickReport && (
                      <div className="border border-border rounded-sm bg-card p-4 fade-up">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-mono text-primary tracking-widest">ANALYSIS REPORT</span>
                          <span className="text-xs font-mono text-muted-foreground/40">[LOCAL ENGINE]</span>
                        </div>
                        <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
                          {quickReport}
                        </pre>
                        <button onClick={() => setQuickReport('')}
                          className="mt-4 text-xs font-mono text-muted-foreground hover:text-primary transition-colors">
                          ↺ REGENERATE
                        </button>
                      </div>
                    )}
                    <div className="border border-dashed border-border/40 rounded-sm p-4 text-center space-y-2">
                      <div className="text-xs font-mono text-muted-foreground">DEEP AI ANALYSIS</div>
                      <div className="text-xs text-muted-foreground/50">Full AI report with Claude / GPT-4o / Gemini</div>
                      <button onClick={() => { setShowAPIModal(true); }}
                        className="text-xs font-mono px-4 py-2 border border-primary/30 text-primary hover:bg-primary/10 rounded-sm transition-all">
                        {hasAnyKey() ? 'SWITCH TO CHAT →' : 'CONFIGURE API KEY →'}
                      </button>
                    </div>
                  </div>
                )}

                {/* CHAT TAB */}
                {tab === 'chat' && (
                  <div className="pt-4 h-[520px]">
                    <ChatPanel
                      model={modelData}
                      language={language}
                      onNeedAPIKey={() => setShowAPIModal(true)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Empty state */}
            {!uploadedModel && (
              <div className="space-y-4">
                <div className="border border-dashed border-border/30 rounded-sm p-8 text-center space-y-2">
                  <div className="text-muted-foreground/20 text-3xl font-mono">[ ]</div>
                  <div className="text-xs text-muted-foreground/50 font-mono">Upload STL to begin</div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground/40 font-mono tracking-widest">// FEATURES</div>
                  {[
                    ['FREE', 'Geometry analysis — wall, overhang, dims'],
                    ['FREE', 'Quick report — material, settings, time estimate'],
                    ['FREE', 'Common Q&A — instant local answers'],
                    ['AI KEY', 'Deep chat — Claude / GPT-4o / Gemini'],
                    ['AI KEY', 'Complex design optimization advice'],
                  ].map(([badge, desc]) => (
                    <div key={desc} className="flex items-center gap-3 p-2.5 border border-border/20 rounded-sm hover:border-border/50 transition-all">
                      <span className={`text-xs font-mono px-1.5 py-0.5 rounded-sm border shrink-0 ${
                        badge === 'FREE' ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5' : 'text-primary border-primary/30 bg-primary/5'
                      }`}>{badge}</span>
                      <span className="text-xs text-muted-foreground">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-border/30 text-xs text-muted-foreground/20 font-mono text-center">
              3DP AGENT © 2026 — Open Source
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
