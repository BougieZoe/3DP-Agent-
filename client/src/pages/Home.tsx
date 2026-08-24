import { useMaterial, type MaterialName } from "@/contexts/MaterialContext";
import { MATERIALS, defaultMaterialKeyFor, type Material } from "@shared/domain/material";
import { ReportGenerator } from "@/components/ReportGenerator";
import { ExpertReviewPanel } from '@/components/ExpertReviewPanel';
import { BatchReport } from '@/components/BatchReport';
import { ProductionCard } from '@/components/ProductionCard';
import { DiagnosisPanel } from '@/components/DiagnosisPanel';
import { DiagnosisModal } from '@/components/DiagnosisModal';
import { lazy, Suspense, useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { STLUploadHandler, UploadedModel } from '@/components/STLUploadHandler';
import { PRINT_TECHNOLOGIES, PRINT_TECH_BY_ID, type PrintTechnology } from '@/lib/technologies';
import { APIKeyModal } from '@/components/APIKeyModal';

// Heavy alternate modes / tab panels — dynamic imports keep the initial
// bundle lean on mobile. Each wraps a named export into a default for React.lazy.
const CADWorkspace = lazy(() => import('@/components/CADWorkspace').then(m => ({ default: m.CADWorkspace })));
const MeshStudio = lazy(() => import('@/components/MeshStudio').then(m => ({ default: m.MeshStudio })));
const ChatPanel = lazy(() => import('@/components/ChatPanel').then(m => ({ default: m.ChatPanel })));
import { AccountModal } from '@/components/AccountModal';
import { PrivacyModal } from '@/components/PrivacyModal';
import { InstallButton } from '@/components/InstallButton';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useMobile';
import { generateQuickReport, ModelData } from '@/lib/ruleEngine';
import { deriveOhStatus, deriveWtStatus } from '@/analysis/metrics';
import { fromThreeBufferGeometry, runAnalysisInWorker, assessContext, liquidCoolingFromUnified, productionFromUnified, type ObjectContext } from '@/analysis';
import { normalizeModelGeometry, fitCameraToGeometry } from '@/lib/modelNormalization';
import { createMeshFromGeometry } from '@/lib/stlLoader';
import { parseSTL } from '@/lib/stlParser';
import { processMesh } from '@/lib/meshProcessClient';
import { geometryToStl } from '@/lib/meshOps';
import { geometryToThreeMf } from '@/lib/threeMf';
import { LENGTH_UNIT_TO_MM, type LengthUnit } from '@shared/domain/geometry';
import { CONTENT, translate, SUPPORTED_LANGUAGES } from '@shared/i18n/content';
import { getActiveProvider, hasAnyKey } from '@/lib/apiKeys';
import { isWallConfidenceTrusted } from '@/lib/lowConfidence';
import { Language, getTranslation } from '@/lib/i18n';
import { AI_PROVIDER_METADATA } from '@shared/domain/providers';
import { AgentOrchestrator, AgentRunSummary, getAgentLabel, getAgentDescription, runDeepAnalysis } from '@/agents';
import type { AgentId } from '@shared/domain/agent';
import { OverhangHeatmap } from '@/components/3D/OverhangHeatmap';
import { SupportGhosts } from '@/components/3D/SupportGhosts';
import { RiskAnimation } from '@/components/3D/RiskAnimation';
import { VisualizationToolbar } from '@/components/3D/VisualizationToolbar';
import { OptimizeButton } from '@/components/3D/OptimizeButton';
import { PrintPathPreview } from '@/components/3D/PrintPathPreview';
import { LayerReveal } from '@/components/3D/LayerReveal';
import { FailureEmergence } from '@/components/3D/FailureEmergence';
import { ThermalField } from '@/components/3D/ThermalField';
import { WallThicknessHeatmap } from '@/components/3D/WallThicknessHeatmap';
import { CausalityHighlight } from '@/components/3D/CausalityHighlight';
import { deriveSupportStatus } from '@/analysis/metrics';
import { buildCausalityGraph, CausalityGraph } from '@/components/causality/causalityEngine';
import { ManufacturingTimeline } from '@/components/causality/ManufacturingTimeline';
import { detectPatterns, PatternMatch } from '@/components/causality/topologyPatternEngine';
import { evaluateCounterfactuals, GeometrySuggestion } from '@/components/causality/counterfactualEngine';
import { PrintPlaybackProvider, PlaybackUpdater } from '@/components/playback/PrintPlaybackContext';

// Causality panels render only in the causality tab — lazy so the engines
// (eager, they feed the viewport highlights) don't drag the panel UI into the
// initial bundle.
const CausalityPanel = lazy(() => import('@/components/causality/CausalityPanel').then(m => ({ default: m.CausalityPanel })));
const PatternMemoryPanel = lazy(() => import('@/components/causality/PatternMemoryPanel').then(m => ({ default: m.PatternMemoryPanel })));
const GeometrySuggestionPanel = lazy(() => import('@/components/causality/GeometrySuggestionPanel').then(m => ({ default: m.GeometrySuggestionPanel })));
import { CognitiveScan } from '@/components/3D/CognitiveScan';
import { AttentionPulse } from '@/components/3D/AttentionPulse';
import { ViewfinderCorners } from '@/components/decorative/ViewfinderCorners';
import { ScanlineSweep } from '@/components/decorative/ScanlineSweep';
import { BedStatusTicker } from '@/components/decorative/BedStatusTicker';
import { LayerHeightLabel } from '@/components/decorative/LayerHeightLabel';
import { FeaturesSection } from '@/pages/home/FeaturesSection';
import type { FeatureDestination } from '@/pages/home/featuresNavigation';
import { toast } from 'sonner';

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function unifiedToModelData(
  unifiedAnalysis: import('@/analysis').UnifiedAnalysis,
  fileName: string,
  overhangThreshold: number = 50,
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
      minThickness: p5Thickness ?? metrics?.avgWallThicknessMm ?? metrics?.medianWallThicknessMm ?? minWall,
      p1Thickness: metrics?.p1WallThicknessMm ?? null,
      p5Thickness: metrics?.p5WallThicknessMm ?? null,
      p10Thickness: metrics?.p10WallThicknessMm ?? null,
      medianThickness: metrics?.medianWallThicknessMm ?? null,
      avgThickness: metrics?.avgWallThicknessMm ?? null,
      thinWallCount: metrics?.thinWallCount ?? 0,
      thinWallPercentage: metrics?.thinWallPercentage ?? 0,
      thinWallRatio: metrics?.thinWallRatio ?? 0,
      averageConfidence: metrics?.averageConfidence ?? 0,
      areas: wtAreas,
      status: wtStatus,
    },
    overhang: {
      angle: overhangThreshold,
      areas: oh?.faceCount ?? 0,
      status: deriveOhStatus(oh?.ratio ?? 0),
    },
    volume,
    surfaceArea,
    dims,
  };
}

/**
 * Compact geometry facts for the photo-diagnosis model — so it can weigh
 * "the uploaded file already has N bodies by design" against a "broke apart"
 * narrative instead of reasoning from the photo in isolation.
 */
