import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { Sparkles, Download, Box, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { parseSTL } from '@/lib/stlParser';
import { fitCameraToGeometry } from '@/lib/modelNormalization';
import { countTriangles, decimateGeometry } from '@/lib/meshOps';
import { processMesh, type MeshProcessDiagnostics } from '@/lib/meshProcessClient';
import { runCadAnalysis } from '@/lib/cadAnalysis';
import { geometryToThreeMf } from '@/lib/threeMf';
import { recordPrintOutcome, getPrintStats, type PrintOutcome } from '@/lib/printFeedback';
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

const EXAMPLE_PROMPTS = ['a gear', 'a cube', 'a cylinder', 'a marble'];

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

  if (!mesh) return null;
  return <primitive object={mesh} />;
}

/** Frame the camera to the current mesh so it never fills the viewport. */
function CameraFit({
  geometry,
  fitKey,
  controlsRef,
}: {
  geometry: THREE.BufferGeometry | null;
  fitKey: number;
  controlsRef: { current: any };
}) {
  const { camera } = useThree();
  useEffect(() => {
    if (fitKey === 0 || !geometry) return;
    // Defer a frame so the mesh/controls exist before framing. Fires only on a
    // NEW generation (fitKey bump), not on decimate/process tweaks, so the view
    // stays where the user left it.
    const raf = requestAnimationFrame(() => fitCameraToGeometry(camera, controlsRef.current, geometry));
    return () => cancelAnimationFrame(raf);
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
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
  const [stlBytes, setStlBytes] = useState<ArrayBuffer | null>(null);
  const [serverDiag, setServerDiag] = useState<MeshProcessDiagnostics | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [printStats, setPrintStats] = useState(() => getPrintStats());
  const controlsRef = useRef<any>(null);

  const generate = useCallback(async (overridePrompt?: string) => {
    const p = (overridePrompt ?? prompt).trim();
    if (!p || !provider) return;
    setStatus('submitting');
    setError(null);
    setStlBytes(null);
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
      setStlBytes(state.stlBytes);
      setServerDiag(null);
      setFitKey((k) => k + 1); // re-frame camera on the new model
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('idle');
    }
  }, [prompt, material, language, provider, t]);

  const downloadSTL = () => {
    if (!stlBytes) return;
    const blob = new Blob([stlBytes], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(prompt || 'mesh').slice(0, 40).replace(/[^a-z0-9_-]/gi, '_')}.stl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const download3MF = () => {
    if (!geometry) return;
    const bytes = geometryToThreeMf(geometry);
    const blob = new Blob([bytes], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(prompt || 'mesh').slice(0, 40).replace(/[^a-z0-9_-]/gi, '_')}.3mf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintFeedback = (outcome: PrintOutcome) => {
    if (!gate) return;
    recordPrintOutcome({ confidence: gate.overallScore, verdict: gate.verdict, outcome });
    setPrintStats(getPrintStats());
  };

  const handleDecimate = () => {
    if (!geometry) return;
    const target = Math.max(200, Math.floor(countTriangles(geometry) / 2));
    const decimated = decimateGeometry(geometry, target);
    const result = runCadAnalysis(decimated, {
      fileName: `${(prompt || 'mesh').slice(0, 40).replace(/[^a-z0-9_-]/gi, '_')}.stl`,
      prompt,
      material,
      language,
    });
    setGeometry(result.geometry);
    setUnified(result.unified);
    setGate(result.gate);
    setIssues(result.issues);
  };

  const handleProcess = async () => {
    if (!stlBytes) return;
    try {
      const result = await processMesh(stlBytes, { decimateTo: 0 });
      setServerDiag(result.diagnostics);
      if (result.stlBytes.byteLength > 84) {
        const geo = parseSTL(result.stlBytes);
        const analysis = runCadAnalysis(geo, {
          fileName: `${(prompt || 'mesh').slice(0, 40).replace(/[^a-z0-9_-]/gi, '_')}.stl`,
          prompt,
          material,
          language,
        });
        setGeometry(analysis.geometry);
        setUnified(analysis.unified);
        setGate(analysis.gate);
        setIssues(analysis.issues);
        setStlBytes(result.stlBytes);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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

  const triCount = geometry
    ? geometry.index?.count
      ? geometry.index.count / 3
      : geometry.attributes.position.count / 3
    : 0;
  const isWatertight = unified?.validation?.result?.isWatertight === true;

  const hasResult = gate != null;

  return (
    <div className={`grid grid-rows-[1fr] h-[calc(100vh-3.5rem)] mt-14 grid-cols-[280px_1fr] ${hasResult ? 'lg:grid-cols-[280px_1fr_380px]' : ''}`}>
      {/* ── LEFT PANEL ── */}
      <div className="flex flex-col border-r border-border/15 bg-card/30 overflow-y-auto">
        <div className="px-4 pt-6 pb-3 space-y-4">
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
            onClick={() => generate()}
            disabled={status === 'submitting' || status === 'generating' || !prompt.trim()}
            className="w-full h-11 inline-flex items-center justify-center gap-2 bg-foreground text-background rounded-sm px-5 text-sm font-mono font-bold hover:bg-foreground/90 disabled:opacity-30 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            {status === 'generating' || status === 'submitting' ? t('meshGenerating') : t('meshGenerate')}
          </button>
          {hasResult && (
            <div className="flex items-stretch gap-2">
              <button
                onClick={() => generate()}
                disabled={status === 'submitting' || status === 'generating'}
                className="flex-1 h-9 inline-flex items-center justify-center border border-border/40 text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-sm text-sm font-mono transition-all"
              >
                {t('meshRegenerate')}
              </button>
              {stlBytes && (
                <button
                  onClick={downloadSTL}
                  title={t('meshDownloadStl')}
                  className="h-9 w-9 inline-flex items-center justify-center border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/40 rounded-sm transition-all shrink-0"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
              {geometry && (
                <button
                  onClick={download3MF}
                  title={t('meshDownload3mf')}
                  className="h-9 w-9 inline-flex items-center justify-center border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/40 rounded-sm transition-all shrink-0"
                >
                  <Box className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          {status === 'generating' && (
            <div className="text-xs font-mono text-primary animate-pulse">{t('meshGenerating')}</div>
          )}
          {error && <div className="text-sm text-red-400/80 font-mono whitespace-pre-wrap">{error}</div>}
          {status === 'idle' && !error && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground/40 font-mono tracking-[0.2em]">{t('meshExamplesLabel')}</div>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_PROMPTS.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => {
                      setPrompt(ex);
                      generate(ex);
                    }}
                    className="text-[11px] font-mono px-2 py-1 border border-border/30 rounded-sm text-muted-foreground/60 hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
              <div className="text-xs text-muted-foreground/40 font-mono leading-relaxed pt-1">{t('meshEmptyHint')}</div>
            </div>
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
          <CameraFit geometry={geometry} fitKey={fitKey} controlsRef={controlsRef} />
          <OrbitControls ref={controlsRef} enableDamping dampingFactor={0.05} />
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

            {/* Printable readiness */}
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em]">{t('cadReadiness')}</div>
              <div className="p-2.5 border border-border/15 rounded-sm space-y-1">
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted-foreground/50 uppercase tracking-wider">{t('cadTri')}</span>
                  <span className="text-muted-foreground/70 tabular-nums">{triCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted-foreground/50 uppercase tracking-wider">{t('cadWatertight')}</span>
                  <span className={isWatertight ? 'text-emerald-400' : 'text-red-400'}>✓</span>
                </div>
                {triCount > 200 && (
                  <button
                    onClick={handleDecimate}
                    className="w-full h-8 inline-flex items-center justify-center gap-1.5 border border-border/40 text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-sm text-[11px] font-mono transition-all"
                  >
                    {t('meshDecimate')}
                  </button>
                )}
                {stlBytes && (
                  <button
                    onClick={handleProcess}
                    className="w-full h-8 inline-flex items-center justify-center gap-1.5 border border-border/40 text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-sm text-[11px] font-mono transition-all"
                  >
                    {t('meshProcess')}
                  </button>
                )}
                {serverDiag && (
                  <>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-muted-foreground/50 uppercase tracking-wider">{t('cadVolume')}</span>
                      <span className="text-muted-foreground/70 tabular-nums">
                        {serverDiag.volumeMm3 != null ? `${Math.round(serverDiag.volumeMm3)} mm³` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-muted-foreground/50 uppercase tracking-wider">{t('meshBodies')}</span>
                      <span className="text-muted-foreground/70 tabular-nums">{serverDiag.bodyCount ?? '—'}</span>
                    </div>
                    {serverDiag.repaired && (
                      <div className="text-[11px] font-mono text-emerald-400/80">REPAIRED ✓</div>
                    )}
                    {serverDiag.repairNote && (
                      <div className="text-[11px] font-mono text-amber-400/70 break-words leading-relaxed">
                        {serverDiag.repairNote}
                      </div>
                    )}
                  </>
                )}

                {/* Print feedback — calibrates the confidence gate with reality */}
                <div className="pt-1.5 border-t border-border/10 space-y-1.5">
                  <div className="text-[10px] text-muted-foreground/40 font-mono tracking-[0.2em]">
                    {t('meshPrintFeedback')}
                  </div>
                  <div className="text-[11px] text-muted-foreground/50 font-mono">
                    {t('meshPrintStats')
                      .replace('{n}', String(printStats.count))
                      .replace('{pct}', printStats.okRate != null ? String(Math.round(printStats.okRate * 100)) : '—')}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handlePrintFeedback('ok')}
                      title={t('meshPrintOk')}
                      className="h-6 w-6 inline-flex items-center justify-center border border-border/40 rounded-sm text-emerald-400/70 hover:text-emerald-400 hover:border-emerald-400/40 transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handlePrintFeedback('issue')}
                      title={t('meshPrintIssue')}
                      className="h-6 w-6 inline-flex items-center justify-center border border-border/40 rounded-sm text-amber-400/70 hover:text-amber-400 hover:border-amber-400/40 transition-colors"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handlePrintFeedback('fail')}
                      title={t('meshPrintFail')}
                      className="h-6 w-6 inline-flex items-center justify-center border border-border/40 rounded-sm text-red-400/70 hover:text-red-400 hover:border-red-400/40 transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
