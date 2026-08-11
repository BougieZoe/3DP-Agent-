import { useCallback, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { Sparkles } from 'lucide-react';
import { parseSTL } from '@/lib/stlParser';
import { runCadAnalysis } from '@/lib/cadAnalysis';
import { createMeshProvider } from '@/design/mesh';
import { useMaterial } from '@/contexts/MaterialContext';
import { getTranslation, translations } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import type { UnifiedAnalysis } from '@/analysis';
import type { CADConfidenceReport, Issue as ConfidenceIssue } from '@/cad-confidence';

type TKey = keyof (typeof translations)['en'];

const TRIPO_KEY = (import.meta.env.VITE_TRIPO_API_KEY as string | undefined) ?? '';

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function verdictClass(verdict: string): string {
  if (verdict === 'PASS') return 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10';
  if (verdict === 'WARN') return 'border-amber-500/30 text-amber-400 bg-amber-500/10';
  return 'border-red-500/30 text-red-400 bg-red-500/10';
}

function MeshPreview({ geometry }: { geometry: THREE.BufferGeometry | null }) {
  const mesh = useMemo(() => {
    if (!geometry) return null;
    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x4a7dcc,
        metalness: 0.4,
        roughness: 0.35,
        side: THREE.DoubleSide,
      }),
    );
  }, [geometry]);

  // Center the mesh on the build plate for a consistent view.
  const centered = useMemo(() => {
    if (!mesh || !geometry) return null;
    geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    geometry.boundingBox?.getCenter(center);
    mesh.position.copy(center.clone().negate());
    return mesh;
  }, [mesh, geometry]);

  if (!centered) return null;
  return <primitive object={centered} />;
}

interface PrintRow {
  label: string;
  value: string;
}

