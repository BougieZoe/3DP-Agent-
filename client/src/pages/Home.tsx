import { ReportGenerator } from "@/components/ReportGenerator";
import { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { STLUploadHandler, UploadedModel } from '@/components/STLUploadHandler';
import { CADWorkspace } from '@/components/CADWorkspace';
import { ChatPanel } from '@/components/ChatPanel';
import { APIKeyModal } from '@/components/APIKeyModal';
import { generateQuickReport, ModelData } from '@/lib/ruleEngine';
import { getActiveProvider, hasAnyKey } from '@/lib/apiKeys';
import { Language, getTranslation } from '@/lib/i18n';
import { AI_PROVIDER_METADATA } from '@shared/domain/providers';
import { AgentOrchestrator, AgentRunSummary, getAgentLabel, getAgentDescription } from '@/agents';
import { OverhangHeatmap } from '@/components/3D/OverhangHeatmap';
import { SupportGhosts } from '@/components/3D/SupportGhosts';
import { RiskAnimation } from '@/components/3D/RiskAnimation';
import { VisualizationToolbar } from '@/components/3D/VisualizationToolbar';
import { OptimizeButton } from '@/components/3D/OptimizeButton';
import { PrintPathPreview } from '@/components/3D/PrintPathPreview';
import { LayerReveal } from '@/components/3D/LayerReveal';
import { FailureEmergence } from '@/components/3D/FailureEmergence';
import { ThermalField } from '@/components/3D/ThermalField';
import { CausalityHighlight } from '@/components/3D/CausalityHighlight';
import { buildCausalityGraph, CausalityGraph } from '@/components/causality/causalityEngine';
import { ManufacturingTimeline } from '@/components/causality/ManufacturingTimeline';
import { CausalityPanel } from '@/components/causality/CausalityPanel';
import { detectPatterns, PatternMatch } from '@/components/causality/topologyPatternEngine';
import { PatternMemoryPanel } from '@/components/causality/PatternMemoryPanel';
import { evaluateCounterfactuals, GeometrySuggestion } from '@/components/causality/counterfactualEngine';
import { GeometrySuggestionPanel } from '@/components/causality/GeometrySuggestionPanel';
import { PrintPlaybackProvider, PlaybackUpdater } from '@/components/playback/PrintPlaybackContext';
import { CognitiveScan } from '@/components/3D/CognitiveScan';
import { AttentionPulse } from '@/components/3D/AttentionPulse';
import { toast } from 'sonner';

function deriveWtStatus(
  thinWallRatio: number | undefined,
  p5Thickness?: number | null,
): 'good' | 'warning' | 'critical' {
  const twr = thinWallRatio ?? 0;
  if (twr > 0.15) return 'critical';
  if (twr > 0.05) return 'warning';
  if (p5Thickness != null && p5Thickness < 0.4) return 'warning';
  return 'good';
}

function deriveOhStatus(faceCount: number | undefined, totalTriangles: number | undefined): 'good' | 'warning' | 'critical' {
  if (!faceCount || faceCount === 0) return 'good';
  const ratio = totalTriangles && totalTriangles > 0 ? faceCount / totalTriangles : 0;
  if (ratio > 0.3) return 'critical';
  if (ratio > 0.1) return 'warning';
  return 'good';
}

function unifiedToModelData(
  unifiedAnalysis: import('@/analysis').UnifiedAnalysis,
  fileName: string,
): ModelData {
  const metrics = unifiedAnalysis.metrics.result;
  const topology = unifiedAnalysis.topology.result;
  const triCount = topology?.triangleCount ?? 0;
  const volume = metrics?.meshVolumeMm3 ?? metrics?.boundingBoxVolumeMm3 ?? 0;
  const surfaceArea = metrics?.surfaceAreaMm2 ?? 0;
  const oh = metrics?.overhang;
  const dims = metrics?.boundingBoxDimensionsMm ?? { x: 0, y: 0, z: 0 };
  const thinWallRatio = metrics?.thinWallRatio ?? 0;
  const p5Thickness = metrics?.p5WallThicknessMm;
  const minWall = metrics?.minWallThicknessMm;
  const wtStatus = deriveWtStatus(thinWallRatio, p5Thickness);
  const wtAreas = Math.floor(triCount * 0.15);

  return {
    fileName,
    wallThickness: {
      minThickness: p5Thickness ?? metrics?.avgWallThicknessMm ?? metrics?.medianWallThicknessMm ?? minWall ?? Math.min(dims.x, dims.y, dims.z) * 0.5,
      p1Thickness: metrics?.p1WallThicknessMm ?? null,
      p5Thickness: metrics?.p5WallThicknessMm ?? null,
      p10Thickness: metrics?.p10WallThicknessMm ?? null,
      medianThickness: metrics?.medianWallThicknessMm ?? null,
      avgThickness: metrics?.avgWallThicknessMm ?? null,
      thinWallCount: metrics?.thinWallCount ?? 0,
      thinWallPercentage: metrics?.thinWallPercentage ?? 0,
      thinWallRatio: metrics?.thinWallRatio ?? 0,
      averageConfidence: metrics?.averageConfidence ?? 0,
      lowConfidenceSampleCount: metrics?.lowConfidenceSampleCount ?? 0,
      areas: wtAreas,
      status: wtStatus,
    },
    overhang: {
      angle: 45,
      areas: oh?.faceCount ?? 0,
      status: deriveOhStatus(oh?.faceCount, triCount),
    },
    volume,
    surfaceArea,
    dims,
  };
}

function unifiedToAnalysisSummary(unifiedAnalysis: import('@/analysis').UnifiedAnalysis) {
  const metrics = unifiedAnalysis.metrics.result;
  const topology = unifiedAnalysis.topology.result;
  const oh = metrics?.overhang;
  const dims = metrics?.boundingBoxDimensionsMm ?? { x: 0, y: 0, z: 0 };
  const thinWallRatio = metrics?.thinWallRatio ?? 0;
  const p5Thickness = metrics?.p5WallThicknessMm;
  const minWall = metrics?.minWallThicknessMm;
  const triCount = topology?.triangleCount ?? 0;

  return {
    wallThickness: {
      minThickness: p5Thickness ?? metrics?.avgWallThicknessMm ?? metrics?.medianWallThicknessMm ?? minWall ?? Math.min(dims.x, dims.y, dims.z) * 0.5,
      p1Thickness: metrics?.p1WallThicknessMm ?? null,
      p5Thickness: metrics?.p5WallThicknessMm ?? null,
      p10Thickness: metrics?.p10WallThicknessMm ?? null,
      medianThickness: metrics?.medianWallThicknessMm ?? null,
      avgThickness: metrics?.avgWallThicknessMm ?? null,
      thinWallCount: metrics?.thinWallCount ?? 0,
      thinWallPercentage: metrics?.thinWallPercentage ?? 0,
      thinWallRatio: metrics?.thinWallRatio ?? 0,
      averageConfidence: metrics?.averageConfidence ?? 0,
      lowConfidenceSampleCount: metrics?.lowConfidenceSampleCount ?? 0,
      status: deriveWtStatus(thinWallRatio, p5Thickness),
    },
    overhang: {
      areas: oh?.faceCount ?? 0,
      status: deriveOhStatus(oh?.faceCount, triCount),
    },
    volume: metrics?.meshVolumeMm3 ?? metrics?.boundingBoxVolumeMm3 ?? 0,
    surfaceArea: metrics?.surfaceAreaMm2 ?? 0,
  };
}

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

function StatusChip({ status, label }: { status: 'good' | 'warning' | 'critical'; label: string }) {
  const cfg = {
    good:     { cls: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5' },
    warning:  { cls: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5' },
    critical: { cls: 'text-red-400 border-red-400/30 bg-red-400/5' },
  }[status];
  return <span className={`text-xs font-mono px-2 py-0.5 border rounded-sm ${cfg.cls}`}>{label}</span>;
}

// ─── Home ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [mode, setMode] = useState<'analyze' | 'cad'>('analyze');
  const [language, setLanguage] = useState<Language>('en');
  const [uploadedModel, setUploadedModel] = useState<UploadedModel | null>(null);
  const [tab, setTab] = useState<'geometry' | 'report' | 'chat' | 'agents' | 'causality'>('geometry');
  const [showAPIModal, setShowAPIModal] = useState(false);
  const [quickReport, setQuickReport] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [agentRun, setAgentRun] = useState<AgentRunSummary | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showGhosts, setShowGhosts] = useState(false);
  const [showRisks, setShowRisks] = useState(false);
  const [showPrintPath, setShowPrintPath] = useState(false);
  const [showLayerReveal, setShowLayerReveal] = useState(false);
  const [showFailure, setShowFailure] = useState(false);
  const [showThermal, setShowThermal] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(0.7);
  const orchestratorRef = useRef<AgentOrchestrator | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  if (!orchestratorRef.current) {
    orchestratorRef.current = new AgentOrchestrator();
  }

  const handleModelLoaded = (model: UploadedModel) => {
    setUploadedModel(model);
    setTab('geometry');
    setQuickReport('');
    setAgentRun(null);
    setShowHeatmap(false);
    setShowGhosts(false);
    setShowRisks(false);
    setShowPrintPath(false);
    setShowLayerReveal(false);
    setShowFailure(false);
    setShowThermal(false);
    setSelectedEventId(null);
    setSelectedPatternId(null);
    setSelectedSuggestionId(null);
    setOverlayOpacity(0.7);
    toast.success(t('stlParsed') + model.fileName);
    runAgentAnalysis(model);
  };

  const runAgentAnalysis = async (model: UploadedModel) => {
    if (!orchestratorRef.current) return;
    setAgentLoading(true);
    try {
      const summary = await orchestratorRef.current.runFullAnalysis(
        model.geometry,
        model.unifiedAnalysis,
        model.fileName,
        undefined,
        language,
      );
      setAgentRun(summary);
    } catch (err) {
      console.error('Agent analysis failed:', err);
    } finally {
      setAgentLoading(false);
    }
  };

  const getModelData = (): ModelData | null => {
    if (!uploadedModel) return null;
    return unifiedToModelData(uploadedModel.unifiedAnalysis, uploadedModel.fileName);
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

  const unifiedAnalysis = uploadedModel?.unifiedAnalysis;
  const analysis = unifiedAnalysis ? unifiedToAnalysisSummary(unifiedAnalysis) : null;
  const modelData = getModelData();
  const providerLabel = getActiveProvider() ? AI_PROVIDER_METADATA[getActiveProvider()!].shortLabel : null;
  const t = (key: keyof typeof import('@/lib/i18n').translations.en) => getTranslation(language, key);
  const agentMarkers = agentRun?.results.flatMap(r => r.markers ?? []) ?? [];
  const causalityGraph = useMemo(() => agentMarkers.length > 0 ? buildCausalityGraph(agentMarkers) : null, [agentMarkers]);
  const patternMatches: PatternMatch[] = useMemo(() =>
    agentMarkers.length > 0 ? detectPatterns(agentMarkers) : [],
    [agentMarkers],
  );

  const counterfactualSuggestions: GeometrySuggestion[] = useMemo(() =>
    agentMarkers.length > 0 ? evaluateCounterfactuals(agentMarkers, patternMatches) : [],
    [agentMarkers, patternMatches],
  );

  const selectedSuggestionPositions = useMemo(() => {
    if (!selectedSuggestionId) return [];
    const sug = counterfactualSuggestions.find(s => s.id === selectedSuggestionId);
    return sug ? sug.affectedPositions : [];
  }, [selectedSuggestionId, counterfactualSuggestions]);

  const selectedPatternPositions = useMemo(() => {
    if (!selectedPatternId) return [];
    const match = patternMatches.find((_, i) => `${patternMatches[i].pattern.id}-${i}` === selectedPatternId);
    return match ? match.clusterPositions : [];
  }, [selectedPatternId, patternMatches]);

  const selectedEventPositions = useMemo(() => {
    if (!causalityGraph || !selectedEventId) return [];
    const ev = causalityGraph.events.find((e: { id: string }) => e.id === selectedEventId);
    return ev ? ev.positions : [];
  }, [selectedEventId, causalityGraph]);
  const optSuggestions = agentRun?.results
    .filter(r => r.agentId === 'optimization_advisor')
    .flatMap(r => (r.details?.suggestions ?? []) as Array<{ type: string; priority: string }>) ?? [];

  const totalLayers = useMemo(() => {
    if (!uploadedModel?.geometry) return 50;
    const geo = uploadedModel.geometry;
    geo.computeBoundingBox();
    const height = (geo.boundingBox?.max.y ?? 5) - (geo.boundingBox?.min.y ?? 0);
    return Math.max(10, Math.min(200, Math.round(height / 0.2)));
  }, [uploadedModel?.geometry]);

  return (
    <PrintPlaybackProvider totalLayers={totalLayers}>
    <div className="relative w-full min-h-screen bg-background grid-bg overflow-x-hidden">
      {showAPIModal && <APIKeyModal onClose={() => setShowAPIModal(false)} language={language} />}

      {/* ── Header ── */}
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-5 py-3 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
          <span className="text-sm font-mono text-primary tracking-widest">3DP AGENT</span>
          <span className="text-xs text-muted-foreground/50 hidden sm:block">v2.0 // {mode === 'analyze' ? 'STL Analysis' : 'CAD Studio'}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center gap-1">
            {(['analyze', 'cad'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`text-xs font-mono px-3 py-1 border rounded-sm transition-all ${
                  mode === m ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-primary'
                }`}>
                {m === 'analyze' ? 'ANALYZE' : 'CAD STUDIO'}
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
            {providerLabel ? `${t('api')}: ${providerLabel}` : t('apiKeys')}
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      {mode === 'cad' ? <CADWorkspace language={language} /> : <div className="pt-14 flex flex-col lg:flex-row min-h-screen">

        {/* Left: 3D Viewport */}
        <div className="lg:w-1/2 h-[45vh] lg:h-[calc(100vh-3.5rem)] lg:sticky lg:top-14 border-b lg:border-b-0 lg:border-r border-border relative">
          <div className="absolute top-3 left-4 z-10 font-mono text-xs text-muted-foreground/40 space-y-0.5 hidden lg:block">
            <div>// {t('viewport')}</div>
            <div>// {t('viewportHint')}</div>
          </div>
          <Canvas gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}>
            <PerspectiveCamera makeDefault position={[0, 3, 10]} fov={60} />
            <SceneContent model={uploadedModel} />
            <PlaybackUpdater />
            {uploadedModel?.geometry && <CognitiveScan geometry={uploadedModel.geometry} visible />}
            {uploadedModel?.geometry && agentMarkers.length > 0 && (
              <AttentionPulse markers={agentMarkers} geometry={uploadedModel.geometry} visible />
            )}
            {uploadedModel?.geometry && showHeatmap && (
              <OverhangHeatmap geometry={uploadedModel.geometry} visible opacity={overlayOpacity} />
            )}
            {uploadedModel?.geometry && (
              <SupportGhosts markers={agentMarkers} visible={showGhosts} opacity={overlayOpacity} />
            )}
            {uploadedModel?.geometry && (
              <RiskAnimation markers={agentMarkers} visible={showRisks} />
            )}
            {uploadedModel?.geometry && showPrintPath && (
              <PrintPathPreview geometry={uploadedModel.geometry} visible opacity={overlayOpacity} />
            )}
            {uploadedModel?.geometry && showLayerReveal && (
              <LayerReveal geometry={uploadedModel.geometry} visible opacity={overlayOpacity} />
            )}
            {uploadedModel?.geometry && showFailure && (
              <FailureEmergence markers={agentMarkers} geometry={uploadedModel.geometry} visible />
            )}
            {uploadedModel?.geometry && showThermal && (
              <ThermalField markers={agentMarkers} geometry={uploadedModel.geometry} visible />
            )}
            {(selectedEventPositions.length > 0 || selectedPatternPositions.length > 0 || selectedSuggestionPositions.length > 0) && (
              <CausalityHighlight
                positions={
                  selectedEventPositions.length > 0 ? selectedEventPositions
                  : selectedPatternPositions.length > 0 ? selectedPatternPositions
                  : selectedSuggestionPositions
                }
                visible
              />
            )}
            <OrbitControls enablePan={false} autoRotate={!uploadedModel} autoRotateSpeed={0.4} />
          </Canvas>
          {uploadedModel && (
            <div className="hidden lg:block">
              <ManufacturingTimeline graph={causalityGraph} selectedId={selectedEventId} onSelect={setSelectedEventId} />
            </div>
          )}
          {uploadedModel && (
            <div className="absolute bottom-3 left-4 text-xs font-mono text-muted-foreground/30">
              {uploadedModel.fileName}
            </div>
          )}
          {uploadedModel && (
            <VisualizationToolbar
              showHeatmap={showHeatmap}
              showGhosts={showGhosts}
              showRisks={showRisks}
              showPrintPath={showPrintPath}
              showLayerReveal={showLayerReveal}
              showFailure={showFailure}
              showThermal={showThermal}
              overlayOpacity={overlayOpacity}
              onToggleHeatmap={() => setShowHeatmap(v => !v)}
              onToggleGhosts={() => setShowGhosts(v => !v)}
              onToggleRisks={() => setShowRisks(v => !v)}
              onTogglePrintPath={() => setShowPrintPath(v => !v)}
              onToggleLayerReveal={() => setShowLayerReveal(v => !v)}
              onToggleFailure={() => setShowFailure(v => !v)}
              onToggleThermal={() => setShowThermal(v => !v)}
              onOpacityChange={setOverlayOpacity}
            />
          )}
        </div>

        {/* Right: Panel */}
        <div className="lg:w-1/2 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto">
          <div className="p-5 space-y-5">

            {/* Upload */}
            <div>
              <div className="text-xs text-muted-foreground/50 mb-2 font-mono tracking-widest">// {t('input')}</div>
              <STLUploadHandler onModelLoaded={handleModelLoaded} onError={e => toast.error(e)} language={language} />
            </div>

            {/* Analysis tabs */}
            {analysis && modelData && (
              <div className="space-y-0 fade-up">
                {/* Tabs */}
                <div className="flex border-b border-border">
                  {(['geometry', 'report', 'agents', 'chat', 'causality'] as const).map(tabKey => (
                    <button key={tabKey} onClick={() => setTab(tabKey)}
                      className={`text-xs font-mono px-4 py-2.5 border-b-2 transition-all ${
                        tab === tabKey ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}>
                      {tabKey === 'geometry' ? t('geometry').toUpperCase()
                        : tabKey === 'report' ? t('report').toUpperCase()
                        : tabKey === 'agents' ? 'AGENTS'
                        : tabKey === 'causality' ? 'CAUSALITY'
                        : t('chatAI').toUpperCase()}
                    </button>
                  ))}
                </div>

                {/* GEOMETRY TAB */}
                {tab === 'geometry' && (
                  <div className="space-y-4 pt-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 border border-border rounded-sm bg-card">
                        <div className="text-xs text-muted-foreground mb-2 font-mono">{t('wallThicknessLabel')}</div>
                        <StatusChip status={analysis.wallThickness.status} label={t(analysis.wallThickness.status)} />
                      </div>
                      <div className="p-3 border border-border rounded-sm bg-card">
                        <div className="text-xs text-muted-foreground mb-2 font-mono">{t('overhangLabel')}</div>
                        <StatusChip status={analysis.overhang.status} label={t(analysis.overhang.status)} />
                      </div>
                    </div>
                    <div className="border border-border rounded-sm bg-card p-4">
                      <div className="text-xs text-muted-foreground mb-3 font-mono tracking-widest">GEOMETRY DATA</div>
                      <MetricRow label={t('minThickness')} value={analysis.wallThickness.minThickness.toFixed(3)} unit="mm" highlight />
                      {unifiedAnalysis?.metrics.result?.minWallThicknessMm != null && (
                        <MetricRow label="Min (abs)" value={unifiedAnalysis.metrics.result.minWallThicknessMm.toFixed(3)} unit="mm" />
                      )}
                      <MetricRow label={t('volume')} value={analysis.volume.toFixed(1)} unit="mm³" />
                      <MetricRow label={t('surfaceArea')} value={analysis.surfaceArea.toFixed(1)} unit="mm²" />
                      <MetricRow label={t('dimX')} value={modelData.dims.x.toFixed(2)} unit="mm" />
                      <MetricRow label={t('dimY')} value={modelData.dims.y.toFixed(2)} unit="mm" />
                      <MetricRow label={t('dimZ')} value={modelData.dims.z.toFixed(2)} unit="mm" />
                      <MetricRow label={t('overhangFaces')} value={analysis.overhang.areas} />
                    </div>
                    <button onClick={() => setTab('report')}
                      className="w-full py-2.5 text-xs font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all">
                      {t('generateReport')}
                    </button>
                  </div>
                )}

                {/* REPORT TAB */}
                {tab === 'report' && (
                  <div className="pt-4 space-y-4">
                    {!quickReport && (
                      <button onClick={handleGenerateReport} disabled={reportLoading}
                        className="w-full py-3 text-xs font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all disabled:opacity-50">
                        {reportLoading ? '\u258b ' + t('analyze') : t('generateQuickReport')}
                      </button>
                    )}
                    {quickReport && (
                      <div className="border border-border rounded-sm bg-card p-4 fade-up">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-mono text-primary tracking-widest">{t('analysisReport')}</span>
                          <span className="text-xs font-mono text-muted-foreground/40">{t('localEngine')}</span>
                        </div>
                        <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
                          {quickReport}
                        </pre>
                        <button onClick={() => setQuickReport('')}
                          className="mt-4 text-xs font-mono text-muted-foreground hover:text-primary transition-colors">
                          {t('regenerate')}
                        </button>
{unifiedAnalysis && (
  <ReportGenerator
    analysis={unifiedAnalysis}
    fileName={uploadedModel?.fileName ?? "model.stl"}
  />
)}
                      </div>
                    )}
                    <div className="border border-dashed border-border/40 rounded-sm p-4 text-center space-y-2">
                      <div className="text-xs font-mono text-muted-foreground">{t('deepAnalysis')}</div>
                      <div className="text-xs text-muted-foreground/50">{t('deepAnalysisDesc')}</div>
                      <button onClick={() => { setShowAPIModal(true); }}
                        className="text-xs font-mono px-4 py-2 border border-primary/30 text-primary hover:bg-primary/10 rounded-sm transition-all">
                        {hasAnyKey() ? t('switchToChat') : t('configureApiKey')}
                      </button>
                    </div>
                  </div>
                )}

                {/* AGENTS TAB */}
                {tab === 'agents' && (
                  <div className="pt-4 space-y-4">
                    {agentLoading && (
                      <div className="border border-primary/30 rounded-sm p-6 text-center">
                        <div className="text-xs font-mono text-primary animate-pulse mb-2">\u258b MULTI-AGENT ANALYSIS RUNNING</div>
                        <div className="text-xs text-muted-foreground/50">Geometry Analyst \u2022 Printability Scorer \u2022 Failure Predictor \u2022 Optimization Advisor</div>
                        <div className="flex justify-center gap-2 mt-3">
                          {['geometry_analyst', 'printability_scorer', 'failure_predictor', 'optimization_advisor'].map(id => (
                            <div key={id} className="w-2 h-2 bg-primary/40 rounded-full animate-pulse" />
                          ))}
                        </div>
                      </div>
                    )}

                    {agentRun && !agentLoading && (
                      <>
                        {/* Consensus Score */}
                        <div className="border border-border rounded-sm bg-card p-5 text-center">
                          <div className="text-xs font-mono text-muted-foreground mb-2">CONSENSUS SCORE</div>
                          <div className={`text-4xl font-mono font-bold ${
                            agentRun.consensus.verdict === 'pass' ? 'text-emerald-400'
                              : agentRun.consensus.verdict === 'warning' ? 'text-yellow-400'
                              : 'text-red-400'
                          }`}>
                            {agentRun.consensus.overallScore}
                            <span className="text-lg text-muted-foreground/40">/100</span>
                          </div>
                          <div className={`mt-1 text-xs font-mono uppercase ${
                            agentRun.consensus.verdict === 'pass' ? 'text-emerald-400'
                              : agentRun.consensus.verdict === 'warning' ? 'text-yellow-400'
                              : 'text-red-400'
                          }`}>
                            {agentRun.consensus.verdict}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground/50">
                            {agentRun.usedVision && <span className="text-primary">Vision-enhanced</span>}
                            {agentRun.usedVision ? ' \u2022 ' : ''}
                            {agentRun.consensus.agreementDelta < 10 ? 'Strong agreement' : 'Moderate agreement'}
                            {' \u2022 '}{agentRun.totalDurationMs}ms
                          </div>
                        </div>

                        {/* Per-Agent Cards */}
                        {agentRun.results.map(result => (
                          <div key={result.agentId} className="border border-border rounded-sm bg-card p-4">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <span className="text-xs font-mono text-primary">{getAgentLabel(result.agentId)}</span>
                                <span className="ml-2 text-xs text-muted-foreground/50">{getAgentDescription(result.agentId)}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-mono px-2 py-0.5 border rounded-sm ${
                                  result.verdict === 'pass' ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5'
                                    : result.verdict === 'warning' ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5'
                                    : 'text-red-400 border-red-400/30 bg-red-400/5'
                                }`}>{result.verdict}</span>
                                <span className="text-xs font-mono text-muted-foreground">{Math.round(result.score)}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${
                                  result.score >= 70 ? 'bg-emerald-400'
                                    : result.score >= 40 ? 'bg-yellow-400'
                                    : 'bg-red-400'
                                }`} style={{ width: `${result.score}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground/50">{result.durationMs}ms</span>
                            </div>
                            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-32 overflow-y-auto">
                              {result.explanation}
                            </pre>
                          </div>
                        ))}

                        {/* Voting Records */}
                        <details className="border border-border rounded-sm bg-card/50 p-3 cursor-pointer">
                          <summary className="text-xs font-mono text-muted-foreground">Voting & Debate Record</summary>
                          <div className="mt-2 space-y-1">
                            {agentRun.votingRecords.map(record => (
                              <div key={record.agentId} className="flex justify-between text-xs font-mono text-muted-foreground/70">
                                <span>{getAgentLabel(record.agentId)}</span>
                                <span>weight: {(record.weight * 100).toFixed(0)}% | score: {Math.round(record.adjustedScore)} | confidence: {(record.confidence * 100).toFixed(0)}%</span>
                              </div>
                            ))}
                          </div>
                        </details>

                        {/* Optimize Button */}
                        {uploadedModel && agentRun.results.some(r => r.agentId === 'optimization_advisor') && (
                          <OptimizeButton
                            geometry={uploadedModel.geometry}
                            suggestions={optSuggestions}
                            markers={agentMarkers}
                            originalFileName={uploadedModel.fileName}
                          />
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* CAUSALITY TAB */}
                {tab === 'causality' && (
                  <div className="pt-4 space-y-4">
                    <CausalityPanel graph={causalityGraph} selectedId={selectedEventId} onSelect={setSelectedEventId} />
                    <div className="border-t border-border/20 my-2" />
                    {patternMatches.length > 0 && (
                      <PatternMemoryPanel
                        matches={patternMatches}
                        selectedPatternId={selectedPatternId}
                        onSelectPattern={setSelectedPatternId}
                      />
                    )}
                    <div className="border-t border-border/20 my-2" />
                    <GeometrySuggestionPanel
                      suggestions={counterfactualSuggestions}
                      selectedSuggestionId={selectedSuggestionId}
                      onSelectSuggestion={setSelectedSuggestionId}
                    />
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
                  <div className="text-xs text-muted-foreground/50 font-mono">{t('uploadStlBegin')}</div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground/40 font-mono tracking-widest">// FEATURES</div>
                  {[
                    [t('featureFree'), t('feature1')],
                    [t('featureFree'), t('feature2')],
                    [t('featureFree'), t('feature3')],
                    [t('featureAiKey'), t('feature4')],
                    [t('featureAiKey'), t('feature5')],
                  ].map(([badge, desc]) => (
                    <div key={desc} className="flex items-center gap-3 p-2.5 border border-border/20 rounded-sm hover:border-border/50 transition-all">
                      <span className={`text-xs font-mono px-1.5 py-0.5 rounded-sm border shrink-0 ${
                        badge === t('featureFree') ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5' : 'text-primary border-primary/30 bg-primary/5'
                      }`}>{badge}</span>
                      <span className="text-xs text-muted-foreground">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-border/30 text-xs text-muted-foreground/20 font-mono text-center">
              3DP AGENT \u00a9 2026 \u2014 Open Source
            </div>
          </div>
        </div>
      </div>}
    </div>
    </PrintPlaybackProvider>
  );
}
