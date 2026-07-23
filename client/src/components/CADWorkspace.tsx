import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  Download,
  RotateCcw,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { createLocalBridgeTransport } from "@/design/transport/localBridge";
import { parseSTL } from "@/lib/stlParser";
import { fromThreeBufferGeometry, runAnalysisPipeline, type UnifiedAnalysis } from "@/analysis";
import { getAPIKeys, getActiveProvider } from "@/lib/apiKeys";
import { useMaterial } from "@/contexts/MaterialContext";
import type { Language } from "@/lib/i18n";
import { runConfidenceGate, type CADConfidenceReport, type CADRunRecord, type ImprovementResult, type Issue as ConfidenceIssue, type RepairSuggestion, type GenerationQuality } from "@/cad-confidence";
import { CAD_MATERIALS, getCADMaterialPreset, createCADMaterial, type CADMaterialPreset } from "@/lib/cadMaterials";
import { applySuggestions } from "@/lib/geometryEditor";
import { optimizeDesign, type OptimizationDecision } from "@/agents/designOptimizer";
import { CADHeader } from "./cad/CADHeader";
import { CADViewport } from "./cad/CADViewport";
import { ErrorCard } from "./cad/ErrorCard";
import { AnalysisSubTabs } from "./cad/AnalysisSubTabs";

