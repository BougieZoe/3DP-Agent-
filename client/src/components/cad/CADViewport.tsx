import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, PerspectiveCamera, Environment } from "@react-three/drei";
import * as THREE from "three";
import { Maximize2, Minimize2, Camera, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { CAD_MATERIALS, getCADMaterialPreset, createCADMaterial, type CADMaterialPreset } from "@/lib/cadMaterials";
import type { UnifiedAnalysis } from "@/analysis";

/* ─── Helpers ─── */

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function verdictColor(verdict: string): string {
  if (verdict === 'PASS') return '#22c55e';
  if (verdict === 'WARN') return '#f59e0b';
  return '#ef4444';
}

function verdictBg(verdict: string): string {
  if (verdict === 'PASS') return 'bg-emerald-500/15';
  if (verdict === 'WARN') return 'bg-amber-500/15';
  return 'bg-red-500/15';
}

/* ─── 3D Preview ─── */

const PreviewMesh = memo(function PreviewMesh({
  geometry,
  preset,
  fitKey,
}: {
  geometry: THREE.BufferGeometry | null;
  preset: CADMaterialPreset;
  fitKey: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const initialFitDone = useRef(false);

  useEffect(() => {
    if (!geometry || !meshRef.current) return;
    const box = new THREE.Box3().setFromObject(meshRef.current);
    const center = new THREE.Vector3();
    box.getCenter(center);
    meshRef.current.position.sub(center);
  }, [geometry]);

  useEffect(() => {
    if (initialFitDone.current || !geometry || !meshRef.current) return;
    const box = new THREE.Box3().setFromObject(meshRef.current);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    meshRef.current.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 1.8;
    camera.position.set(dist * 0.6, dist * 0.5, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    initialFitDone.current = true;
  }, [geometry, camera]);

  useEffect(() => {
    if (fitKey === 0 || !geometry || !meshRef.current) return;
    const box = new THREE.Box3().setFromObject(meshRef.current);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    meshRef.current.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 1.8;
    camera.position.set(dist * 0.6, dist * 0.5, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [fitKey]);

  const mesh = useMemo(() => {
    if (!geometry) return null;
    const mat = createCADMaterial(preset);
    const m = new THREE.Mesh(geometry, mat);
    m.castShadow = true;
    return m;
  }, [geometry, preset]);

  if (!mesh) return null;
  return <primitive ref={meshRef} object={mesh} />;
});

function PreviewPlaceholder() {
  return (
    <group>
      <mesh>
        <boxGeometry args={[3, 1.5, 0.2]} />
        <meshBasicMaterial color={0x2ea3ff} wireframe transparent opacity={0.25} />
      </mesh>
      <mesh position={[0, 0.2, 0.8]}>
        <torusGeometry args={[0.8, 0.1, 12, 32]} />
        <meshBasicMaterial color={0x66ccff} wireframe transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

/* ─── Viewport overlays ─── */

function VerdictOverlay({ verdict, score, visible }: { verdict: string; score: number; visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="absolute top-4 right-4 z-10">
      <div className={`${verdictBg(verdict)} backdrop-blur border border-border/50 rounded-sm px-4 py-2.5 text-center min-w-[120px]`}>
        <div className="flex items-center justify-center gap-1.5">
          {verdict === 'PASS' ? <CheckCircle2 className="w-4 h-4" style={{ color: verdictColor(verdict) }} />
           : verdict === 'WARN' ? <AlertTriangle className="w-4 h-4" style={{ color: verdictColor(verdict) }} />
           : <XCircle className="w-4 h-4" style={{ color: verdictColor(verdict) }} />}
          <span className="text-sm font-bold font-mono" style={{ color: verdictColor(verdict) }}>{verdict}</span>
        </div>
        <div className="text-[11px] text-muted-foreground/60 mt-0.5 font-mono tabular-nums">{score}%</div>
      </div>
    </div>
  );
}

function MaterialSelector({ current, onChange }: { current: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const currentPreset = getCADMaterialPreset(current);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono text-muted-foreground/60 hover:text-muted-foreground hover:border-primary/30 bg-background/70 backdrop-blur border border-border/50 rounded-sm transition-all whitespace-nowrap">
        <span className="w-3 h-3 rounded-full border border-border/50" style={{ backgroundColor: currentPreset.color }} />
        {currentPreset.label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-1.5 z-30 bg-background/95 backdrop-blur border border-border/60 rounded-sm shadow-lg min-w-[160px] py-1">
            {CAD_MATERIALS.map(m => (
              <button key={m.id} onClick={() => { onChange(m.id); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] font-mono text-left transition-all hover:bg-primary/5 ${m.id === current ? 'text-primary' : 'text-muted-foreground/70'}`}>
                <span className="w-3 h-3 rounded-full border border-border/40 shrink-0" style={{ backgroundColor: m.color }} />
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FitViewButton({ onFit }: { onFit: () => void }) {
  return (
    <button onClick={onFit}
      className="w-7 h-7 flex items-center justify-center bg-background/70 backdrop-blur border border-border/50 rounded-sm text-muted-foreground/50 hover:text-primary hover:border-primary/30 transition-all"
      title="Fit View">
      <Maximize2 className="w-3 h-3" />
    </button>
  );
}

/* ─── Main export ─── */

export interface CADViewportProps {
  geometry: THREE.BufferGeometry | null;
  cadPreset: CADMaterialPreset;
  cadMaterialId: string;
  setCadMaterialId: (id: string) => void;
  fitKey: number;
  setFitKey: (k: number | ((k: number) => number)) => void;
  analysis: UnifiedAnalysis | null;
  score: number;
  verdict: string;
  loading: boolean;
  stages: Array<{ id: string; label: string; status: string; elapsedMs: number }>;
  totalTime: number;
  hasGeometry: boolean;
}

export function CADViewport({
  geometry, cadPreset, cadMaterialId, setCadMaterialId,
  fitKey, setFitKey, analysis, score, verdict,
  loading, stages, totalTime, hasGeometry,
}: CADViewportProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  const handleScreenshot = useCallback(() => {
    const canvas = sectionRef.current?.querySelector('canvas');
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `cad-screenshot-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  }, []);

  return (
    <section
      ref={sectionRef}
      className={`relative overflow-hidden bg-card/20 transition-all duration-300 ${
        isFullscreen ? 'fixed inset-0 z-50' : ''
      }`}>
      <VerdictOverlay verdict={verdict} score={score} visible={analysis != null} />

      {loading && stages.length > 0 && !hasGeometry && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex flex-col gap-3 px-5 py-4 bg-background/70 backdrop-blur border border-border/15 rounded-sm min-w-[300px]">
            <div className="text-sm text-muted-foreground/40 font-mono tracking-[0.2em] mb-1">GENERATING</div>
            {stages.map(s => (
              <div key={s.id} className="flex items-center gap-2 text-sm font-mono text-muted-foreground/60">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  s.status === 'done' ? 'bg-emerald-400/60' :
                  s.status === 'running' ? 'bg-primary/60 animate-pulse' :
                  s.status === 'error' ? 'bg-red-400/60' :
                  'bg-muted-foreground/20'
                }`} />
                <span>{s.label}</span>
                {s.elapsedMs > 0 && <span className="text-muted-foreground/40 tabular-nums ml-auto">{s.elapsedMs}ms</span>}
              </div>
            ))}
            {totalTime > 0 && <span className="text-sm text-emerald-400/60 font-mono tabular-nums mt-1">Total: {totalTime}ms</span>}
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-5 right-5 z-10 flex items-center gap-2">
        <MaterialSelector current={cadMaterialId} onChange={setCadMaterialId} />
        <div className="ml-auto" />
        {hasGeometry && (
          <button onClick={handleScreenshot}
            className="w-7 h-7 flex items-center justify-center bg-background/70 backdrop-blur border border-border/50 rounded-sm text-muted-foreground/50 hover:text-primary hover:border-primary/30 transition-all"
            title="Screenshot">
            <Camera className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={() => setIsFullscreen(f => !f)}
          className="w-7 h-7 flex items-center justify-center bg-background/70 backdrop-blur border border-border/50 rounded-sm text-muted-foreground/50 hover:text-primary hover:border-primary/30 transition-all"
          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
          {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
        </button>
        <FitViewButton onFit={() => setFitKey(k => k + 1)} />
      </div>

      <Canvas gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}>
        <PerspectiveCamera makeDefault position={[0, 0, 8]} fov={55} />
        <Environment preset="studio" />
        <ambientLight intensity={0.3} color={0xb9f8ff} />
        <directionalLight position={[6, 7, 5]} intensity={0.8} color={0xffffff} />
        <directionalLight position={[-7, 4, -4]} intensity={0.3} color={0x3cf0b6} />
        <pointLight position={[0, 5, 6]} intensity={0.2} color={0x50a7ff} />
        <Grid args={[200, 200]} cellSize={10} cellThickness={0.3} cellColor="#0b2b33" sectionSize={50} sectionThickness={0.7} sectionColor="#124650" fadeDistance={180} fadeStrength={1} position={[0, -0.02, 0]} />
        {hasGeometry ? <PreviewMesh geometry={geometry} preset={cadPreset} fitKey={fitKey} /> : <PreviewPlaceholder />}
        <OrbitControls enableDamping dampingFactor={0.05} rotateSpeed={1.0} screenSpacePanning={true} />
      </Canvas>
    </section>
  );
}