function buildDiagnosisGeometryContext(u: import('@/analysis').UnifiedAnalysis): string {
  const topo = u.topology?.result;
  const val = u.validation?.result;
  const m = u.metrics?.result;
  const dims = m?.boundingBoxDimensionsMm;
  const parts: string[] = [];
  if (topo) parts.push(`${topo.shellCount} body/bodies`);
  if (val) parts.push(val.isWatertight ? 'watertight' : 'not watertight');
  if (dims) parts.push(`size ${dims.x.toFixed(0)}×${dims.y.toFixed(0)}×${dims.z.toFixed(0)} mm`);
  return parts.length ? `Known from the uploaded 3D file: ${parts.join(', ')}.` : '';
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
      minThickness: p5Thickness ?? metrics?.avgWallThicknessMm ?? metrics?.medianWallThicknessMm ?? minWall,
      p1Thickness: metrics?.p1WallThicknessMm ?? null,
      p5Thickness: metrics?.p5WallThicknessMm ?? null,
      p10Thickness: metrics?.p10WallThicknessMm ?? null,
      medianThickness: metrics?.medianWallThicknessMm ?? null,
      avgThickness: metrics?.avgWallThicknessMm ?? null,
      thinWallCount: metrics?.thinWallCount ?? 0,
      thinWallPercentage: metrics?.thinWallPercentage ?? 0,
      thinWallRatio: metrics?.thinWallRatio ?? 0,
      averageConfidence: metrics?.averageConfidence ?? 0,
      status: deriveWtStatus(thinWallRatio, p5Thickness),
    },
    overhang: {
      areas: oh?.faceCount ?? 0,
      status: deriveOhStatus(oh?.ratio ?? 0),
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

  return <mesh geometry={model.geometry} material={mat} />;
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

/**
 * Auto-fits the camera + OrbitControls target to the current model whenever
 * its geometry changes (model load OR unit change). Recomputes the bounding
 * box / sphere defensively so a stale bbox can never leave the model
 * off-center or out of frame.
 */
function ViewportCameraFit({ geometry, controlsRef }: {
  geometry: THREE.BufferGeometry | null;
  controlsRef: { current: { target: THREE.Vector3; update: () => void } | null };
}) {
  const { camera } = useThree();

  useEffect(() => {
    if (!geometry) return;
    // Defer one frame so the mesh is mounted and the controls exist.
    const raf = requestAnimationFrame(() => {
      fitCameraToGeometry(camera, controlsRef.current, geometry);
    });
    return () => cancelAnimationFrame(raf);
  }, [geometry, camera, controlsRef]);

  return null;
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

/**
 * TECHNOLOGY + MATERIAL explainer panels — the rigorous, self-describing
 * classification. Rendered wherever the selection is visible (empty state AND
 * the geometry tab) so a user always sees what they picked and what it means.
 */
// ─── Home ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const { material, materialName, setMaterialName } = useMaterial();
  const [materialFamily, setMaterialFamily] = useState<Material['technology']>('fdm');
  const [objectContext, setObjectContext] = useState<ObjectContext>('general');
  const [mode, setMode] = useState<'analyze' | 'cad' | 'mesh'>('analyze');
  const [language, setLanguage] = useState<Language>('en');
  const [uploadedModel, setUploadedModel] = useState<UploadedModel | null>(null);
  const [tab, setTab] = useState<'geometry' | 'report' | 'chat' | 'agents' | 'causality'>('geometry');
  const [showAPIModal, setShowAPIModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showDiagnosis, setShowDiagnosis] = useState(false);
  // Multi-file: the full set of loaded models + which one is active. The active
  // model is still `uploadedModel` — switching just swaps it in.
  const [models, setModels] = useState<UploadedModel[]>([]);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [quickReport, setQuickReport] = useState('');
  const [agentRun, setAgentRun] = useState<AgentRunSummary | null>(null);
  const [deepAgentRun, setDeepAgentRun] = useState<AgentRunSummary | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [deepAnalysisLoading, setDeepAnalysisLoading] = useState(false);
  const [deepSteps, setDeepSteps] = useState<Array<{ index: number; label: string; raw: string }>>([]);
  const [deepError, setDeepError] = useState<string | null>(null);
  const [expertReview, setExpertReview] = useState<import('@/agents').ExpertReview | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showGhosts, setShowGhosts] = useState(false);
  const [showRisks, setShowRisks] = useState(false);
  const [showPrintPath, setShowPrintPath] = useState(false);
  const [showLayerReveal, setShowLayerReveal] = useState(false);
  const [showFailure, setShowFailure] = useState(false);
  const [showThermal, setShowThermal] = useState(false);
  const [showWallThickness, setShowWallThickness] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(0.7);
  const [materialLoading, setMaterialLoading] = useState(false);
  const materialRequestSeq = useRef(0);
  const [units, setUnits] = useState<LengthUnit>('mm');
  const unitRequestSeq = useRef(0);
  // Shared ref into the drei OrbitControls instance (has .target/.update()).
  const controlsRef = useRef<any>(null);
  const orchestratorRef = useRef<AgentOrchestrator | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const deepAnalysisSeq = useRef(0);

  if (!orchestratorRef.current) {
    orchestratorRef.current = new AgentOrchestrator();
  }

  /** Set the working model and regenerate everything that derives from it. */
  const activateModel = (model: UploadedModel) => {
    setUnits(model.units);
    setActiveFileName(model.fileName);
    setTab('geometry');
    setAgentRun(null);
    deepAnalysisSeq.current += 1;
    setDeepAgentRun(null);
    setExpertReview(null);
    setShowHeatmap(false);
    setShowGhosts(false);
    setShowRisks(false);
    setShowPrintPath(false);
    setShowLayerReveal(false);
    setShowFailure(false);
    setShowThermal(false);
    setShowWallThickness(false);
    setSelectedEventId(null);
    setSelectedPatternId(null);
    setSelectedSuggestionId(null);
    setOverlayOpacity(0.7);
    toast.success(t('stlParsed') + model.fileName);
    runAgentAnalysis(model, material);
    // Auto-compose the report so the REPORT tab reads immediately — no
    // "generate" click needed.
    const md = unifiedToModelData(model.unifiedAnalysis, model.fileName, material.overhangThreshold);
    setQuickReport(generateQuickReport(md, language, material));
    commitModel(model);
  };

  /** Keep models[] and uploadedModel in sync (used after re-analysis too). */
  const commitModel = (updated: UploadedModel) => {
    setUploadedModel(updated);
    setModels((prev) =>
      prev.some((m) => m.fileName === updated.fileName)
        ? prev.map((m) => (m.fileName === updated.fileName ? updated : m))
        : [...prev, updated],
    );
  };

  const handleModelsLoaded = (loaded: UploadedModel[], received: number) => {
    setModels(loaded);
    const first = loaded[0];
    if (first) activateModel(first);
    // Definitive diagnostics when multiple files were passed in:
    //  - no toast when dragging several → the DROP only delivered 1 file
    //  - "Loaded 3 models"        → drop + processing both fine (chips must show)
    //  - "Loaded 1 of 3"          → drop delivered 3 but processing dropped 2
    if (received > 1) {
      if (loaded.length === received) {
        toast.success(t('modelsLoaded').replace('{n}', String(loaded.length)));
      } else {
        toast.error(t('modelsPartial').replace('{a}', String(loaded.length)).replace('{b}', String(received)));
      }
    }
  };

  const switchModel = (name: string) => {
    const target = models.find((m) => m.fileName === name);
    if (target) activateModel(target);
  };

  const runAgentAnalysis = async (model: UploadedModel, mat: Material = material) => {
    if (!orchestratorRef.current) return;
    setAgentLoading(true);
    try {
      // 1) Deterministic rule engine first — instant, free, always available.
      const ruleSummary = await orchestratorRef.current.runFullAnalysis(
        model.geometry,
        model.unifiedAnalysis,
        model.fileName,
        canvasRef.current,
        language,
        mat,
      );
      setAgentRun(ruleSummary);

    } catch (err) {
      console.error('Rule analysis failed:', err);
    } finally {
      setAgentLoading(false);
    }
  };

  // The LLM is a user-requested second opinion. It is intentionally kept
  // separate from deterministic mesh results and can never overwrite them.
  const DEEP_STEP_AGENTS: AgentId[] = ['geometry_analyst', 'failure_predictor', 'optimization_advisor', 'printability_scorer'];

  const runDeepAnalysisIfConfigured = async (model: UploadedModel, mat: Material) => {
    const seq = ++deepAnalysisSeq.current;
    setDeepAnalysisLoading(true);
    setDeepAgentRun(null);
    setDeepSteps([]);
    setDeepError(null);
    const md = unifiedToModelData(model.unifiedAnalysis, model.fileName, mat.overhangThreshold);
    try {
      const result = await runDeepAnalysis(md, language, (step, index) => {
        if (seq !== deepAnalysisSeq.current) return;
        const agentId = DEEP_STEP_AGENTS[index];
        setDeepSteps((prev) => [...prev, {
          index,
          label: agentId ? getAgentLabel(agentId, language as 'en' | 'ja' | 'zh') : t('deepAnalysis'),
          raw: step.raw,
        }]);
      }, mat, (trace) => {
        // Fire-and-forget: persist this step's I/O for fine-tuning data
        // collection (server appends to deploy/amd/agent-traces.jsonl).
        if (seq !== deepAnalysisSeq.current) return;
        fetch('/api/agent-trace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trace),
        }).catch(() => {});
      });
      if (seq !== deepAnalysisSeq.current) return;
      if (result) {
        setDeepAgentRun(result);
      } else {
        setDeepError(t('deepAnalysisError'));
      }
    } catch (err) {
      console.error('Deep LLM analysis failed:', err);
      if (seq === deepAnalysisSeq.current) setDeepError(t('deepAnalysisError'));
    } finally {
      if (seq === deepAnalysisSeq.current) setDeepAnalysisLoading(false);
    }
  };

  const reanalyzeWithMaterial = useCallback(async (newMaterialName: MaterialName) => {
    setMaterialName(newMaterialName);
    if (!uploadedModel) return;
    const newMat = MATERIALS[newMaterialName];

    materialRequestSeq.current += 1;
    const currentSeq = materialRequestSeq.current;

    setMaterialLoading(true);
    setQuickReport('');
    setAgentRun(null);
    deepAnalysisSeq.current += 1;
    setDeepAgentRun(null);

    const model = fromThreeBufferGeometry(uploadedModel.geometry);
    const newUnified = await runAnalysisInWorker(model, { fileName: uploadedModel.fileName, material: newMat });

    if (currentSeq !== materialRequestSeq.current) return;

    const updatedModel: UploadedModel = { ...uploadedModel, unifiedAnalysis: newUnified };
    commitModel(updatedModel);

    if (currentSeq !== materialRequestSeq.current || !orchestratorRef.current) return;
    const summary = await orchestratorRef.current.runFullAnalysis(
      updatedModel.geometry, newUnified, updatedModel.fileName, canvasRef.current, language, newMat,
    );

    if (currentSeq !== materialRequestSeq.current) return;
    setAgentRun(summary);

    const md = unifiedToModelData(newUnified, updatedModel.fileName, newMat.overhangThreshold);
    setQuickReport(generateQuickReport(md, language, newMat));
    setMaterialLoading(false);
  }, [uploadedModel, language, setMaterialName]);

  // Re-run analysis under a different print-technology family (FDM vs resin).
  const reanalyzeWithFamily = useCallback(async (family: Material['technology']) => {
    setMaterialFamily(family);
    setMaterialName(defaultMaterialKeyFor(family)); // switch to that technology's default material (registry key)
    if (!uploadedModel) return;

    materialRequestSeq.current += 1;
    const currentSeq = materialRequestSeq.current;
    setMaterialLoading(true);
    setQuickReport('');
    setAgentRun(null);
    deepAnalysisSeq.current += 1;
    setDeepAgentRun(null);

    const model = fromThreeBufferGeometry(uploadedModel.geometry);
    const newUnified = await runAnalysisInWorker(model, { fileName: uploadedModel.fileName, material: MATERIALS[materialName], materialFamily: family });

    if (currentSeq !== materialRequestSeq.current) return;
    const updatedModel: UploadedModel = { ...uploadedModel, unifiedAnalysis: newUnified };
    commitModel(updatedModel);

    if (currentSeq !== materialRequestSeq.current || !orchestratorRef.current) return;
    const summary = await orchestratorRef.current.runFullAnalysis(
      updatedModel.geometry, newUnified, updatedModel.fileName, canvasRef.current, language, MATERIALS[materialName],
    );
    if (currentSeq !== materialRequestSeq.current) return;
    setAgentRun(summary);
    setMaterialLoading(false);
  }, [uploadedModel, materialName, language]);

  const handleUnitsChange = useCallback(async (newUnits: LengthUnit) => {
    setUnits(newUnits);
    if (!uploadedModel?.rawGeometry) return;

    unitRequestSeq.current += 1;
    const currentSeq = unitRequestSeq.current;

    setAgentRun(null);
    setQuickReport('');
    deepAnalysisSeq.current += 1;
    setDeepAgentRun(null);

    // Re-process the ORIGINAL raw geometry (no stacked scales), re-center on
    // the build plate, recompute bounds, then re-run the analysis pipeline.
    const { geometry } = normalizeModelGeometry(uploadedModel.rawGeometry, newUnits);
    const geometryModel = fromThreeBufferGeometry(geometry);
    const newUnified = await runAnalysisInWorker(geometryModel, { fileName: uploadedModel.fileName, material });

    if (currentSeq !== unitRequestSeq.current) return;

    const mesh = createMeshFromGeometry(geometry);
    const updatedModel: UploadedModel = { ...uploadedModel, geometry, mesh, unifiedAnalysis: newUnified, units: newUnits };
    commitModel(updatedModel);

    if (currentSeq !== unitRequestSeq.current || !orchestratorRef.current) return;
    try {
      const summary = await orchestratorRef.current.runFullAnalysis(
        updatedModel.geometry, newUnified, updatedModel.fileName, canvasRef.current, language, material,
      );
      if (currentSeq !== unitRequestSeq.current) return;
      setAgentRun(summary);
    } catch (err) {
      console.error('Agent analysis failed:', err);
    }

    if (currentSeq !== unitRequestSeq.current) return;
    const md = unifiedToModelData(newUnified, updatedModel.fileName, material.overhangThreshold);
    setQuickReport(generateQuickReport(md, language, material));
  }, [uploadedModel, material, language]);

  const getModelData = (): ModelData | null => {
    if (!uploadedModel) return null;
    return unifiedToModelData(uploadedModel.unifiedAnalysis, uploadedModel.fileName, material.overhangThreshold);
  };

  // Repair & process the uploaded mesh via the shared /api/mesh/process endpoint
  // (diagnostics, best-effort watertight repair, place on plate), then re-run
  // the analysis so the report reflects the processed model.
  const [repairing, setRepairing] = useState(false);
  const handleRepairProcess = useCallback(async () => {
    if (!uploadedModel) return;
    setRepairing(true);
    try {
      const result = await processMesh(geometryToStl(uploadedModel.geometry), {});
      const processed = parseSTL(result.stlBytes);
      processed.computeVertexNormals();
      processed.computeBoundingBox();
      const newUnified = await runAnalysisInWorker(fromThreeBufferGeometry(processed), {
        fileName: uploadedModel.fileName,
        material,
      });
      commitModel({
        ...uploadedModel,
        geometry: processed,
        mesh: createMeshFromGeometry(processed),
        unifiedAnalysis: newUnified,
        rawGeometry: processed.clone(),
      });
deepAnalysisSeq.current += 1;
    setDeepAgentRun(null);
    setDeepSteps([]);
    setDeepError(null);
      const d = result.diagnostics;
      toast.success(
        d.repaired
          ? `repaired to watertight · ${d.bodyCount ?? 1} bodies`
          : d.watertight
            ? `mesh OK · ${d.bodyCount ?? 1} bodies`
            : 'processed · repair unavailable',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRepairing(false);
    }
  }, [uploadedModel, material]);

  const handleDownloadStl = () => {
    if (!uploadedModel) return;
    downloadBlob(
      `${uploadedModel.fileName.replace(/\.stl$/i, '')}_processed.stl`,
      new Blob([geometryToStl(uploadedModel.geometry)], { type: 'model/stl' }),
    );
  };
  const handleDownload3mf = () => {
    if (!uploadedModel) return;
    downloadBlob(
      `${uploadedModel.fileName.replace(/\.stl$/i, '')}_processed.3mf`,
      new Blob([geometryToThreeMf(uploadedModel.geometry)], {
        type: 'application/vnd.ms-package.3dmanufacturing-3dmodel',
      }),
    );
  };

  // Feature-section navigation. Destinations come from FEATURE_DESTINATIONS
  // (FeaturesSection); this handler resolves them against current state.
  const handleFeatureNavigate = useCallback((dest: FeatureDestination) => {
    if (dest.needsModel && !uploadedModel) {
      // No model loaded — tactile feedback only, no navigation.
      return;
    }
    if (dest.requiresKey && !user) {
      setShowAccountModal(true);
      return;
    }
    if (dest.modal === 'diagnose') {
      setShowDiagnosis(true);
      return;
    }
    if (dest.tab) setTab(dest.tab);
  }, [uploadedModel, user]);

  // Re-generate the rule-based quick report in the current language whenever the
  // language switches (instant, client-side). LLM-generated prose (agent run,
  // chat) stays in the language it was generated in.
  useEffect(() => {
    if (!uploadedModel || !quickReport) return;
    const md = getModelData();
    if (md) setQuickReport(generateQuickReport(md, language, material));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const unifiedAnalysis = uploadedModel?.unifiedAnalysis;
  const analysis = unifiedAnalysis ? unifiedToAnalysisSummary(unifiedAnalysis) : null;
  const topo = unifiedAnalysis?.topology.result;
  const valid = unifiedAnalysis?.validation.result;
  const modelData = getModelData();
  const providerLabel = getActiveProvider() ? AI_PROVIDER_METADATA[getActiveProvider()!].shortLabel : null;
  const t = (key: keyof typeof import('@/lib/i18n').translations.en) => getTranslation(language, key);
  // Metric display in the selected unit (analysis is always computed in mm).
  const mmPerUnit = LENGTH_UNIT_TO_MM[units];
  const unitSuffix = units === 'inch' ? 'in' : units;
  const volumeUnit = `${unitSuffix}³`; // cubic — volume is length³ (cm³ / in³)
  const areaUnit = `${unitSuffix}²`;   // square — area is length² (cm² / in²)
  const toUnit = (mm: number) => mm / mmPerUnit;
  const toUnit2 = (mm2: number) => mm2 / (mmPerUnit ** 2);
  const toUnit3 = (mm3: number) => mm3 / (mmPerUnit ** 3);
  const agentMarkers = agentRun?.results.flatMap(r => r.markers ?? []) ?? [];
  const supportDecision = unifiedAnalysis?.support?.result
    ? deriveSupportStatus(unifiedAnalysis.support.result)
    : null;
  const causalityGraph = useMemo(() => agentMarkers.length > 0
    ? buildCausalityGraph(agentMarkers, supportDecision?.status, language)
    : null, [agentMarkers, supportDecision?.status, language]);
  const patternMatches: PatternMatch[] = useMemo(() =>
    agentMarkers.length > 0 ? detectPatterns(agentMarkers, language) : [],
    [agentMarkers, language],
  );

  const counterfactualSuggestions: GeometrySuggestion[] = useMemo(() =>
    agentMarkers.length > 0 ? evaluateCounterfactuals(agentMarkers, patternMatches, language) : [],
    [agentMarkers, patternMatches, language],
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
      {showAccountModal && <AccountModal language={language} onClose={() => setShowAccountModal(false)} />}
      {showPrivacy && <PrivacyModal language={language} onClose={() => setShowPrivacy(false)} />}
      {showDiagnosis && (
        <DiagnosisModal
          language={language}
          canRun={!!user || hasAnyKey()}
          onNeedAuth={() => setShowAccountModal(true)}
          materialContext={`${material.name} (${material.technology.toUpperCase()})`}
          geometryContext={unifiedAnalysis ? buildDiagnosisGeometryContext(unifiedAnalysis) : undefined}
          onClose={() => setShowDiagnosis(false)}
        />
      )}

      {/* ── Header ── */}
      <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
          <span className="text-sm font-mono text-primary tracking-widest">3DP AGENT</span>
        </div>
        {/* Right controls. On narrow screens flex-wrap drops the trailing language +
            API controls onto a second row automatically (desktop stays one row). */}
        <div className="flex items-center justify-end gap-1.5 sm:gap-2 flex-wrap min-w-0">
          {/* Mode toggle */}
          <div className="flex items-center gap-1">
            {(['analyze', 'cad', 'mesh'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`text-[11px] sm:text-xs font-mono px-2 sm:px-3 py-1 border rounded-sm transition-all ${
                  mode === m ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:text-primary'
                }`}>
                {m === 'analyze' ? t('modeAnalyze') : m === 'cad' ? 'CAD' : 'MESH'}
              </button>
            ))}
          </div>
          {/* Print technology — rigorous ASTH process-family classification */}
          <select
            value={materialFamily}
            onChange={(e) => reanalyzeWithFamily(e.target.value as Material['technology'])}
            title={PRINT_TECH_BY_ID[materialFamily as PrintTechnology]?.label}
            className="text-[11px] sm:text-xs font-mono px-1.5 sm:px-2 py-1 border border-border rounded-sm bg-background text-muted-foreground hover:text-primary cursor-pointer"
          >
            {PRINT_TECHNOLOGIES.map(t => (
              <option key={t.id} value={t.id} disabled={!t.implemented} title={`${t.label} · ${t.processFamily} — ${t.description}`}>
                {t.shortLabel}{t.implemented ? '' : ' (soon)'}
              </option>
            ))}
          </select>
          {/* Material — values are registry keys so MATERIALS[name] always resolves;
              hover an option to see the rigorous material description */}
          <select
            value={materialName}
            onChange={(e) => reanalyzeWithMaterial(e.target.value as MaterialName)}
            className="text-[11px] sm:text-xs font-mono px-1.5 sm:px-2 py-1 border border-border rounded-sm bg-background text-muted-foreground hover:text-primary cursor-pointer max-w-[5.5rem] sm:max-w-none"
          >
            {Object.entries(MATERIALS)
              .filter(([, m]) => m.technology === materialFamily)
              .map(([key, m]) => (
                <option key={key} value={key} title={`${m.category} — ${m.description}`}>{m.name}</option>
              ))}
          </select>
          {/* Language — dropdown so it scales to more languages without crowding the header */}
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            title="Language"
            className="text-[11px] sm:text-xs font-mono px-1.5 sm:px-2 py-1 border border-border rounded-sm bg-background text-muted-foreground hover:text-primary cursor-pointer"
          >
            {SUPPORTED_LANGUAGES.map(lang => (
              <option key={lang} value={lang}>{lang.toUpperCase()}</option>
            ))}
          </select>
          {/* Install (PWA) — hidden unless installable; Android/desktop native prompt, iOS guide */}
          <InstallButton language={language} />
          {/* Account — sign in / plan badge (signed-in users get hosted LLM) */}
          <button onClick={() => setShowAccountModal(true)}
            className={`text-[11px] sm:text-xs font-mono px-2 sm:px-3 py-1 border rounded-sm transition-all ${
              user ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
            }`}>
            {user ? t('planFree') : t('signIn')}
          </button>
          {/* API config — only for anonymous BYOK users */}
          {!user && (
            <button onClick={() => setShowAPIModal(true)}
              className={`text-[11px] sm:text-xs font-mono px-2 sm:px-3 py-1 border rounded-sm transition-all ${
                hasAnyKey()
                  ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
              }`}>
              {providerLabel ? `${t('api')}: ${providerLabel}` : t('apiKeys')}
            </button>
          )}
        </div>
      </header>

      {/* ── Main ── */}
      <Suspense fallback={
        <div className="flex items-center justify-center h-[60vh] text-xs font-mono text-primary animate-pulse">
          <span>▋ {t('loading3d')}</span>
        </div>
      }>
      {mode === 'cad' ? <CADWorkspace language={language} /> : mode === 'mesh' ? <MeshStudio language={language} /> : <div className="pt-28 sm:pt-14 flex flex-col lg:flex-row min-h-screen">

        {/* Left: 3D Viewport */}
        <div className="lg:w-1/2 h-[45vh] lg:h-[calc(100vh-3.5rem)] lg:sticky lg:top-14 border-b lg:border-b-0 lg:border-r border-border relative">
          <div className="absolute top-3 left-4 z-10 font-mono text-xs text-muted-foreground/40 space-y-0.5 hidden lg:block">
            <div>// {t('viewport')}</div>
            <div>// {t('viewportHint')}</div>
          </div>
          <Canvas
            dpr={[1, isMobile ? 1.5 : 2]}
            gl={{ antialias: !isMobile, alpha: true, preserveDrawingBuffer: true }}
            style={{ background: 'transparent' }}
            onCreated={(state) => { canvasRef.current = state.gl.domElement; }}
          >
            <PerspectiveCamera makeDefault position={[0, 3, 10]} fov={60} />
            <SceneContent model={uploadedModel} />
            <ViewportCameraFit geometry={uploadedModel?.geometry ?? null} controlsRef={controlsRef} />
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
            {uploadedModel?.geometry && showWallThickness && (
              <WallThicknessHeatmap
                geometry={uploadedModel.geometry}
                samples={unifiedAnalysis?.metrics.result?.wallThicknessSamples ?? null}
                visible
                opacity={overlayOpacity}
              />
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
            <OrbitControls ref={controlsRef} enablePan={false} autoRotate={!uploadedModel} autoRotateSpeed={0.4} />
          </Canvas>
          {uploadedModel && (
            <div className="hidden lg:block">
              <ManufacturingTimeline graph={causalityGraph} selectedId={selectedEventId} onSelect={setSelectedEventId} language={language} />
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
              showWallThickness={showWallThickness}
              overlayOpacity={overlayOpacity}
              onToggleHeatmap={() => setShowHeatmap(v => !v)}
              onToggleGhosts={() => setShowGhosts(v => !v)}
              onToggleRisks={() => setShowRisks(v => !v)}
              onTogglePrintPath={() => setShowPrintPath(v => !v)}
              onToggleLayerReveal={() => setShowLayerReveal(v => !v)}
              onToggleFailure={() => setShowFailure(v => !v)}
              onToggleThermal={() => setShowThermal(v => !v)}
              onToggleWallThickness={() => setShowWallThickness(v => !v)}
              onOpacityChange={setOverlayOpacity}
              t={t}
            />
          )}
        </div>

        {/* Right: Panel */}
        <div className="lg:w-1/2 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto">
          <div className="pt-4 px-5 pb-5 space-y-8">

            {/* Upload */}
            <div>
              <div className="text-xs text-muted-foreground/50 mb-2 font-mono tracking-widest">// {t('input')}</div>
              <div className="relative">
                <STLUploadHandler
                  onModelsLoaded={handleModelsLoaded}
                  onError={e => toast.error(e)}
                  language={language}
                  units={units}
                  onUnitsChange={handleUnitsChange}
                  materialFamily={materialFamily}
                />
                {/* Decorative presentation-only touches — remove any one freely */}
                <ViewfinderCorners />
                <ScanlineSweep />
                <BedStatusTicker />
                <LayerHeightLabel />
              </div>
            </div>

            {/* Loaded-model switcher — only appears when more than one file is in */}
            {models.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {models.map((m) => (
                  <button
                    key={m.fileName}
                    onClick={() => switchModel(m.fileName)}
                    title={m.fileName}
                    className={`text-[11px] font-mono px-2 py-1 border rounded-sm transition-all max-w-[11rem] truncate ${
                      activeFileName === m.fileName
                        ? 'border-primary text-primary'
                        : 'border-border text-muted-foreground/60 hover:text-primary'
                    }`}
                  >
                    {m.fileName}
                  </button>
                ))}
              </div>
            )}

            {/* Tab bar — only when a model is loaded; the empty state uses the
                feature cards (diagnosis opens as a modal) instead */}
            {modelData && (
              <div className="flex border-b border-border">
                {(['geometry', 'report', 'agents', 'chat', 'causality'] as const).map(tabKey => (
                  <button key={tabKey} onClick={() => setTab(tabKey)}
                    className={`text-xs font-mono px-4 py-2.5 border-b-2 transition-all ${
                      tab === tabKey ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}>
                    {tabKey === 'geometry' ? t('geometry').toUpperCase()
                      : tabKey === 'report' ? t('report').toUpperCase()
                      : tabKey === 'agents' ? t('agents').toUpperCase()
                      : tabKey === 'causality' ? t('causality').toUpperCase()
                      : t('chatAI').toUpperCase()}
                  </button>
                ))}
              </div>
            )}

            {/* CHAT TAB — photo diagnosis lives here once a model is loaded;
                without a model it opens via the standalone DiagnosisModal */}
            {tab === 'chat' && modelData && (
              <Suspense fallback={<div className="pt-6 text-xs font-mono text-primary animate-pulse">▋ {t('loading3d')}</div>}>
                <div className="pt-4">
                  <DiagnosisPanel
                    language={language}
                    canRun={!!user || hasAnyKey()}
                    onNeedAuth={() => setShowAccountModal(true)}
                    materialContext={`${material.name} (${material.technology.toUpperCase()})`}
                    geometryContext={unifiedAnalysis ? buildDiagnosisGeometryContext(unifiedAnalysis) : undefined}
                  />
                </div>
                {modelData ? (
                  <div className="pt-4 h-[45vh] min-h-[320px] lg:h-[520px]">
                    <ChatPanel
                      model={modelData}
                      language={language}
                      material={material}
                      onNeedAuth={() => setShowAccountModal(true)}
                    />
                  </div>
                ) : (
                  <div className="pt-6 text-center text-xs font-mono text-muted-foreground/40">
                    {t('uploadStlBegin')} — {t('chatNeedsModel')}
                  </div>
                )}
              </Suspense>
            )}

            {/* Model-dependent tabs (need an uploaded + analyzed file) */}
            {analysis && modelData && (
              <div className="space-y-0 fade-up">

                {/* GEOMETRY TAB */}
                {tab === 'geometry' && (
                  <div className="space-y-4 pt-4 relative">
                    {materialLoading && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 rounded-sm">
                        <div className="text-xs font-mono text-primary animate-pulse">&#x258b; {t('recalculating')}</div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 border border-border rounded-sm bg-card">
                        <div className="text-xs text-muted-foreground mb-2 font-mono">{t('wallThicknessLabel')}</div>
                        <StatusChip status={analysis.wallThickness.status} label={t(analysis.wallThickness.status)} />
                      </div>
                      <div className="p-3 border border-border rounded-sm bg-card">
                        <div className="text-xs text-muted-foreground mb-2 font-mono">{t('overhangLabel')}</div>
                        <StatusChip status={analysis.overhang.status} label={t(analysis.overhang.status)} />
                      </div>
                      <div className="p-3 border border-border rounded-sm bg-card">
                        <div className="text-xs text-muted-foreground mb-2 font-mono">{t('cadManifold')}</div>
                        <StatusChip status={topo?.isManifold ? 'good' : 'critical'} label={topo ? (topo.isManifold ? '✓' : '✗') : '—'} />
                      </div>
                      <div className="p-3 border border-border rounded-sm bg-card">
                        <div className="text-xs text-muted-foreground mb-2 font-mono">{t('cadWatertight')}</div>
                        <StatusChip status={valid?.isWatertight ? 'good' : 'critical'} label={valid ? (valid.isWatertight ? '✓' : '✗') : '—'} />
                      </div>
                    </div>
                    {/* Object context — what this part is FOR changes what matters.
                        Kept near the top (right under the verdict cards) so users
                        actually find it; buried at the bottom it went unnoticed. */}
                    {unifiedAnalysis && (
                      <div className="border border-border rounded-sm bg-card p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-xs text-muted-foreground mb-1 font-mono tracking-widest">{t('objectTitle')}</div>
                          <select
                            value={objectContext}
                            onChange={(e) => setObjectContext(e.target.value as ObjectContext)}
                            className="text-[11px] font-mono px-2 py-1 border border-border rounded-sm bg-background text-muted-foreground cursor-pointer"
                          >
                            <option value="general">{t('objectGeneral')}</option>
                            <option value="structural">{t('objectStructural')}</option>
                            <option value="large">{t('objectLarge')}</option>
                            <option value="detailed">{t('objectDetailed')}</option>
                            <option value="liquid-cooling">{t('objectLiquidCooling')}</option>
                          </select>
                        </div>
                        {(() => {
                          const ctx = assessContext(unifiedAnalysis, objectContext);
                          return (
                            <>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-mono text-muted-foreground/60">{t('objectRisk')}</span>
                                <div className="flex-1 h-1.5 bg-border/40 rounded-full overflow-hidden">
                                  <div className="h-full bg-primary/70" style={{ width: `${Math.round(ctx.overallRisk * 100)}%` }} />
                                </div>
                                <span className="text-xs font-mono text-primary tabular-nums">{Math.round(ctx.overallRisk * 100)}%</span>
                              </div>
                              <ul className="space-y-1">
                                {ctx.topConcerns.map((c, i) => (
                                  <li key={i} className="text-[12px] font-mono text-muted-foreground/70 leading-relaxed">{c}</li>
                                ))}
                              </ul>
                            </>
                          );
                        })()}
                      </div>
                    )}
                    {/* Liquid-cooling application panel — right under the OBJECT
                        dropdown so picking "Liquid Cooling" shows its risks immediately */}
                    {objectContext === 'liquid-cooling' && unifiedAnalysis && (() => {
                      const lc = liquidCoolingFromUnified(unifiedAnalysis);
                      return lc ? (
                        <div className="border border-primary/25 rounded-sm bg-primary/5 p-4">
                          <div className="text-xs text-primary mb-1 font-mono tracking-widest">{t('lcTitle')}</div>
                          <div className="text-[11px] font-mono text-muted-foreground/50 mb-3">geometric proxies — not CFD</div>
                          <MetricRow label={t('lcLeak')} value={`${Math.round(lc.leakRisk * 100)}%`} highlight={lc.leakRisk > 0.5} />
                          <MetricRow label={t('lcChannel')} value={`${Math.round(lc.channelRisk * 100)}%`} highlight={lc.channelRisk > 0.5} />
                          <MetricRow label={t('lcHeatExchange')} value={`${Math.round(lc.heatExchangeProxy * 100)}%`} highlight={lc.heatExchangeProxy < 0.25} />
                          <MetricRow label={t('lcPressureWall')} value={lc.pressureWall.minThicknessMm != null ? `${lc.pressureWall.minThicknessMm.toFixed(2)} mm (min)` : '—'} highlight={lc.pressureWall.minThicknessMm != null && lc.pressureWall.minThicknessMm < lc.pressureWall.thresholdMm} />
                          <MetricRow label={t('lcOverallRisk')} value={`${Math.round(lc.overallRisk * 100)}%`} highlight={lc.overallRisk > 0.5} />
                        </div>
                      ) : null;
                    })()}
                    <div className="border border-border rounded-sm bg-card p-4">
                      <div className="text-xs text-muted-foreground mb-3 font-mono tracking-widest">
                        {t('geometryDataLabel')} <span className="text-primary/60">[ {unitSuffix} ]</span>
                      </div>
                      <MetricRow label={t('minThickness')} value={analysis.wallThickness.minThickness != null ? toUnit(analysis.wallThickness.minThickness).toFixed(3) : '—'} unit={unitSuffix} highlight />
                      {unifiedAnalysis?.metrics.result?.minWallThicknessMm != null && (
                        <MetricRow label={t('minAbs')} value={toUnit(unifiedAnalysis.metrics.result.minWallThicknessMm).toFixed(3)} unit={unitSuffix} />
                      )}
                      <MetricRow label={t('volume')} value={toUnit3(analysis.volume).toFixed(1)} unit={volumeUnit} />
                      <MetricRow label={t('surfaceArea')} value={toUnit2(analysis.surfaceArea).toFixed(1)} unit={areaUnit} />
                      <MetricRow label={t('dimX')} value={toUnit(modelData.dims.x).toFixed(2)} unit={unitSuffix} />
                      <MetricRow label={t('dimY')} value={toUnit(modelData.dims.y).toFixed(2)} unit={unitSuffix} />
                      <MetricRow label={t('dimZ')} value={toUnit(modelData.dims.z).toFixed(2)} unit={unitSuffix} />
                      <MetricRow label={t('overhangFaces')} value={analysis.overhang.areas} />
                      {/* Slicer provenance indicator — shows whether print metrics come from real G-code or estimates */}
                      {uploadedModel?.sliceProvenance && (
                        <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-400/70 mt-2">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          SLICED: {uploadedModel.sliceProvenance.slicerId} · {uploadedModel.sliceMetadata?.printTimeMinutes.toFixed(1)}min · {uploadedModel.sliceMetadata?.filamentGrams.toFixed(1)}g
                        </div>
                      )}
                      {!uploadedModel?.sliceMetadata && uploadedModel && (
                        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground/50 mt-2">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                          ESTIMATED (volume-based)
                        </div>
                      )}
                    </div>
                    {/* Expert mesh diagnostics — collapsed by default so the core metrics stay prominent */}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] font-mono text-muted-foreground/60 hover:text-foreground select-none">
                        {t('meshDiagnostics')}
                      </summary>
                      <div className="mt-1.5">
                        {topo && (
                          <>
                            <MetricRow label={t('cadTri')} value={topo.triangleCount} />
                            <MetricRow label={t('cadVerts')} value={topo.vertexCount} />
                            <MetricRow label={t('cadShells')} value={topo.shellCount} />
                            <MetricRow label={t('cadBoundaryEdges')} value={topo.boundaryEdgeCount} />
                            <MetricRow label={t('cadNonManifoldEdges')} value={topo.nonManifoldEdgeCount} />
                          </>
                        )}
                        {valid && (
                          <>
                            <MetricRow label={t('cadHoles')} value={valid.holeCount} />
                            <MetricRow label={t('cadNormalOrientation')} value={valid.normalOrientation} />
                            <MetricRow label={t('cadFlippedFaces')} value={valid.flippedNormalFaceCount} />
                          </>
                        )}
                      </div>
                    </details>
                    {/* Resin-specific metrics (shown when FDM/RESIN switch set to resin) */}
                    {unifiedAnalysis?.resin?.result && (
                      <div className="border border-primary/25 rounded-sm bg-primary/5 p-4 mt-3">
                        <div className="text-xs text-primary mb-3 font-mono tracking-widest">{t('resinPrintability')}</div>
                        <MetricRow label={t('resinShells')} value={unifiedAnalysis.resin.result.shellCount} highlight={unifiedAnalysis.resin.result.shellCount > 1} />
                        <MetricRow label={t('resinEnclosedCavity')} value={unifiedAnalysis.resin.result.enclosedCavity ? '⚠ yes' : 'no'} highlight={unifiedAnalysis.resin.result.enclosedCavity} />
                        <MetricRow label={t('resinIslands')} value={unifiedAnalysis.resin.result.islandCount} highlight={unifiedAnalysis.resin.result.islandCount > 0} />
                        <MetricRow label={t('resinSuction')} value={`${Math.round(unifiedAnalysis.resin.result.suctionRisk * 100)}%`} highlight={unifiedAnalysis.resin.result.suctionRisk > 0.6} />
                        <MetricRow label={t('resinOverCure')} value={`${Math.round(unifiedAnalysis.resin.result.cureRisk * 100)}%`} highlight={unifiedAnalysis.resin.result.cureRisk > 0.6} />
                        <MetricRow label={t('orientation')} value={unifiedAnalysis.resin.result.orientation} />
                        <MetricRow label={t('footprint')} value={`${unifiedAnalysis.resin.result.footprintAreaMm2} mm²`} />
                      </div>
                    )}
                    {/* FGF large-format metrics (shown when FDM/RESIN/FGF switch set to FGF) */}
                    {unifiedAnalysis?.fgf?.result && (
                      <div className="border border-primary/25 rounded-sm bg-primary/5 p-4 mt-3">
                        <div className="text-xs text-primary mb-3 font-mono tracking-widest">{t('fgfLargeFormat')}</div>
                        <MetricRow label={t('fgfPartScale')} value={unifiedAnalysis.fgf.result.partScale} />
                        <MetricRow label={t('fgfMaxDim')} value={`${unifiedAnalysis.fgf.result.maxDimMm} mm`} />
                        <MetricRow label={t('fgfWarpage')} value={`${Math.round(unifiedAnalysis.fgf.result.warpageRisk * 100)}%`} highlight={unifiedAnalysis.fgf.result.warpageRisk > 0.6} />
                        <MetricRow label={t('fgfDelamination')} value={`${Math.round(unifiedAnalysis.fgf.result.delaminationRisk * 100)}%`} highlight={unifiedAnalysis.fgf.result.delaminationRisk > 0.6} />
                        <MetricRow label={t('fgfSlenderness')} value={unifiedAnalysis.fgf.result.slenderness.toFixed(2)} />
                        <MetricRow label={t('orientation')} value={unifiedAnalysis.fgf.result.orientation} />
                        <MetricRow label={t('footprint')} value={`${unifiedAnalysis.fgf.result.footprintAreaMm2} mm²`} />
                      </div>
                    )}
                    {/* Powder Bed Fusion metrics (SLS / SLM / MJF) — geometric proxies, not thermal simulation */}
                    {unifiedAnalysis?.pbf?.result && (
                      <div className="border border-primary/25 rounded-sm bg-primary/5 p-4 mt-3">
                        <div className="text-xs text-primary mb-1 font-mono tracking-widest">{t('pbfLabel')} · {unifiedAnalysis.pbf.result.kind.toUpperCase()}</div>
                        <div className="text-[11px] font-mono text-muted-foreground/50 mb-3">{t('pbfGeometricProxy')}</div>
                        <MetricRow label={t('resinShells')} value={unifiedAnalysis.pbf.result.shellCount} highlight={unifiedAnalysis.pbf.result.powderTrap} />
                        <MetricRow label={t('pbfPowderTrap')} value={unifiedAnalysis.pbf.result.powderTrap ? t('pbfPowderTrapValue') : t('none')} highlight={unifiedAnalysis.pbf.result.powderTrap} />
                        <MetricRow label={t('pbfLargestFlatPlate')} value={`${unifiedAnalysis.pbf.result.largestFlatPlateMm2} mm²`} highlight={unifiedAnalysis.pbf.result.largestFlatPlateMm2 > 2000} />
                        <MetricRow label={t('pbfOverhangRatio')} value={`${Math.round(unifiedAnalysis.pbf.result.overhangRatio * 100)}%`} highlight={!unifiedAnalysis.pbf.result.selfSupporting && unifiedAnalysis.pbf.result.overhangRatio > 0.15} />
                        <MetricRow label={t('pbfSupport')} value={unifiedAnalysis.pbf.result.selfSupporting ? t('pbfSelfSupporting') : t('pbfSupportsRequired')} />
                        <MetricRow label={t('pbfDistortion')} value={`${Math.round(unifiedAnalysis.pbf.result.distortionRisk * 100)}%`} highlight={unifiedAnalysis.pbf.result.distortionRisk > 0.55} />
                        <MetricRow label={t('orientation')} value={unifiedAnalysis.pbf.result.orientation} />
                      </div>
                    )}
                    {/* Concrete construction-scale metrics — geometric proxies, not structural engineering */}
                    {unifiedAnalysis?.concrete?.result && (
                      <div className="border border-primary/25 rounded-sm bg-primary/5 p-4 mt-3">
                        <div className="text-xs text-primary mb-1 font-mono tracking-widest">{t('concreteTitle')}</div>
                        <div className="text-[11px] font-mono text-muted-foreground/50 mb-3">{t('concreteProxy')}</div>
                        <MetricRow label={t('concreteFeature')} value={`${Math.round(unifiedAnalysis.concrete.result.featureResolutionRisk * 100)}%`} highlight={unifiedAnalysis.concrete.result.featureResolutionRisk > 0.5} />
                        <MetricRow label={t('concreteOverhang')} value={`${Math.round(unifiedAnalysis.concrete.result.overhangSagRisk * 100)}%`} highlight={unifiedAnalysis.concrete.result.overhangSagRisk > 0.4} />
                        <MetricRow label={t('concreteCrack')} value={`${Math.round(unifiedAnalysis.concrete.result.crackRisk * 100)}%`} highlight={unifiedAnalysis.concrete.result.crackRisk > 0.5} />
                        <MetricRow label={t('concreteTime')} value={`${unifiedAnalysis.concrete.result.printTimeHours} h`} />
                      </div>
                    )}
                    {/* Eco-material advisory — material properties + thin-wall geometry */}
                    {unifiedAnalysis?.eco?.result && (
                      <div className="border border-primary/25 rounded-sm bg-primary/5 p-4 mt-3">
                        <div className="text-xs text-primary mb-1 font-mono tracking-widest">{t('ecoTitle')}</div>
                        <div className="text-[11px] font-mono text-muted-foreground/50 mb-3">{t('ecoProxy')}</div>
                        <MetricRow label={t('ecoMoisture')} value={`${Math.round(unifiedAnalysis.eco.result.moistureRisk * 100)}%`} highlight={unifiedAnalysis.eco.result.moistureRisk > 0.4} />
                        <MetricRow label={t('ecoDegradation')} value={`${Math.round(unifiedAnalysis.eco.result.degradationRisk * 100)}%`} highlight={unifiedAnalysis.eco.result.degradationRisk > 0.5} />
                        <MetricRow label={t('ecoBrittleness')} value={`${Math.round(unifiedAnalysis.eco.result.brittlenessRisk * 100)}%`} highlight={unifiedAnalysis.eco.result.brittlenessRisk > 0.6} />
                      </div>
                    )}
                    <button onClick={() => setTab('report')}
                      className="w-full py-2.5 text-xs font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all">
                      {t('generateReport')}
                    </button>
                    <button onClick={handleRepairProcess} disabled={repairing}
                      className="w-full py-2.5 text-xs font-mono border border-border/40 text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-sm transition-all disabled:opacity-50">
                      {repairing ? '▋ ' + t('analyze') : t('analyzeRepair')}
                    </button>
                    <div className="flex items-stretch gap-2">
                      <button onClick={handleDownloadStl} title={t('cadDownloadStl')}
                        className="flex-1 h-9 inline-flex items-center justify-center border border-border/40 text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-sm text-xs font-mono transition-all">
                        STL
                      </button>
                      <button onClick={handleDownload3mf} title={t('meshDownload3mf')}
                        className="flex-1 h-9 inline-flex items-center justify-center border border-border/40 text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-sm text-xs font-mono transition-all">
                        3MF
                      </button>
                    </div>
                  </div>
                )}

                {/* REPORT TAB */}
                {tab === 'report' && (
                  <div className="pt-4 space-y-4 relative">
                    {materialLoading && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 rounded-sm">
                        <div className="text-xs font-mono text-primary animate-pulse">&#x258b; {t('recalculating')}</div>
                      </div>
                    )}
                    {/* Batch overview — every loaded model, one glance; click a row to switch */}
                    {models.length > 1 && (
                      <BatchReport
                        models={models}
                        activeFileName={activeFileName}
                        onSelect={switchModel}
                        language={language}
                      />
                    )}
                    {quickReport && (
                      <div className="border border-border rounded-sm bg-card p-4 fade-up">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-mono text-primary tracking-widest">{t('analysisReport')}</span>
                          <span className="text-xs font-mono text-muted-foreground/40">{t('localEngine')}</span>
                        </div>
                        {unifiedAnalysis && !isWallConfidenceTrusted(unifiedAnalysis.metrics.confidence) && (
                          <div className="mb-3 border border-amber-500/40 bg-amber-500/5 text-amber-400/90 rounded-sm px-3 py-2 text-xs font-mono">
                            {t('lowConfidenceBanner')}
                          </div>
                        )}
                        <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
                          {quickReport}
                        </pre>
{unifiedAnalysis && (
  <ReportGenerator
    analysis={unifiedAnalysis}
    fileName={uploadedModel?.fileName ?? "model.stl"}
    language={language}
    expertReview={expertReview}
    production={productionFromUnified(unifiedAnalysis, material)}
  />
)}
{unifiedAnalysis && (
  <ProductionCard
    analysis={unifiedAnalysis}
    material={material}
    language={language}
  />
)}
                      </div>
                    )}
                    {/* AI interpretation — part of the report, read-only here
                        (the run control lives in the AGENTS tab) */}
                    {expertReview && (
                      <div className="border border-border rounded-sm bg-card p-4 fade-up">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-mono text-primary tracking-widest">{t('expertReview')}</span>
                          <span className="text-xs font-mono text-muted-foreground/40">{t('expertReviewAdvisory')}</span>
                        </div>
                        <div className="text-[13px] text-foreground/90 leading-relaxed">{expertReview.plain}</div>
                        {expertReview.findings.length > 0 && (
                          <ul className="mt-3 space-y-1.5">
                            {expertReview.findings.map((f, i) => (
                              <li key={i} className="text-xs text-muted-foreground/80 leading-relaxed">
                                <span className={`font-mono uppercase text-[10px] ${f.severity === 'high' ? 'text-red-400' : f.severity === 'medium' ? 'text-yellow-400' : 'text-emerald-400'}`}>
                                  {f.severity}
                                </span>{' '}
                                <span className="text-foreground/90">{f.what}</span>{f.why ? ` — ${f.why}` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                        {expertReview.actions.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {expertReview.actions.map((a, i) => (
                              <li key={i} className="text-xs text-muted-foreground/70 leading-relaxed">→ {a.do}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* AGENTS TAB */}
                {tab === 'agents' && (
                  <div className="pt-4 space-y-4">
                    {agentLoading && (
                      <div className="border border-primary/30 rounded-sm p-6 text-center">
                        <div className="text-xs font-mono text-primary animate-pulse mb-2">\u258b {t('multiAgentRunning')}</div>
                        <div className="text-xs text-muted-foreground/50">
                          {['geometry_analyst', 'printability_scorer', 'failure_predictor', 'optimization_advisor']
                            .map((id) => getAgentLabel(id as AgentId, language))
                            .join(' \u2022 ')}
                        </div>
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
                          <div className="text-xs font-mono text-muted-foreground mb-2">{t('consensusScore')}</div>
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
                            {agentRun.consensus.verdict === 'pass' ? t('verdictPass') : agentRun.consensus.verdict === 'warning' ? t('verdictWarning') : t('verdictFail')}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground/50">
                            {agentRun.analysisSource === 'llm' ? (
                              <span className="text-cyan-400">{t('deepAgentLlm')}</span>
                            ) : (
                              <><span className="text-primary">{t('deterministicEngine')}</span>{' \u2022 '}</>
                            )}
                            {agentRun.usedVision && <><span className="text-primary">{t('visionUsed')}</span>{' \u2022 '}</>}
                            {agentRun.consensus.agreementDelta < 10 ? t('strongAgreement') : t('moderateAgreement')}
                            {' \u2022 '}{agentRun.totalDurationMs}ms
                          </div>
                        </div>

                        {/* Per-Agent Cards */}
                        {agentRun.results.map(result => (
                          <div key={result.agentId} className="border border-border rounded-sm bg-card p-4">
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <span className="text-xs font-mono text-primary">{getAgentLabel(result.agentId, language)}</span>
                                <span className="ml-2 text-xs text-muted-foreground/50">{getAgentDescription(result.agentId, language)}</span>
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
                          <summary className="text-xs font-mono text-muted-foreground">{translate(CONTENT, 'agent.votingRecord', language)}</summary>
                          <div className="mt-2 space-y-1">
                            {agentRun.votingRecords.map(record => (
                              <div key={record.agentId} className="flex justify-between text-xs font-mono text-muted-foreground/70">
                                <span>{getAgentLabel(record.agentId, language)}</span>
                                <span>{translate(CONTENT, 'agent.weight', language)}: {(record.weight * 100).toFixed(0)}% | {translate(CONTENT, 'agent.score', language)}: {record.adjustedScore !== record.initialScore ? `${Math.round(record.initialScore)} → ${Math.round(record.adjustedScore)}` : Math.round(record.adjustedScore)} | {translate(CONTENT, 'agent.confidence', language)}: {(record.confidence * 100).toFixed(0)}%</span>
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

                        <div className="border border-dashed border-border/50 rounded-sm p-4 space-y-3">
                          <div>
                            <div className="text-xs font-mono text-muted-foreground">{t('deepAnalysis')}</div>
                            <div className="mt-1 text-xs text-muted-foreground/60">{t('deepAnalysisAdvisory')}</div>
                          </div>
                          {!deepAgentRun && (
                            deepAnalysisLoading ? (
                              <div className="space-y-3">
                                <div className="flex items-center gap-2 text-xs font-mono text-cyan-400/80">
                                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                                  {deepSteps.length === 0
                                    ? t('deepAnalysisDesc')
                                    : t('deepAnalysisStep').replace('{n}', String(Math.min(deepSteps.length + 1, 5)))}
                                </div>
                                {deepSteps.map((step) => (
                                  <div key={step.index} className="text-xs">
                                    <div className="font-mono text-cyan-400/70">
                                      {t('deepAnalysisStep').replace('{n}', String(step.index + 1))} · {step.label}
                                    </div>
                                    <pre className="mt-0.5 whitespace-pre-wrap font-mono leading-relaxed text-muted-foreground/50 line-clamp-3">
                                      {step.raw.length > 600 ? `${step.raw.slice(0, 600)}…` : step.raw}
                                    </pre>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {deepError && <div className="text-xs font-mono text-red-400">{deepError}</div>}
                                <button
                                  onClick={() => {
                                    if (!user) { setShowAccountModal(true); return; }
                                    if (uploadedModel) void runDeepAnalysisIfConfigured(uploadedModel, material);
                                  }}
                                  disabled={deepAnalysisLoading || !user}
                                  className="text-xs font-mono px-4 py-2 border border-primary/30 text-primary hover:bg-primary/10 rounded-sm transition-all disabled:opacity-40"
                                >
                                  {user ? t('deepAnalysisRun') : t('signInToDeepAnalysis')}
                                </button>
                              </div>
                            )
                          )}
                          {deepAgentRun && (
                            <details className="text-xs text-muted-foreground" open>
                              <summary className="cursor-pointer font-mono text-cyan-400">
                                {t('deepAnalysisScore')}: {deepAgentRun.consensus.overallScore}/100
                              </summary>
                              <pre className="mt-3 whitespace-pre-wrap font-mono leading-relaxed text-muted-foreground/80">
                                {deepAgentRun.consensus.summary}
                              </pre>
                            </details>
                          )}
                        </div>
                      </>
                    )}
                    {/* Expert LLM review — a material-domain AI expert translates the
                        deterministic metrics into plain-language advice */}
                    <ExpertReviewPanel
                      model={modelData}
                      material={material}
                      objectContext={objectContext}
                      onReviewChange={setExpertReview}
                      materialMetrics={(() => {
                        const resin = unifiedAnalysis?.resin?.result;
                        const fgf = unifiedAnalysis?.fgf?.result;
                        const pbf = unifiedAnalysis?.pbf?.result;
                        const concrete = unifiedAnalysis?.concrete?.result;
                        // Liquid-cooling context takes priority — a liquid-cooled SLM
                        // part is simultaneously a pbf part, and the application-level
                        // numbers matter most to that expert.
                        if (objectContext === 'liquid-cooling' && unifiedAnalysis) {
                          const lc = liquidCoolingFromUnified(unifiedAnalysis);
                          if (lc) return `LiquidCooling: leakRisk: ${(lc.leakRisk * 100).toFixed(0)}%, channelRisk: ${(lc.channelRisk * 100).toFixed(0)}%, heatExchangeProxy: ${(lc.heatExchangeProxy * 100).toFixed(0)}%, pressureWallMin: ${lc.pressureWall.minThicknessMm ?? 'n/a'}mm, threshold: ${lc.pressureWall.thresholdMm}mm`;
                        }
                        if (resin) return `Shells: ${resin.shellCount}, enclosedCavity: ${resin.enclosedCavity}, islands: ${resin.islandCount}, suctionRisk: ${(resin.suctionRisk * 100).toFixed(0)}%, overCureRisk: ${(resin.cureRisk * 100).toFixed(0)}%, orientation: ${resin.orientation}`;
                        if (fgf) return `PartScale: ${fgf.partScale}, maxDim: ${fgf.maxDimMm}mm, warpageRisk: ${(fgf.warpageRisk * 100).toFixed(0)}%, delaminationRisk: ${(fgf.delaminationRisk * 100).toFixed(0)}%, slenderness: ${fgf.slenderness.toFixed(2)}, orientation: ${fgf.orientation}`;
                        if (pbf) return `Kind: ${pbf.kind}, powderTrap: ${pbf.powderTrap}, largestFlatPlate: ${pbf.largestFlatPlateMm2}mm2, overhangRatio: ${(pbf.overhangRatio * 100).toFixed(0)}%, distortionRisk: ${(pbf.distortionRisk * 100).toFixed(0)}%, selfSupporting: ${pbf.selfSupporting}, orientation: ${pbf.orientation}`;
                        if (concrete) return `Concrete: featureResolutionRisk: ${(concrete.featureResolutionRisk * 100).toFixed(0)}%, overhangSagRisk: ${(concrete.overhangSagRisk * 100).toFixed(0)}%, crackRisk: ${(concrete.crackRisk * 100).toFixed(0)}%, printTimeHours: ${concrete.printTimeHours}`;
                        if (material.technology === 'eco' && unifiedAnalysis?.eco?.result) {
                          const eco = unifiedAnalysis.eco.result;
                          return `Eco: moistureRisk: ${(eco.moistureRisk * 100).toFixed(0)}%, degradationRisk: ${(eco.degradationRisk * 100).toFixed(0)}%, brittlenessRisk: ${(eco.brittlenessRisk * 100).toFixed(0)}%`;
                        }
                        return undefined;
                      })()}
                      language={language}
                      canRun={!!user || hasAnyKey()}
                      onNeedAuth={() => setShowAccountModal(true)}
                    />
                  </div>
                )}

                {/* CAUSALITY TAB */}
                {tab === 'causality' && (
                  <Suspense fallback={<div className="pt-6 text-xs font-mono text-primary animate-pulse">▋ {t('loading3d')}</div>}>
                    <div className="pt-4 space-y-4">
                      <CausalityPanel graph={causalityGraph} selectedId={selectedEventId} onSelect={setSelectedEventId} language={language} />
                      <div className="border-t border-border/20 my-2" />
                      {patternMatches.length > 0 && (
                        <PatternMemoryPanel
                          matches={patternMatches}
                          selectedPatternId={selectedPatternId}
                          onSelectPattern={setSelectedPatternId}
                          language={language}
                        />
                      )}
                      <div className="border-t border-border/20 my-2" />
                      <GeometrySuggestionPanel
                        suggestions={counterfactualSuggestions}
                        selectedSuggestionId={selectedSuggestionId}
                        onSelectSuggestion={setSelectedSuggestionId}
                        language={language}
                      />
                    </div>
                  </Suspense>
                )}

              </div>
            )}

            {/* Empty state — the drop zone above already prompts the upload.
                Features sit lower with breathing room in between; the middle
                stays open for future content. */}
            {!uploadedModel && (
              <div className="mt-28">
                <FeaturesSection t={t} onNavigate={handleFeatureNavigate} />
              </div>
            )}

            <div className="pt-2 border-t border-border/30 text-xs text-muted-foreground/20 font-mono text-center flex items-center justify-center gap-4">
              <span>{'\u00a9 2026'}</span>
              <button onClick={() => setShowPrivacy(true)} className="hover:text-muted-foreground transition-colors">
                {t('privacyTitle')}
              </button>
            </div>
          </div>
        </div>
      </div>}
      </Suspense>
    </div>
    </PrintPlaybackProvider>
  );
}