export function MeshStudio({ language }: { language: Language }) {
  const { material } = useMaterial();
  const t = (key: TKey) => getTranslation(language, key);
  const provider = useMemo(() => createMeshProvider({ tripoApiKey: TRIPO_KEY }), []);

  const [prompt, setPrompt] = useState('');
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [unified, setUnified] = useState<UnifiedAnalysis | null>(null);
  const [gate, setGate] = useState<CADConfidenceReport | null>(null);
  const [issues, setIssues] = useState<ConfidenceIssue[]>([]);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'generating' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    const p = prompt.trim();
    if (!p || !provider) return;
    setStatus('submitting');
    setError(null);
    setGeometry(null);
    setUnified(null);
    setGate(null);
    setIssues([]);
    try {
      const handle = await provider.generate({ prompt: p });
      setStatus('generating');
      let state = await provider.poll(handle);
      while (state.status === 'queued' || state.status === 'running') {
        await new Promise((r) => setTimeout(r, 2000));
        state = await provider.poll(handle);
      }
      if (state.status === 'failed') {
        setError(state.reason);
        setStatus('idle');
        return;
      }
      if (state.stlBytes.byteLength <= 84) {
        setError(t('meshNoMesh'));
        setStatus('idle');
        return;
      }
      const geo = parseSTL(state.stlBytes);
      const result = runCadAnalysis(geo, { fileName: `${p}.stl`, prompt: p, material, language });
      setGeometry(result.geometry);
      setUnified(result.unified);
      setGate(result.gate);
      setIssues(result.issues);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('idle');
    }
  }, [prompt, material, language, provider, t]);

  const m = unified?.metrics?.result;
  const sp = unified?.support?.result;
  const pt = unified?.printTime?.result;
  const bf = unified?.bedFit?.result;

  const rows: PrintRow[] = [];
  if (bf) rows.push({ label: t('cadBedFit'), value: bf.fits ? `✓ ${bf.printerProfile.name}` : `✗ ${bf.printerProfile.name}` });
  if (sp) rows.push({ label: t('cadSupport'), value: `${Math.round(sp.totalSupportVolumeMm3 ?? 0)} mm³` });
  if (pt) rows.push({ label: t('cadPrintTime'), value: `${pt.estimatedPrintTimeHours.toFixed(1)} h` });
  if (pt) rows.push({ label: t('cadMaterialWt'), value: `${pt.materialWeightGrams.toFixed(1)} g` });
  if (pt) rows.push({ label: t('cadCost'), value: `$${pt.materialCostUsd.toFixed(2)}` });

  const hasResult = gate != null;

  return (
    <div className={`grid grid-rows-[72px_1fr] h-[calc(100vh-7rem)] grid-cols-[280px_1fr] ${hasResult ? 'lg:grid-cols-[280px_1fr_380px]' : ''}`}>
      {/* ── HEADER ── */}
      <header className="col-span-full flex items-center justify-between px-6 pt-5 border-b border-border/15 bg-card/30">
        <div className="flex items-center gap-6">
          <div>
            <h1 className="text-lg font-mono font-bold tracking-tight text-foreground">3DP AGENT</h1>
            <p className="text-sm font-mono text-muted-foreground/40 tracking-wider">{t('meshStudio')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-sm border ${
            provider.id === 'tripo'
              ? 'text-primary border-primary/30 bg-primary/5'
              : 'text-amber-400 border-amber-400/30 bg-amber-400/5'
          }`}>
            {provider.id === 'tripo' ? t('meshProviderTripo') : t('meshProviderMock')}
          </span>
        </div>
      </header>

      {/* ── LEFT PANEL ── */}
      <div className="flex flex-col border-r border-border/15 bg-card/30 overflow-y-auto">
        <div className="px-4 pt-5 pb-3 space-y-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && status === 'idle') {
                e.preventDefault();
                generate();
              }
            }}
            className="w-full h-[130px] resize-none bg-background border border-border/25 rounded-sm px-4 py-3 text-sm font-mono leading-relaxed text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
            placeholder={t('meshPlaceholder')}
          />
          <button
            onClick={generate}
            disabled={status === 'submitting' || status === 'generating' || !prompt.trim()}
            className="w-full h-11 inline-flex items-center justify-center gap-2 bg-foreground text-background rounded-sm px-5 text-sm font-mono font-bold hover:bg-foreground/90 disabled:opacity-30 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            {status === 'generating' || status === 'submitting' ? t('meshGenerating') : t('meshGenerate')}
          </button>
          {status === 'generating' && (
            <div className="text-xs font-mono text-primary animate-pulse">{t('meshGenerating')}</div>
          )}
          {error && <div className="text-sm text-red-400/80 font-mono whitespace-pre-wrap">{error}</div>}
          {status === 'idle' && !error && (
            <div className="text-xs text-muted-foreground/40 font-mono leading-relaxed">{t('meshEmptyHint')}</div>
          )}
        </div>
      </div>

      {/* ── CENTER: VIEWPORT ── */}
      <section className="relative overflow-hidden bg-card/20">
        <Canvas gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}>
          <PerspectiveCamera makeDefault position={[0, 6, 18]} fov={55} />
          <ambientLight intensity={0.4} />
          <directionalLight position={[6, 8, 5]} intensity={0.8} />
          <directionalLight position={[-7, 4, -4]} intensity={0.3} color={0x3cf0b6} />
          <Grid
            args={[80, 80]}
            cellSize={5}
            cellThickness={0.3}
            cellColor="#0b2b33"
            sectionSize={25}
            sectionThickness={0.7}
            sectionColor="#124650"
            fadeDistance={60}
            fadeStrength={1}
          />
          <MeshPreview geometry={geometry} />
          <OrbitControls enableDamping dampingFactor={0.05} />
        </Canvas>
      </section>

      {/* ── RIGHT: ANALYSIS REPORT ── */}
      {hasResult && (
        <div className="hidden lg:flex flex-col border-l border-border/15 bg-card/30 overflow-y-auto">
          <div className="p-4 space-y-4">
            <div className="text-center">
              <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em] mb-1.5">
                {t('cadMfgConfidence')}
              </div>
              <span className="text-4xl font-bold font-mono tabular-nums tracking-tight" style={{ color: scoreColor(gate.overallScore) }}>
                {gate.overallScore}%
              </span>
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-sm border mt-2 text-[12px] font-bold font-mono ${verdictClass(gate.verdict)}`}>
                {gate.verdict}
              </div>
            </div>

            {rows.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em]">{t('cadPrintCheck')}</div>
                <div className="p-2.5 border border-border/15 rounded-sm space-y-1">
                  {rows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="text-muted-foreground/50 uppercase tracking-wider shrink-0">{row.label}</span>
                      <span className="text-muted-foreground/70 tabular-nums text-right break-all">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {issues.length > 0 && (
              <div className="space-y-1">
                <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em]">{t('cadKeyIssues')}</div>
                {issues.slice(0, 3).map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px] font-mono leading-relaxed">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${
                      issue.severity === 'error' ? 'bg-red-400' : issue.severity === 'warning' ? 'bg-amber-400' : 'bg-emerald-400'
                    }`} />
                    <span className="text-muted-foreground/60">{issue.message}</span>
                  </div>
                ))}
              </div>
            )}

            {m && (
              <div className="space-y-1">
                <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em]">{t('cadGeometry')}</div>
                <div className="p-2.5 border border-border/15 rounded-sm space-y-1">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-muted-foreground/50 uppercase tracking-wider">{t('cadVolume')}</span>
                    <span className="text-muted-foreground/70 tabular-nums">{Math.round(m.meshVolumeMm3 ?? 0)} mm³</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-muted-foreground/50 uppercase tracking-wider">{t('cadAvgWall')}</span>
                    <span className="text-muted-foreground/70 tabular-nums">{m.avgWallThicknessMm?.toFixed(1)} mm</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