const LLM_CONFIGS: Record<string, { baseUrl: string; model: string }> = {
  openai:   { baseUrl: 'https://api.openai.com/v1',            model: 'gpt-4o' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1',          model: 'deepseek-chat' },
  kimi:     { baseUrl: 'https://api.moonshot.cn/v1',           model: 'kimi-k3' },
  fireworks:{ baseUrl: 'https://api.fireworks.ai/inference/v1', model: 'accounts/fireworks/models/deepseek-v4-pro' },
};

interface FallbackEntry { source: string; summary: string }

const FALLBACK_SOURCES: Record<string, FallbackEntry> = {
  '100mm flange': {
    source: `from build123d import *
import math
# PARAM outer "Outer Diameter" mm 10 500 1
# PARAM inner "Inner Diameter" mm 5 400 1
# PARAM thick "Thickness" mm 1 50 1
# PARAM holes "Holes" 0 50 1
# PARAM bolt_r "Bolt Circle Radius" mm 5 200 1
# PARAM bolt_d "Bolt Diameter" mm 2 20 1
def gen_step():
    outer = 100; inner = 50; thick = 10; holes = 8; bolt_r = 38; bolt_d = 6
    ring = Circle(outer / 2) - Circle(inner / 2)
    body = extrude(ring, thick)
    for i in range(holes):
        a = 2 * math.pi * i / holes
        hole = Pos(bolt_r * math.cos(a), bolt_r * math.sin(a)) * Circle(bolt_d / 2)
        body -= extrude(hole, thick)
    return body`,
    summary: '100mm flange, 8 bolt holes, parametric'
  },
  'sports car concept': {
    source: `from build123d import *
# PARAM body_w "Body Width" mm 50 500 1
# PARAM body_h "Body Height" mm 20 200 1
# PARAM body_d "Body Depth" mm 20 200 1
# PARAM cabin_h "Cabin Height" mm 10 100 1
# PARAM tire_r "Tire Radius" mm 3 30 1
# PARAM wheel_offset "Wheel Offset" mm 20 100 1
def gen_step():
    body_w = 180; body_h = 70; body_d = 40; cabin_h = 25; tire_r = 10; wheel_offset = 55
    body = Box(body_w, body_h, body_d, align=(Align.CENTER, Align.CENTER, Align.MIN))
    cabin = Pos(0, 0, 40) * Box(100, 50, cabin_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    roof = Pos(0, 0, 65) * Box(60, 40, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
    body += cabin + roof
    wheels = Cylinder(radius=tire_r, height=12, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    body += Pos(-wheel_offset, -30, 5) * wheels + Pos(wheel_offset, -30, 5) * wheels + Pos(-wheel_offset, 30, 5) * wheels + Pos(wheel_offset, 30, 5) * wheels
    spoiler = Pos(0, -30, 60) * Box(50, 5, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
    body += spoiler
    return body`,
    summary: 'Low-poly sports car concept'
  },
  'architectural tower': {
    source: `from build123d import *
# PARAM base_w "Base Width" mm 20 200 1
# PARAM base_h "Base Height" mm 2 30 1
# PARAM tower_w "Tower Width" mm 10 100 1
# PARAM tower_h "Tower Height" mm 20 200 1
# PARAM spire_r1 "Spire Base Radius" mm 2 30 1
# PARAM spire_h "Spire Height" mm 5 50 1
# PARAM mid_w "Mid Section Width" mm 10 80 1
# PARAM window_w "Window Width" mm 5 40 1
# PARAM fillet_r "Fillet Radius" mm 0.5 10 0.5
def gen_step():
    base_w = 60; base_h = 10; tower_w = 30; tower_h = 80; spire_r1 = 10; spire_h = 20; mid_w = 40; window_w = 25; fillet_r = 2
    base = Box(base_w, base_w, base_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    tower = Pos(0, 0, base_h) * Box(tower_w, tower_w, tower_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    mid = Pos(0, 0, base_h + tower_h - 10) * Box(mid_w, mid_w, 10, align=(Align.CENTER, Align.CENTER, Align.MIN))
    spire = Pos(0, 0, base_h + tower_h + 10) * Cone(spire_r1, 2, spire_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    windows = Pos(0, 0, base_h + 5) * Box(window_w, 3, tower_h - 10, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    body = base + tower + mid + spire
    body -= windows
    body = fillet(body.edges().group_by(Axis.Z)[0], radius=fillet_r)
    return body`,
    summary: 'Architectural massing tower'
  },
  'simplified human figure': {
    source: `from build123d import *
# PARAM torso_w "Torso Width" mm 10 80 1
# PARAM torso_h "Torso Height" mm 20 100 1
# PARAM torso_d "Torso Depth" mm 5 40 1
# PARAM head_r "Head Radius" mm 5 25 1
# PARAM arm_l "Arm Length" mm 15 60 1
# PARAM arm_w "Arm Width" mm 3 15 1
# PARAM leg_l "Leg Length" mm 10 60 1
# PARAM leg_w "Leg Width" mm 3 15 1
def gen_step():
    torso_w = 30; torso_d = 20; torso_h = 50; head_r = 12; arm_l = 35; arm_w = 10; leg_l = 30; leg_w = 10
    torso = Box(torso_w, torso_d, torso_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    head = Pos(0, 0, torso_h) * Sphere(head_r)
    arm1 = Pos(-20, 0, torso_h - 20) * Box(arm_w, 8, arm_l, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    arm2 = Pos(20, 0, torso_h - 20) * Box(arm_w, 8, arm_l, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    leg1 = Pos(-8, 0, 0) * Box(leg_w, 10, leg_l, align=(Align.CENTER, Align.CENTER, Align.MIN))
    leg2 = Pos(8, 0, 0) * Box(leg_w, 10, leg_l, align=(Align.CENTER, Align.CENTER, Align.MIN))
    body = torso + head + arm1 + arm2 + leg1 + leg2
    return body`,
    summary: 'Simplified human figure (low-poly)'
  },
  'japanese house': {
    source: `from build123d import *
# PARAM house_w "House Width" mm 40 200 1
# PARAM house_d "House Depth" mm 30 150 1
# PARAM wall_h "Wall Height" mm 10 60 1
# PARAM roof_r1 "Roof Base Radius" mm 20 80 1
# PARAM door_w "Door Width" mm 5 20 1
# PARAM door_h "Door Height" mm 10 40 1
# PARAM window_w "Window Width" mm 3 20 1
# PARAM window_h "Window Height" mm 5 30 1
# PARAM chimney_w "Chimney Width" mm 3 15 1
# PARAM chimney_h "Chimney Height" mm 10 40 1
def gen_step():
    house_w = 80; house_d = 60; wall_h = 25; roof_r1 = 50; door_w = 10; door_h = 20; window_w = 8; window_h = 10; chimney_w = 6; chimney_h = 20
    base = Box(house_w, house_d, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
    walls = Pos(0, 0, 5) * Box(70, 50, wall_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    roof_base = Pos(0, 0, 5 + wall_h) * Box(80, 55, 3, align=(Align.CENTER, Align.CENTER, Align.MIN))
    roof = Pos(0, 0, 8 + wall_h) * Cone(roof_r1, 10, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
    door = Pos(0, -16, 5) * Box(door_w, 20, door_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    window1 = Pos(-15, -16, 15) * Box(window_w, window_w, window_h, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    window2 = Pos(15, -16, 15) * Box(window_w, window_w, window_h, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    chimney = Pos(25, 10, 5 + wall_h) * Box(chimney_w, chimney_w, chimney_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    body = base + walls + roof_base + roof + chimney
    body -= door + window1 + window2
    return body`,
    summary: 'Simplified Japanese-style house'
  }
};

const FALLBACK_SOURCE_DEFAULT: FallbackEntry = {
  source: `from build123d import *
# PARAM plate_w "Plate Width" mm 20 200 1
# PARAM plate_d "Plate Depth" mm 20 200 1
# PARAM plate_h "Plate Thickness" mm 2 50 1
# PARAM hole_r "Hole Radius" mm 1 10 0.5
# PARAM hole_spacing_x "Hole Spacing X" mm 10 100 1
# PARAM hole_spacing_y "Hole Spacing Y" mm 10 100 1
def gen_step():
    plate_w = 80; plate_d = 60; plate_h = 20; hole_r = 3; hole_spacing_x = 25; hole_spacing_y = 15
    body = Box(plate_w, plate_d, plate_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    for x in [-hole_spacing_x, hole_spacing_x]:
        for y in [-hole_spacing_y, hole_spacing_y]:
            h = Pos(x, y, 0) * Cylinder(radius=hole_r, height=plate_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
            body -= h
    return body`,
  summary: 'Generic mounting plate (fallback)'
};

const STARTER_EXAMPLES: Record<Language, string[]> = {
  en: [
    "Create a 60mm x 45mm mounting plate with four 5mm holes and rounded corners",
    "Make a flange, outer diameter 100mm, inner diameter 50mm, 8 bolt holes",
    "Create a small cabinet, width 500mm depth 400mm height 600mm, two drawers",
  ],
  ja: [
    "60mm x 45mm の取付プレート、5mm穴を4つ、角丸",
    "外径100mm、内径50mm、8個のボルト穴があるフランジ",
    "幅500mm、奥行400mm、高さ600mm、引き出し2段の小さな棚",
  ],
  zh: [
    "做一个60mm x 45mm的安装板，四个5mm孔，边角圆角",
    "做一个法兰盘，外径100mm，内径50mm，8个螺栓孔",
    "创建一个小柜子，宽500mm，深400mm，高600mm，两个抽屉",
  ],
};

function fuzzyFindFallback(prompt: string): { source: string; summary: string; matched: string | null } {
  const lower = prompt.toLowerCase();
  const exact = FALLBACK_SOURCES[lower];
  if (exact) return { ...exact, matched: lower };
  return { source: '', summary: '', matched: null };
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface Stage {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  elapsedMs: number;
}

function StageRow({ stage }: { stage: Stage }) {
  const icon = stage.status === 'done' ? '✓' : stage.status === 'error' ? '✗' : stage.status === 'running' ? '◌' : '·';
  const color = stage.status === 'done' ? 'text-emerald-400' : stage.status === 'error' ? 'text-red-400' : stage.status === 'running' ? 'text-primary' : 'text-muted-foreground/30';
  return (
    <div className="flex items-center gap-2 text-[13px] font-mono">
      <span className={`${color} w-4 text-center`}>{icon}</span>
      <span className={`${color} ${stage.status === 'pending' ? 'opacity-30' : ''}`}>{stage.label}</span>
      {stage.elapsedMs > 0 && <span className="text-muted-foreground/40 tabular-nums">({stage.elapsedMs}ms)</span>}
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

const DIFFICULTY_RANK: Record<string, number> = { none: 0, easy: 1, moderate: 2, difficult: 3, very_difficult: 4 };

interface DesignStarter {
  name: string;
  prompt: string;
}

const DESIGN_STARTERS: Record<string, DesignStarter[]> = {
  Architecture: [
    { name: 'House Wall', prompt: '3D printed house wall panel with insulation channels and structural ribs' },
    { name: 'Architectural Facade', prompt: 'parametric architectural facade panel with modular pattern' },
    { name: 'Bridge', prompt: 'structural bridge with truss reinforcement and support piers' },
  ],
  Furniture: [
    { name: 'Chair', prompt: 'ergonomic chair with organic curves and lattice seat' },
    { name: 'Table', prompt: 'minimalist table with cross-brace legs and rounded top' },
    { name: 'Lamp', prompt: '3D printed lamp shade with parametric lattice pattern' },
  ],
  Automotive: [
    { name: 'Car Part', prompt: 'automotive bracket with lightweight topology optimization' },
    { name: 'Drone Frame', prompt: 'quadcopter drone frame with motor mounts and cable channels' },
  ],
  Sustainable: [
    { name: 'Recycled Panel', prompt: 'recycled material building panel with interlocking edges and ribbed core' },
    { name: 'Bio Composite Product', prompt: 'biodegradable composite product with organic surface texture and minimal material usage' },
  ],
};

const CATEGORY_GLYPH: Record<string, string> = {
  Architecture: '⌗',
  Furniture: '⎔',
  Automotive: '⌂',
  Sustainable: '♻',
};

function MetricDeltaRow({ label, before, after, beforeDisplay, afterDisplay, higherBetter }: {
  label: string;
  before: number;
  after: number;
  beforeDisplay: string;
  afterDisplay: string;
  higherBetter: boolean;
}) {
  const same = before === after;
  const improved = same ? false : higherBetter ? after > before : after < before;
  const color = same ? 'text-muted-foreground/40' : improved ? 'text-emerald-400/70' : 'text-red-400/70';
  return (
    <div className="flex items-center justify-between gap-1 text-[13px]">
      <span className="text-muted-foreground/50 uppercase tracking-wider">{label}</span>
      <span className={`tabular-nums ${color}`}>{beforeDisplay} → {afterDisplay}</span>
    </div>
  );
}

function CompactRiskCard({ title, risk }: { title: string; risk: { score: number; level: string; reasons: string[] } }) {
  const dotClass = risk.level === 'LOW' ? 'bg-emerald-400' : risk.level === 'MEDIUM' ? 'bg-amber-400' : 'bg-red-400';
  const textClass = risk.level === 'LOW' ? 'text-emerald-400' : risk.level === 'MEDIUM' ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="text-center rounded-sm p-3 border border-border/20">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span className="text-[13px] text-muted-foreground/50 font-mono tracking-wider">{title}</span>
      </div>
      <div className={`text-lg font-bold font-mono tabular-nums ${textClass}`}>{risk.level}</div>
    </div>
  );
}

function TechRow({ label, value, badge }: { label: string; value: string | number | undefined | null; badge?: string | null | boolean }) {
  const badgeStr = typeof badge === 'boolean' ? (badge ? 'pass' : 'fail') : badge;
  const displayValue = typeof value === 'string' ? value.replace(/_/g, ' ') : value;
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] break-words min-w-0">
      <span className="text-muted-foreground/50 uppercase tracking-wider shrink-0">{label}</span>
      <span className="flex items-center gap-1 text-muted-foreground/70 tabular-nums text-right break-all max-w-[55%]">
        {String(displayValue ?? '—')}
        {badgeStr && (
          <span className={`text-[11px] px-1.5 py-0.5 rounded-sm border font-medium ${
            badgeStr === 'pass' || badgeStr === 'low' || badgeStr === 'none' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
            badgeStr === 'fail' || badgeStr === 'high' || badgeStr === 'severe' || badgeStr === 'very_difficult' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
            badgeStr === 'moderate' || badgeStr === 'difficult' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
            'bg-muted text-muted-foreground border-border'
          }`}>{badgeStr}</span>
        )}
      </span>
    </div>
  );
}

function getPrintabilityLevel(report: CADConfidenceReport | null): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (!report?.risks) return 'LOW';
  const avgRisk = (report.risks.structural.score + report.risks.print.score + report.risks.manufacturing.score) / 3;
  if (avgRisk < 30) return 'HIGH';
  if (avgRisk < 60) return 'MEDIUM';
  return 'LOW';
}

/* ─── Engineering Metrics ─── */

interface EngineeringMetricsSnapshot {
  overhangAreaPercent: number;
  supportVolumeMm3: number;
  supportDifficulty: string;
  thinWallRatio: number;
  wallThicknessP5Mm: number | null;
  volumeMm3: number;
  printTimeHours: number;
  failureProbability: number;
  manufacturingRisk: number;
}

function extractMetrics(analysis: UnifiedAnalysis, report: CADConfidenceReport): EngineeringMetricsSnapshot {
  const m = analysis.metrics?.result;
  const sp = analysis.support?.result;
  const pt = analysis.printTime?.result;
  const exp = report.explanation;
  return {
    overhangAreaPercent: Math.round((m?.overhang?.ratio ?? 0) * 100),
    supportVolumeMm3: Math.round(sp?.totalSupportVolumeMm3 ?? 0),
    supportDifficulty: sp?.difficulty ?? 'none',
    thinWallRatio: m?.thinWallRatio ?? 0,
    wallThicknessP5Mm: m?.p5WallThicknessMm,
    volumeMm3: Math.round(m?.meshVolumeMm3 ?? 0),
    printTimeHours: pt?.estimatedPrintTimeHours ?? 0,
    failureProbability: exp?.failureProbability ?? 0,
    manufacturingRisk: report.risks?.manufacturing?.score ?? 0,
  };
}

function difficultyRank(d: string): number {
  return DIFFICULTY_RANK[d] ?? 0;
}

/* ─── Main Component ─── */

interface CADWorkspaceProps {
  language: Language;
}

export function CADWorkspace({ language }: CADWorkspaceProps) {
  const { material, materialName } = useMaterial();
  const [prompt, setPrompt] = useState(STARTER_EXAMPLES[language][0]);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [analysis, setAnalysis] = useState<UnifiedAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [totalTime, setTotalTime] = useState(0);
  const [llmInfo, setLlmInfo] = useState('');
  const [fitKey, setFitKey] = useState(0);
  const [confidenceReport, setConfidenceReport] = useState<CADConfidenceReport | null>(null);
  const [gateIssues, setGateIssues] = useState<ConfidenceIssue[]>([]);
  const [cadMaterialId, setCadMaterialId] = useState(CAD_MATERIALS[0].id);
  const [cadRunHistory, setCadRunHistory] = useState<CADRunRecord[]>([]);
  const [editSelectorOpen, setEditSelectorOpen] = useState(false);
  const [editWarning, setEditWarning] = useState<string | null>(null);
  const [improvementResult, setImprovementResult] = useState<ImprovementResult | null>(null);
  const [optimizationState, setOptimizationState] = useState<{
    plan: OptimizationDecision;
    beforeConfidence: number;
    afterConfidence: number;
    beforeIssues: number;
    afterIssues: number;
    beforeVerdict: string;
    afterVerdict: string;
    accepted: boolean;
    beforeMetrics?: EngineeringMetricsSnapshot;
    afterMetrics?: EngineeringMetricsSnapshot;
  } | null>(null);
  const [generationQuality, setGenerationQuality] = useState<GenerationQuality>('SUCCESS');
  const [repairInfo, setRepairInfo] = useState<{ repaired: boolean; repairType: string; attempts: number } | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const lastBboxRef = useRef<string | null>(null);
  const startTs = useRef(0);
  const stageTs = useRef<Record<string, number>>({});
  const stlBytesRef = useRef<ArrayBuffer | null>(null);
  const modelSummaryRef = useRef<string | null>(null);
  const templateSourceRef = useRef<string | null>(null);

  const cadPreset = useMemo(() => getCADMaterialPreset(cadMaterialId), [cadMaterialId]);

  const updateStage = useCallback((id: string, status: Stage['status'], elapsed?: number) => {
    setStages(prev => prev.map(s => s.id !== id ? s : { ...s, status, elapsedMs: elapsed ?? s.elapsedMs }));
  }, []);

  useEffect(() => {
    setPrompt(STARTER_EXAMPLES[language][0]);
  }, [language]);

  const handleGenerate = useCallback(async (customPrompt?: string, baseModel?: { generatedModelId: string; editInstruction: string }) => {
    const p = (customPrompt ?? prompt).trim();
    if (!p) return;

    setLoading(true);
    setError(null);
    setEditWarning(null);
    setImprovementResult(null);
    setOptimizationState(null);
    setGenerationQuality('SUCCESS');
    setRepairInfo(null);
    setGeometry(null);
    setAnalysis(null);
    setConfidenceReport(null);
    setGateIssues([]);
    setRequestId(null);
    setTotalTime(0);
    stlBytesRef.current = null;
    modelSummaryRef.current = null;
    startTs.current = performance.now();
    stageTs.current = {};

    const stageDefs: Stage[] = [
      { id: 'bridge',  label: 'Connect to CAD bridge',           status: 'pending', elapsedMs: 0 },
      { id: 'llm',     label: 'Generate CAD (build123d / LLM)',  status: 'pending', elapsedMs: 0 },
      { id: 'parse',   label: 'Parse STL mesh',                  status: 'pending', elapsedMs: 0 },
      { id: 'analysis',label: 'Run analysis pipeline',           status: 'pending', elapsedMs: 0 },
    ];
    setStages(stageDefs);

    const mark = (id: string, status: Stage['status'], msg?: string) => {
      const now = performance.now();
      const elapsed = Math.round(now - startTs.current);
      if (!stageTs.current[id]) stageTs.current[id] = now;
      const sinceStart = Math.round(now - stageTs.current[id]);
      updateStage(id, status, sinceStart);
      console.log(`[CADStudio] [${elapsed}ms] ${id}: ${status}${msg ? ` — ${msg}` : ''}`);
    };

    try {
      mark('bridge', 'running');
      const avail = await fetch('/api/cad/generate/health').then(r => r.json()).then(d => d.ready === true).catch(() => false);
      if (!avail) {
        mark('bridge', 'error');
        throw new Error('CAD bridge not available — is the server running on port 3001?');
      }
      mark('bridge', 'done');

      mark('llm', 'running');
      const fallback = fuzzyFindFallback(p);
      let quality: GenerationQuality = 'SUCCESS';
      let outcome;

      if (fallback.matched) {
        mark('llm', 'running', `cached template`);
        templateSourceRef.current = fallback.source;
        const transport = createLocalBridgeTransport({ generatorSource: fallback.source });
        outcome = await transport.generate({ prompt: p, timeoutMs: 60_000, baseModel });
        if (outcome.ok) setLlmInfo(`Template: ${fallback.matched}`);
      } else {
        const llmProvider = getActiveProvider();
        const llmKey = llmProvider ? getAPIKeys()[llmProvider] : undefined;
        const llmCfg = llmProvider ? LLM_CONFIGS[llmProvider] : undefined;
        if (llmProvider && llmKey && llmCfg) {
          mark('llm', 'running', `calling ${llmProvider}/${llmCfg.model}`);
          const transport = createLocalBridgeTransport({
            llm: { baseUrl: llmCfg.baseUrl, apiKey: llmKey, model: llmCfg.model },
          });
          outcome = await transport.generate({ prompt: p, timeoutMs: 60_000, baseModel });
        } else {
          outcome = null;
        }

        if (!outcome || !outcome.ok) {
          const err = outcome && !outcome.ok ? (outcome as { ok: false; error: { code: string; detail?: string } }).error : null;
          const detail = err?.detail ?? 'no AI provider configured';
          mark('llm', 'error');
          quality = 'FAILED';
          setGenerationQuality('FAILED');
          throw new Error(
            `CAD generation failed.\n\n` +
            `${detail}\n\n` +
            `Configure an API key for one of:\n` +
            `- OpenAI\n` +
            `- DeepSeek\n` +
            `- Kimi\n` +
            `- Fireworks`,
          );
        }
        if (outcome && outcome.ok) {
          setLlmInfo('AI Generated');
        }
      }

      if (!outcome || !outcome.ok) {
        mark('llm', 'error');
        quality = 'FAILED';
        setGenerationQuality('FAILED');
        const detail = (outcome && !outcome.ok)
          ? ((outcome as { ok: false; error: { code: string; detail?: string; timeoutMs?: number } }).error.detail
            ?? `timed out after ${(outcome as any).error.timeoutMs ?? '?'}ms`)
          : 'unknown error';
        throw new Error(`Generation failed: ${detail}`);
      }

      setGenerationQuality(quality);

      setRequestId(outcome.result.model.id);
      modelSummaryRef.current = outcome.result.model.summary;
      stlBytesRef.current = outcome.result.stlBytes;
      setRepairInfo({
        repaired: outcome.result.repaired ?? false,
        repairType: outcome.result.repairType ?? 'none',
        attempts: outcome.result.attempts ?? 1,
      });
      console.log(`[CADStudio] Generated model: ${outcome.result.model.id}, duration: ${outcome.result.model.durationMs}ms`);
      mark('llm', 'done');

      mark('parse', 'running');
      const geo = parseSTL(outcome.result.stlBytes);
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      const triCount = geo.index?.count ? geo.index.count / 3 : geo.attributes.position.count / 3;
      console.log(`[CADStudio] STL parsed: ${triCount} triangles`);
      mark('parse', 'done');

      mark('analysis', 'running');
      const model = fromThreeBufferGeometry(geo);
      const unified = runAnalysisPipeline(model, {
        fileName: `${p}.stl`,
        material,
        printerId: 'bambu_x1c',
      });
      console.log(`[CADStudio] Analysis complete`);
      mark('analysis', 'done');

      setGeometry(geo);
      setAnalysis(unified);
      const gateResult = runConfidenceGate(unified, p, quality);
      setConfidenceReport(gateResult.report);
      setGateIssues(gateResult.issues);
      setCadRunHistory(prev => [...prev, {
        id: outcome.result.model.id,
        prompt: p,
        timestamp: new Date().toISOString(),
        confidence: gateResult.report.overallScore,
        verdict: gateResult.report.verdict,
        issues: gateResult.issues.map(i => ({ severity: i.severity, message: i.message })),
        risks: gateResult.report.risks,
      }]);
      if (baseModel) {
        const newBbox = unified.metrics?.result?.boundingBoxDimensionsMm;
        const oldBboxStr = lastBboxRef.current;
        if (oldBboxStr && newBbox) {
          const oldParts = oldBboxStr.split('x').map(Number);
          const newParts = [newBbox.x, newBbox.y, newBbox.z];
          const maxChange = oldParts[0] > 0 ? Math.max(...newParts.map((v, i) => Math.abs(v - oldParts[i]) / oldParts[i])) : 0;
          setEditWarning(maxChange > 0.3
            ? `Bounding box changed by ${(maxChange * 100).toFixed(0)}% — this may be a full regeneration, not an incremental edit of the previous design.`
            : null);
        }
      } else {
        const bbox = unified.metrics?.result?.boundingBoxDimensionsMm;
        if (bbox) lastBboxRef.current = `${bbox.x.toFixed(1)}x${bbox.y.toFixed(1)}x${bbox.z.toFixed(1)}`;
      }

      setTotalTime(Math.round(performance.now() - startTs.current));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[CADStudio] Error:', msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [prompt, material, updateStage]);

  /* ─── Parametric regeneration from source ─── */
  const handleRegenerateFromSource = useCallback(async (source: string) => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const transport = createLocalBridgeTransport({ generatorSource: source });
      const outcome = await transport.generate({ prompt, timeoutMs: 60_000 });
      if (!outcome || !outcome.ok) throw new Error('Regeneration failed');

      templateSourceRef.current = source;
      stlBytesRef.current = outcome.result.stlBytes;

      const geo = parseSTL(outcome.result.stlBytes);
      geo.computeVertexNormals();
      geo.computeBoundingBox();

      const model = fromThreeBufferGeometry(geo);
      const unified = runAnalysisPipeline(model, {
        fileName: `${prompt}.stl`,
        material,
        printerId: 'bambu_x1c',
      });

      setGeometry(geo);
      setAnalysis(unified);

      const gateResult = runConfidenceGate(unified, prompt, 'SUCCESS');
      setConfidenceReport(gateResult.report);
      setGateIssues(gateResult.issues);

      setCadRunHistory(prev => {
        const updated = [...prev];
        if (updated.length > 0) {
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            confidence: gateResult.report.overallScore,
            verdict: gateResult.report.verdict,
          };
        }
        return updated;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [prompt, material]);

  const handleApplyImprovement = useCallback(async (suggestion: RepairSuggestion, editInstruction: string) => {
    const typeMap: Record<string, string | undefined> = {
      wall_thickness: 'wall_thickening',
      overhang: 'orientation_change',
      orientation: 'orientation_change',
    };
    const opType = typeMap[suggestion.category];

    if (!opType || !geometry) {
      handleGenerate(prompt, { generatedModelId: requestId!, editInstruction });
      return;
    }

    const beforeConfidence = confidenceReport?.overallScore ?? 0;
    const beforeVerdict = confidenceReport?.verdict ?? 'FAIL';
    const beforeIssues = gateIssues.length;

    const markers: Array<{ severity: number; position: { x: number; y: number; z: number }; type: string }> = [];
    if (opType === 'wall_thickening' && analysis?.metrics?.result?.wallThicknessSamples) {
      for (const sample of analysis.metrics.result.wallThicknessSamples) {
        if (sample.thickness < 0.8) {
          markers.push({
            severity: Math.min(1, Math.max(0, (0.8 - sample.thickness) / 0.8)),
            position: sample.position,
            type: 'thin_wall',
          });
        }
      }
    }

    let modifiedGeo: THREE.BufferGeometry;
    try {
      modifiedGeo = applySuggestions(geometry, [{ type: opType, priority: suggestion.impact }], markers);
    } catch (e) {
      console.error('geometryEditor failed, falling back to LLM:', e);
      handleGenerate(prompt, { generatedModelId: requestId!, editInstruction });
      return;
    }

    const model = fromThreeBufferGeometry(modifiedGeo);
    const unified = runAnalysisPipeline(model, {
      fileName: `improved_${prompt}.stl`,
      material,
      printerId: 'bambu_x1c',
    });
    const gateResult = runConfidenceGate(unified, prompt, 'SUCCESS');

    setGeometry(modifiedGeo);
    setAnalysis(unified);
    setConfidenceReport(gateResult.report);
    setGateIssues(gateResult.issues);

    const afterConfidence = gateResult.report.overallScore;
    const afterIssues = gateResult.issues.length;
    const changed = afterConfidence !== beforeConfidence || afterIssues !== beforeIssues;
    const improved = afterConfidence > beforeConfidence || afterIssues < beforeIssues;

    const result: ImprovementResult = {
      before: { confidence: beforeConfidence, verdict: beforeVerdict, issues: beforeIssues },
      after: { confidence: afterConfidence, verdict: gateResult.report.verdict, issues: afterIssues },
      action: suggestion.action,
      changed,
      message: improved ? 'Improvement detected' : 'No measurable improvement',
    };
    setImprovementResult(result);

    const improvedMetrics = analysis && confidenceReport ? {
      beforeMetrics: extractMetrics(analysis, confidenceReport),
      afterMetrics: extractMetrics(unified, gateResult.report),
    } : {};

    setOptimizationState({
      plan: {
        action: suggestion.category === 'wall_thickness' ? 'wall_thickening' as const :
                suggestion.category === 'overhang' || suggestion.category === 'orientation' ? 'orientation_change' as const :
                'none' as const,
        reason: suggestion.description,
        expectedImprovement: improved ? Math.abs(afterConfidence - beforeConfidence) : 0,
        detected: suggestion.action,
        engineeringReason: '',
        expectedImpact: '',
      },
      beforeConfidence,
      afterConfidence,
      beforeIssues,
      afterIssues,
      beforeVerdict,
      afterVerdict: gateResult.report.verdict,
      accepted: improved,
      ...improvedMetrics,
    });

    setCadRunHistory(prev => {
      const updated = [...prev];
      if (updated.length > 0) {
        updated[updated.length - 1] = { ...updated[updated.length - 1], improvement: result };
      }
      return updated;
    });
  }, [geometry, analysis, confidenceReport, gateIssues, prompt, material, requestId, handleGenerate]);

  const handleAutoOptimize = useCallback(async () => {
    if (!geometry || !analysis || !confidenceReport) return;

    const decision = optimizeDesign(
      analysis,
      confidenceReport,
      confidenceReport.repairSuggestions,
      confidenceReport.designIntent ?? { objectType: '', dimensions: {}, requirements: [] },
    );

    if (decision.action === 'none') {
      setOptimizationState({
        plan: decision,
        beforeConfidence: confidenceReport.overallScore,
        afterConfidence: confidenceReport.overallScore,
        beforeIssues: gateIssues.length,
        afterIssues: gateIssues.length,
        beforeVerdict: confidenceReport.verdict,
        afterVerdict: confidenceReport.verdict,
        accepted: false,
      });
      return;
    }

    // Save original state for rollback
    const originalGeo = geometry.clone();
    const originalAnalysis = analysis;
    const originalConfidenceReport = confidenceReport;
    const originalIssues = gateIssues;
    const beforeConfidence = confidenceReport.overallScore;
    const beforeVerdict = confidenceReport.verdict;
    const beforeIssues = gateIssues.length;

    // Map decision to geometryEditor operation
    const markers: Array<{ severity: number; position: { x: number; y: number; z: number }; type: string }> = [];
    if (decision.action === 'wall_thickening' && analysis.metrics?.result?.wallThicknessSamples) {
      for (const sample of analysis.metrics.result.wallThicknessSamples) {
        if (sample.thickness < 0.8) {
          markers.push({
            severity: Math.min(1, Math.max(0, (0.8 - sample.thickness) / 0.8)),
            position: sample.position,
            type: 'thin_wall',
          });
        }
      }
    }

    let modifiedGeo: THREE.BufferGeometry;
    try {
      modifiedGeo = applySuggestions(geometry, [{ type: decision.action, priority: 'high' }], markers);
    } catch (e) {
      console.error('geometryEditor failed during auto-optimize:', e);
      setOptimizationState({
        plan: decision,
        beforeConfidence,
        afterConfidence: beforeConfidence,
        beforeIssues,
        afterIssues: beforeIssues,
        beforeVerdict,
        afterVerdict: beforeVerdict,
        accepted: false,
      });
      return;
    }

    const model = fromThreeBufferGeometry(modifiedGeo);
    const unified = runAnalysisPipeline(model, {
      fileName: `improved_${prompt}.stl`,
      material,
      printerId: 'bambu_x1c',
    });
    const gateResult = runConfidenceGate(unified, prompt, 'SUCCESS');

    const afterConfidence = gateResult.report.overallScore;
    const afterVerdict = gateResult.report.verdict;
    const afterIssues = gateResult.issues.length;
    const beforeMetrics = extractMetrics(originalAnalysis, originalConfidenceReport);
    const afterMetrics = extractMetrics(unified, gateResult.report);

    const confidenceUp = afterConfidence > beforeConfidence;
    const issuesDown = afterIssues < beforeIssues;
    const riskDown = afterMetrics.manufacturingRisk < beforeMetrics.manufacturingRisk;
    const accepted = confidenceUp && issuesDown && riskDown;

    if (!accepted) {
      setGeometry(originalGeo);
      setAnalysis(originalAnalysis);
      setConfidenceReport(originalConfidenceReport);
      setGateIssues(originalIssues);
      setOptimizationState({
        plan: decision,
        beforeConfidence,
        afterConfidence,
        beforeIssues,
        afterIssues,
        beforeVerdict,
        afterVerdict,
        accepted: false,
        beforeMetrics,
        afterMetrics,
      });
      return;
    }

    setGeometry(modifiedGeo);
    setAnalysis(unified);
    setConfidenceReport(gateResult.report);
    setGateIssues(gateResult.issues);

    const result: ImprovementResult = {
      before: { confidence: beforeConfidence, verdict: beforeVerdict as any, issues: beforeIssues },
      after: { confidence: afterConfidence, verdict: afterVerdict as any, issues: afterIssues },
      action: decision.action,
      changed: true,
      message: 'Auto-optimization applied',
    };
    setImprovementResult(result);

    setOptimizationState({
      plan: decision,
      beforeConfidence,
      afterConfidence,
      beforeIssues,
      afterIssues,
      beforeVerdict,
      afterVerdict,
      accepted: true,
      beforeMetrics,
      afterMetrics,
    });

    setCadRunHistory(prev => {
      const updated = [...prev];
      if (updated.length > 0) {
        updated[updated.length - 1] = { ...updated[updated.length - 1], improvement: result };
      }
      return updated;
    });
  }, [geometry, analysis, confidenceReport, gateIssues, prompt, material]);

  const downloadSTL = () => {
    if (stlBytesRef.current) {
      const blob = new Blob([stlBytesRef.current], { type: 'application/sla' });
      downloadBlob(`cad-model.stl`, blob);
    }
  };

  const score = confidenceReport?.overallScore ?? 0;
  const verdict = confidenceReport?.verdict ?? 'FAIL';
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rightTab, setRightTab] = useState<'cad' | 'analysis'>('cad');
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [hasParams, setHasParams] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({
    dimensions: true, holes: false, details: false, manufacturing: false,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paramValuesRef = useRef<Record<string, string>>({});

  const m = analysis?.metrics?.result;
  const t = analysis?.topology?.result;
  const v = analysis?.validation?.result;
  const sp = analysis?.support?.result;
  const pt = analysis?.printTime?.result;
  const bf = analysis?.bedFit?.result;
  const bb = m?.boundingBoxDimensionsMm;
  const errorCount = gateIssues.filter(i => i.severity === 'error').length;

  /* ─── Dynamic Parameter Schema ─── */

  interface DynamicParam {
    name: string;
    label: string;
    value: number;
    unit: string;
    min: number;
    max: number;
    step: number;
    section: string;
  }

  const _PL: Record<string, string> = {
    w:'Width',h:'Height',d:'Depth',l:'Length',r:'Radius',
    thick:'Thickness',outer:'Outer',inner:'Inner',bolt:'Bolt',
    hole:'Hole',holes:'Holes',num:'Count',count:'Count',
    corner:'Corner',fillet:'Fillet',spacing:'Spacing',
    seat:'Seat',leg:'Leg',back:'Back',tire:'Tire',
    body:'Body',window:'Window',door:'Door',wall:'Wall',
    width:'Width',height:'Height',depth:'Depth',length:'Length',
    radius:'Radius',diameter:'Diameter',angle:'Angle',
    wheelbase:'Wheelbase',roof:'Roof',spire:'Spire',
    tower:'Tower',cabin:'Cabin',plate:'Plate',
    head:'Head',arm:'Arm',house:'House',base:'Base',
    overall:'Overall',
  };

  function labelFromVar(name: string): string {
    return name.split('_').map(p => _PL[p.toLowerCase()]
      || (p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
  }

  function sectionFromName(name: string): string {
    const l = name.toLowerCase();
    if (/^(?:w(?:idth)?|h(?:eight)?|d(?:epth)?|l(?:ength)?|thick|outer|inner|size|plate|house|base_|overall|seat_|leg_|body_)/.test(l)) return 'dimensions';
    if (/hole|bolt/.test(l)) return 'holes';
    if (/radius|fillet|corner|angle|spacing|back|roof|spire|tower|cabin|head|arm|tire|wheelbase|window|door|count|num/.test(l)) return 'details';
    if (/wall/.test(l)) return 'manufacturing';
    return 'dimensions';
  }

  function unitFromName(name: string): string {
    const l = name.toLowerCase();
    if (/angle/.test(l)) return '°';
    if (/count|num|holes$/.test(l)) return '';
    if (name.length <= 2 && /[whdlr]/.test(name)) return 'mm';
    return 'mm';
  }

  function sliderBounds(name: string, current: string): { min: number; max: number; step: number } {
    const v = parseFloat(current) || 10;
    if (/hole/i.test(name) && /count|holes/i.test(name)) return { min: 0, max: 50, step: 1 };
    if (v <= 1) return { min: 0.1, max: 10, step: 0.1 };
    if (v <= 5) return { min: 0.5, max: 50, step: 0.5 };
    if (v <= 20) return { min: 1, max: 100, step: 1 };
    if (v <= 100) return { min: 1, max: 500, step: 1 };
    return { min: 1, max: 1000, step: 1 };
  }

  function parseParamsFromSource(source: string): DynamicParam[] {
    const aRe = /#\s*PARAM\s+(\w+)\s+"([^"]*)"\s+(\w+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g;
    let m; const annotated: DynamicParam[] = [];
    while ((m = aRe.exec(source)) !== null) {
      const vm = source.match(new RegExp(`\\b${m[1]}\\s*=\\s*(\\d+(?:\\.\\d+)?)`));
      if (vm) annotated.push({
        name: m[1], label: m[2], value: parseFloat(vm[1]),
        unit: m[3], min: parseFloat(m[4]), max: parseFloat(m[5]),
        step: parseFloat(m[6]), section: sectionFromName(m[1]),
      });
    }
    if (annotated.length > 0) return annotated;

    const vRe = /(?:^|;)\s*(\w+)\s*=\s*(\d+(?:\.\d+)?)/gm;
    const seen = new Set<string>(); const auto: DynamicParam[] = [];
    const SKIP = new Set(['from','import','def','return','gen_step',
      'body','ring','cabin','wheels','spoiler','base','tower','mid','spire',
      'windows','torso','head','arm1','arm2','leg1','leg2',
      'walls','roof_base','roof','door','window1','window2','chimney',
      'tmp','result','part1','part2','hole','h','i','j','k','x','y','z',
      'a','whe','cabin_h2','roof_h','arm','leg','door_h']);
    while ((m = vRe.exec(source)) !== null) {
      const name = m[1]; if (seen.has(name) || SKIP.has(name)) continue;
      seen.add(name); const val = parseFloat(m[2]);
      const b = sliderBounds(name, m[2]);
      auto.push({ name, label: labelFromVar(name), value: val,
        unit: unitFromName(name), section: sectionFromName(name), ...b });
    }
    if (auto.length >= 2) return auto;

    const bxRe = /Box\((\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?/g;
    const bx = bxRe.exec(source);
    if (bx) {
      const r: DynamicParam[] = [];
      if (bx[1]) r.push({ name:'box_w', label:'Width', value:parseFloat(bx[1]), unit:'mm', min:1, max:1000, step:1, section:'dimensions' });
      if (bx[2]) r.push({ name:'box_d', label:'Depth', value:parseFloat(bx[2]), unit:'mm', min:1, max:1000, step:1, section:'dimensions' });
      if (bx[3]) r.push({ name:'box_h', label:'Height', value:parseFloat(bx[3]), unit:'mm', min:1, max:1000, step:1, section:'dimensions' });
      return r;
    }
    return [];
  }

  /* ─── Feature Tree ─── */
  interface CADFeatureNode {
    id: string;
    type: string;
    label: string;
    params: Record<string, number | string>;
  }

  function parseFeatureTree(source: string): CADFeatureNode[] {
    const features: CADFeatureNode[] = [];
    const boxRe = /(\w+)\s*=\s*Box\((\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?/g; let bm;
    while ((bm = boxRe.exec(source)) !== null) {
      const p: Record<string, number | string> = { width: parseInt(bm[2]), depth: parseInt(bm[3]) };
      if (bm[4]) p.height = parseInt(bm[4]);
      features.push({ id: bm[1], type: 'box', label: `Box(${bm[2]}, ${bm[3]}${bm[4] ? ', ' + bm[4] : ''})`, params: p });
    }
    const cylRe = /(\w+)\s*=\s*Cylinder\(radius\s*=\s*(\d+(?:\.\d+)?)\s*,\s*height\s*=\s*(\d+(?:\.\d+)?)/g; let cm;
    while ((cm = cylRe.exec(source)) !== null) {
      features.push({ id: cm[1], type: 'cylinder', label: `Cylinder(r=${cm[2]})`, params: { radius: parseFloat(cm[2]), height: parseFloat(cm[3]) } });
    }
    const filletRe = /fillet\([^,]+,\s*radius\s*=\s*(\d+(?:\.\d+)?)/g; let fm;
    while ((fm = filletRe.exec(source)) !== null) {
      features.push({ id: 'fillet', type: 'fillet', label: 'Fillet', params: { radius: parseFloat(fm[1]) } });
    }
    const coneRe = /(\w+)\s*=\s*Cone\((\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/g; let com;
    while ((com = coneRe.exec(source)) !== null) {
      features.push({ id: com[1], type: 'cone', label: `Cone(${com[2]})`, params: { r1: parseFloat(com[2]), r2: parseFloat(com[3]), height: parseFloat(com[4]) } });
    }
    const sphereRe = /(\w+)\s*=\s*Sphere\((\d+(?:\.\d+)?)/g; let sm;
    while ((sm = sphereRe.exec(source)) !== null) {
      features.push({ id: sm[1], type: 'sphere', label: `Sphere(r=${sm[2]})`, params: { radius: parseFloat(sm[2]) } });
    }
    const extrudeRe = /(\w+)\s*=\s*extrude\((\w+)\s*,\s*(\d+(?:\.\d+)?)/g; let em;
    while ((em = extrudeRe.exec(source)) !== null) {
      features.push({ id: em[1], type: 'extrude', label: `Extrude(${em[2]})`, params: { height: parseFloat(em[3]) } });
    }
    return features;
  }

  const SECTION_LABELS: Record<string, string> = {
    dimensions: 'DIMENSIONS', holes: 'HOLES', details: 'DETAILS', manufacturing: 'MANUFACTURING',
  };

  /* ─── Parameter History ─── */
  interface ParamHistoryEntry {
    paramValues: Record<string, string>;
    diffs: Array<{ name: string; label: string; unit: string; before: string; after: string }>;
  }

  const MAX_HISTORY = 50;
  const [paramHistory, setParamHistory] = useState<ParamHistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [editingParam, setEditingParam] = useState<string | null>(null);

  function pushHistory(after: Record<string, string>, before: Record<string, string>) {
    const diffs: ParamHistoryEntry['diffs'] = [];
    for (const [name, val] of Object.entries(after)) {
      const old = before[name];
      if (old !== undefined && old !== val) {
        const entry = paramEntries?.find(e => e.name === name);
        diffs.push({ name, label: entry?.label ?? name, unit: entry?.unit ?? '', before: old, after: val });
      }
    }
    if (diffs.length === 0) return;
    historyIndexRef.current = Math.min(historyIndexRef.current + 1, MAX_HISTORY - 1);
    setHistoryIndex(historyIndexRef.current);
    setParamHistory(prev => {
      const truncated = prev.slice(0, historyIndexRef.current);
      return [...truncated, { paramValues: { ...after }, diffs }].slice(-MAX_HISTORY);
    });
  }

  /** Build modified source — replace any variable name with its new value */
  const applyParamChanges = useCallback((source: string, params: Record<string, string>): string => {
    let modified = source;
    for (const [name, newVal] of Object.entries(params)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      modified = modified.replace(new RegExp(`\\b(${escaped})\\s*=\\s*\\d+(?:\\.\\d+)?`, 'g'), `$1 = ${newVal}`);
    }
    return modified;
  }, []);

  /** Debounced param change — update value, push history, auto-regenerate after 400ms */
  const handleParamChange = useCallback((name: string, newValue: string) => {
    const beforeValues = { ...paramValuesRef.current };
    setParamValues(p => {
      const updated = { ...p, [name]: newValue };
      paramValuesRef.current = updated;
      return updated;
    });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const afterValues = paramValuesRef.current;
      pushHistory(afterValues, beforeValues);
      if (templateSourceRef.current) {
        const modified = applyParamChanges(templateSourceRef.current, afterValues);
        handleRegenerateFromSource(modified);
      }
    }, 400);
  }, [applyParamChanges, handleRegenerateFromSource]);

  /** Step adjustment (+/-) */
  const handleStep = useCallback((name: string, delta: number) => {
    const current = parseFloat(paramValuesRef.current[name]) || 0;
    const bounds = sliderBounds(name, String(current));
    const next = Math.round((current + delta) / bounds.step) * bounds.step;
    const clamped = Math.max(bounds.min, Math.min(bounds.max, next));
    handleParamChange(name, String(clamped));
  }, [handleParamChange]);

  const handleUndo = useCallback(() => {
    const prevIdx = historyIndexRef.current - 1;
    if (prevIdx < 0 || !paramHistory[prevIdx]) return;
    const entry = paramHistory[prevIdx];
    setParamValues(entry.paramValues);
    paramValuesRef.current = entry.paramValues;
    historyIndexRef.current = prevIdx;
    setHistoryIndex(prevIdx);
    if (templateSourceRef.current) {
      const modified = applyParamChanges(templateSourceRef.current, entry.paramValues);
      handleRegenerateFromSource(modified);
    }
  }, [paramHistory, applyParamChanges, handleRegenerateFromSource]);

  const handleRedo = useCallback(() => {
    const nextIdx = historyIndexRef.current + 1;
    if (nextIdx >= paramHistory.length) return;
    const entry = paramHistory[nextIdx];
    setParamValues(entry.paramValues);
    paramValuesRef.current = entry.paramValues;
    historyIndexRef.current = nextIdx;
    setHistoryIndex(nextIdx);
    if (templateSourceRef.current) {
      const modified = applyParamChanges(templateSourceRef.current, entry.paramValues);
      handleRegenerateFromSource(modified);
    }
  }, [paramHistory, applyParamChanges, handleRegenerateFromSource]);

  /* ─── Keyboard shortcuts ─── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); handleRedo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo]);

  /** Feature tree from source */
  const featureTree = useMemo(() => {
    if (!templateSourceRef.current) return [];
    return parseFeatureTree(templateSourceRef.current);
  }, [m]);

  /** Param entries parsed from template source */
  const paramEntries = useMemo(() => {
    if (!templateSourceRef.current) return null;
    const parsed = parseParamsFromSource(templateSourceRef.current);
    return parsed.length > 0 ? parsed : null;
  }, [m]);

  /** Populate editable paramValues from source after each generation */
  useEffect(() => {
    if (paramEntries) {
      const vals: Record<string, string> = {};
      for (const e of paramEntries) vals[e.name] = String(e.value);
      setParamValues(vals);
      paramValuesRef.current = vals;
      setHasParams(true);
      // Auto-switch to CAD tab so parameter sliders are visible
      setRightTab('cad');
    } else {
      setHasParams(false);
    }
  }, [paramEntries]);

  /* ─── Parameter History ─── */

  /* ─── errorInfo for Full Report ─── */
  const errorDetails = llmInfo && !llmInfo.startsWith('Template:') && llmInfo !== ''
    ? llmInfo
    : null;

  const handleImproveDesign = useCallback(() => {
    handleAutoOptimize();
  }, [handleAutoOptimize]);

  const handleNewDesign = useCallback(() => {
    setGeometry(null);
    setAnalysis(null);
    setConfidenceReport(null);
    setGateIssues([]);
    setError(null);
    setStages([]);
    stlBytesRef.current = null;
    modelSummaryRef.current = null;
    templateSourceRef.current = null;
    setLlmInfo('');
    setImprovementResult(null);
    setOptimizationState(null);
    setParamValues({});
    paramValuesRef.current = {};
    setHasParams(false);
    setRightTab('cad');
    setParamHistory([]);
    historyIndexRef.current = -1;
    setHistoryIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const hasGeometry = geometry != null;
  const spanCols = hasGeometry ? 'col-span-3' : 'col-span-2';

  return (
    <div className={`grid grid-rows-[72px_1fr] h-[calc(100vh-7rem)] ${hasGeometry ? 'grid-cols-[280px_1fr_380px]' : 'grid-cols-[280px_1fr]'}`}>
      {/* ── HEADER ── */}
      <CADHeader spanCols={spanCols} />

      {/* ── LEFT PANEL (always visible) ── */}
      <div className="flex flex-col border-r border-border/15 bg-card/30 overflow-y-auto">
        {/* Prompt input */}
        <div className="px-4 pt-5 pb-3 space-y-4">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !loading) { e.preventDefault(); handleGenerate(); }}}
            className="w-full h-[130px] resize-none bg-background border border-border/25 rounded-sm px-4 py-3 text-sm font-mono leading-relaxed text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
            placeholder="Describe your object..."
          />

          {/* GENERATE + NEW DESIGN + DOWNLOAD */}
          <div className="flex items-stretch gap-3">
            <button onClick={() => handleGenerate()} disabled={loading}
              className="flex-1 h-12 inline-flex items-center justify-center gap-2 bg-foreground text-background rounded-sm px-6 text-sm font-mono font-bold hover:bg-foreground/90 hover:shadow-[0_0_20px_rgba(0,200,255,0.15)] disabled:opacity-30 transition-all duration-200 active:scale-[0.98]">
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {loading ? 'GENERATING...' : 'GENERATE'}
            </button>
            <button onClick={handleNewDesign} disabled={loading} title="New Design"
              className="h-11 w-11 inline-flex items-center justify-center border border-border/40 text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-sm transition-all shrink-0">
              <RotateCcw className="w-4 h-4" />
            </button>
            {stlBytesRef.current && (
              <button onClick={downloadSTL} title="Download STL"
                className="h-11 w-11 inline-flex items-center justify-center border border-border/40 text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-sm transition-all shrink-0">
                <Download className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Error card */}
        {error && <ErrorCard message={error} />}

        {/* Edit warning */}
        {editWarning && (
          <div className="px-4 mt-3 flex items-start gap-2 py-2 border-t border-amber-500/15">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400/60 shrink-0 mt-0.5" />
            <span className="text-sm text-amber-400/70 font-mono leading-relaxed">{editWarning}</span>
          </div>
        )}

        {/* DESIGN STARTERS (always visible) */}
        <div className="px-4 mt-5 space-y-5">
          <div className="text-[13px] text-muted-foreground/30 font-mono tracking-[0.2em]">DESIGN STARTERS</div>
          {Object.entries(DESIGN_STARTERS).map(([category, items]) => (
            <div key={category} className="space-y-1.5">
              <div className="text-[15px] text-muted-foreground/50 font-mono tracking-wide">{CATEGORY_GLYPH[category]} {category}</div>
              <div className="space-y-0.5">
                {items.map(item => (
                  <button key={item.name} onClick={() => { setPrompt(item.prompt); handleGenerate(item.prompt); }}
                    className="block w-full text-left text-[13px] font-mono text-muted-foreground/50 hover:text-primary transition-colors py-1 px-2 rounded-sm hover:bg-card/40">
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Recent Designs */}
        {cadRunHistory.length > 0 && (
          <div className="px-4 mt-5">
            <div className="text-sm text-muted-foreground/40 font-mono tracking-[0.2em] mb-2">RECENT DESIGNS</div>
            <div className="space-y-0.5">
              {cadRunHistory.slice(-5).reverse().map(r => (
                <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 text-[13px] font-mono text-muted-foreground/50 hover:text-foreground hover:bg-card/30 rounded-sm transition-colors cursor-pointer"
                  onClick={() => { setPrompt(r.prompt); }}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.verdict === 'PASS' ? 'bg-emerald-400/50' : r.verdict === 'WARN' ? 'bg-amber-400/50' : 'bg-red-400/50'}`} />
                  <span className="truncate flex-1">{r.prompt}</span>
                  <span className="tabular-nums text-muted-foreground/40 shrink-0">{r.confidence}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom controls (STATE 3 only) */}
        {hasGeometry && (
          <div className="mt-auto px-4 py-3 border-t border-border/15 flex items-center gap-2">
            <button onClick={handleImproveDesign} disabled={loading || !geometry}
              className="flex-1 h-9 inline-flex items-center justify-center gap-1.5 bg-primary/10 text-primary rounded-sm text-sm font-mono hover:bg-primary/20 disabled:opacity-30 transition-all">
              <RefreshCw className="w-3.5 h-3.5" /> IMPROVE DESIGN
            </button>
            <button onClick={handleNewDesign}
              className="h-9 px-2.5 inline-flex items-center justify-center gap-1 border border-border/40 text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-sm text-sm font-mono transition-all">
              <RotateCcw className="w-3.5 h-3.5" /> RESET
            </button>
          </div>
        )}
      </div>

      {/* ── CENTER: Viewport ── */}
      <CADViewport
        geometry={geometry}
        cadPreset={cadPreset}
        cadMaterialId={cadMaterialId}
        setCadMaterialId={setCadMaterialId}
        fitKey={fitKey}
        setFitKey={setFitKey}
        analysis={analysis}
        score={score}
        verdict={verdict}
        loading={loading}
        stages={stages}
        totalTime={totalTime}
        hasGeometry={hasGeometry}
      />

      {/* ── RIGHT: Parametric CAD Controller + Analysis ── */}
      {hasGeometry && analysis ? (
        <div className="flex flex-col border-l border-border/15 bg-card/30 overflow-y-auto">

          {/* ── Tab bar ── */}
          <div className="flex border-b border-border/15 shrink-0">
            <button onClick={() => setRightTab('cad')}
              className={`flex-1 h-10 text-[12px] font-mono tracking-[0.15em] transition-colors ${
                rightTab === 'cad'
                  ? 'text-foreground border-b-2 border-foreground/40 bg-card/40'
                  : 'text-muted-foreground/40 hover:text-muted-foreground/70'
              }`}>CAD</button>
            <button onClick={() => setRightTab('analysis')}
              className={`flex-1 h-10 text-[12px] font-mono tracking-[0.15em] transition-colors ${
                rightTab === 'analysis'
                  ? 'text-foreground border-b-2 border-foreground/40 bg-card/40'
                  : 'text-muted-foreground/40 hover:text-muted-foreground/70'
              }`}>ANALYSIS</button>
          </div>

          {/* ── CAD TAB ── */}
          {rightTab === 'cad' && (
            <div className="p-4 space-y-3">

              {/* ── Feature Tree ── */}
              {featureTree.length > 0 && (
                <div className="border-b border-border/5 pb-2 mb-1">
                  <button onClick={() => setSectionsOpen(s => ({ ...s, _features: !(s._features ?? false) }))}
                    className="w-full flex items-center gap-2 py-1.5 text-[11px] font-mono tracking-[0.15em] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
                    <span className="text-[10px] text-muted-foreground/30">{sectionsOpen._features ? '▾' : '▸'}</span>
                    FEATURE TREE
                  </button>
                  {sectionsOpen._features && (
                    <div className="pl-3 pt-1.5 space-y-1">
                      {featureTree.map(f => (
                        <div key={f.id} onClick={() => setSelectedFeatureId(f.id === selectedFeatureId ? null : f.id)}
                          className={`flex items-center gap-2 py-1 px-2 rounded-sm cursor-pointer transition-colors ${
                            selectedFeatureId === f.id ? 'bg-primary/10 border-l-2 border-primary/50' : 'hover:bg-card/30 border-l-2 border-transparent'
                          }`}>
                          <svg className="w-3 h-3 text-primary/50 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>
                          <span className="text-[11px] font-mono">
                            {selectedFeatureId === f.id && <span className="text-primary text-[9px] mr-1">◆</span>}
                            <span className="text-primary/60 uppercase tracking-wider text-[10px] mr-1.5">{f.type}</span>
                            <span className={selectedFeatureId === f.id ? 'text-primary/90' : 'text-muted-foreground/60'}>{f.label}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Parameters ── */}
              {hasParams && paramEntries ? (
                <div className="space-y-1">
                  {Array.from(new Set(paramEntries.map(e => e.section))).map(sectionKey => {
                    const sectionParams = paramEntries.filter(e => e.section === sectionKey);
                    if (sectionParams.length === 0) return null;
                    const open = sectionsOpen[sectionKey] ?? (sectionKey === 'dimensions');
                    const sectionLabel = SECTION_LABELS[sectionKey] || sectionKey.toUpperCase();

                    return (
                      <div key={sectionKey}>
                        <button onClick={() => setSectionsOpen(s => ({ ...s, [sectionKey]: !(s[sectionKey] ?? sectionKey === 'dimensions') }))}
                          className="w-full flex items-center gap-2 py-1.5 text-[11px] font-mono tracking-[0.15em] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors">
                          <span className="text-[10px] text-muted-foreground/30">{open ? '▾' : '▸'}</span>
                          {sectionLabel}
                          <span className="ml-auto text-[10px] text-muted-foreground/20 tabular-nums">{sectionParams.length}</span>
                        </button>
                        {open && (
                          <div className="space-y-0.5 pt-0.5">
                            {sectionParams.map(e => {
                              const val = paramValues[e.name] ?? String(e.value);
                              const numVal = parseFloat(val) || 0;
                              const bounds = sliderBounds(e.name, val);
                              const pct = bounds.max > bounds.min ? ((numVal - bounds.min) / (bounds.max - bounds.min)) * 100 : 50;
                              return (
                                <div key={e.name} className="group px-2 py-2 rounded-sm hover:bg-card/20 transition-colors">
                                  {/* Label + Value row */}
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[11px] font-mono tracking-wider text-muted-foreground/50 uppercase">{e.label}</span>
                                    <div className="flex items-center gap-1">
                                      {editingParam === e.name ? (
                                        <input type="number" value={numVal} step={bounds.step} min={bounds.min} max={bounds.max}
                                          onChange={v => handleParamChange(e.name, v.target.value)}
                                          onBlur={() => setEditingParam(null)}
                                          onKeyDown={ev => { if (ev.key === 'Enter') setEditingParam(null); }}
                                          autoFocus
                                          className="w-16 h-6 text-right text-[13px] font-mono tabular-nums bg-background border border-primary/40 rounded-sm px-1.5 outline-none" />
                                      ) : (
                                        <span className="text-lg font-semibold font-mono tabular-nums text-foreground/90 cursor-default select-none"
                                          onDoubleClick={() => setEditingParam(e.name)} title="Double-click to edit">
                                          {numVal}<span className="text-sm font-normal text-muted-foreground/40 ml-0.5">{e.unit}</span>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {/* Slider + buttons row */}
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => handleStep(e.name, -bounds.step)}
                                      className="w-5 h-5 flex items-center justify-center text-[11px] text-muted-foreground/20 hover:text-muted-foreground/60 hover:bg-card/40 rounded-sm transition-colors shrink-0">−</button>
                                    <div className="flex-1 min-w-0">
                                      <input type="range" min={bounds.min} max={bounds.max} step={bounds.step} value={numVal}
                                        onChange={v => handleParamChange(e.name, v.target.value)}
                                        style={{ background: `linear-gradient(to right, #3B82F6 0%, #3B82F6 ${pct}%, #E5E7EB ${pct}%, #E5E7EB 100%)` }}
                                        className="w-full h-1.5 appearance-none rounded-full outline-none cursor-pointer
                                          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#3B82F6] [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:duration-150 [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:shadow-lg [&::-webkit-slider-thumb]:active:shadow-blue-500/40
                                          [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#3B82F6] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-track]:bg-transparent" />
                                      <div className="flex justify-between text-[9px] font-mono text-muted-foreground/20 mt-0.5 px-0.5">
                                        <span>{bounds.min}</span>
                                        <span>{bounds.max}</span>
                                      </div>
                                    </div>
                                    <button onClick={() => handleStep(e.name, bounds.step)}
                                      className="w-5 h-5 flex items-center justify-center text-[11px] text-muted-foreground/20 hover:text-muted-foreground/60 hover:bg-card/40 rounded-sm transition-colors shrink-0">+</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="text-[11px] text-muted-foreground/30 font-mono tracking-[0.2em]">GEOMETRY</div>
                  <div className="p-3 border border-border/15 rounded-sm space-y-1.5">
                    <TechRow label="BBox" value={bb ? `${bb.x.toFixed(0)} × ${bb.y.toFixed(0)} × ${bb.z.toFixed(0)} mm` : '—'} />
                    <TechRow label="Volume" value={m?.meshVolumeMm3 != null ? `${Math.round(m.meshVolumeMm3)} mm³` : '—'} />
                    <TechRow label="Wall" value={m?.avgWallThicknessMm != null ? `${m.avgWallThicknessMm.toFixed(1)} mm` : '—'} />
                  </div>
                </div>
              )}

              {/* ── Parameter History + Undo/Redo ── */}
              {paramHistory.length > 0 && (
                <div className="border-t border-border/10 pt-2 mt-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em]">PARAMETER HISTORY</span>
                    <div className="flex items-center gap-0.5">
                      <button onClick={handleUndo} disabled={historyIndex < 0}
                        className={`px-2 py-1 text-[11px] font-mono rounded-sm transition-all ${
                          historyIndex >= 0 ? 'text-muted-foreground/50 hover:text-foreground hover:bg-card/40' : 'text-muted-foreground/10 cursor-default'
                        }`} title="Undo (Ctrl+Z)">↩</button>
                      <button onClick={handleRedo} disabled={historyIndex >= paramHistory.length - 1}
                        className={`px-2 py-1 text-[11px] font-mono rounded-sm transition-all ${
                          historyIndex < paramHistory.length - 1 ? 'text-muted-foreground/50 hover:text-foreground hover:bg-card/40' : 'text-muted-foreground/10 cursor-default'
                        }`} title="Redo (Ctrl+Y)">↪</button>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {paramHistory.slice(-2).reverse().map(entry => {
                      const idx = paramHistory.indexOf(entry);
                      return (
                        <div key={idx} className="text-[11px] font-mono leading-relaxed">
                          {entry.diffs.map(d => (
                            <div key={d.name} className="flex items-center gap-1.5 text-muted-foreground/50">
                              <span className="text-muted-foreground/70 min-w-[60px]">{d.label}</span>
                              <span className="text-muted-foreground/30 line-through">{Number(d.before).toFixed(1)}{d.unit}</span>
                              <span className="text-emerald-400/60">→</span>
                              <span className="text-emerald-400/80 font-medium">{Number(d.after).toFixed(1)}{d.unit}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ── ANALYSIS TAB ── */}
          {rightTab === 'analysis' && (
            <AnalysisSubTabs
              score={score}
              verdict={verdict}
              llmInfo={llmInfo}
              repairInfo={repairInfo}
              gateIssues={gateIssues}
              materialName={materialName}
              bf={bf}
              sp={sp}
              pt={pt}
              m={m}
              t={t}
              v={v}
              bb={bb}
              confidenceReport={confidenceReport}
              optimizationState={optimizationState}
              detailsOpen={detailsOpen}
              setDetailsOpen={setDetailsOpen}
              errorDetails={errorDetails}
              loading={loading}
              handleImproveDesign={handleImproveDesign}
            />
          )}

        </div>
      ) : null}
    </div>
  );
}
