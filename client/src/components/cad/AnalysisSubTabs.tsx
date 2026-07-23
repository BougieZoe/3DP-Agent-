import { useState } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { CADConfidenceReport, Issue as ConfidenceIssue } from "@/cad-confidence";

type AnalysisSubTab = "overview" | "geometry" | "manufacturing" | "risks";

interface AnalysisSubTabsProps {
  score: number;
  verdict: string;
  llmInfo: string;
  repairInfo: { repaired: boolean; repairType: string; attempts: number } | null;
  gateIssues: ConfidenceIssue[];
  materialName: string;
  bf: any;
  sp: any;
  pt: any;
  m: any;
  t: any;
  v: any;
  bb: { x: number; y: number; z: number } | undefined;
  confidenceReport: CADConfidenceReport | null;
  optimizationState: any;
  detailsOpen: boolean;
  setDetailsOpen: (v: boolean | ((v: boolean) => boolean)) => void;
  errorDetails: string | null;
  loading: boolean;
  handleImproveDesign: () => void;
}

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function TechRow({ label, value, badge }: { label: string; value: string | number | undefined | null; badge?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-muted-foreground/50 uppercase tracking-wider shrink-0">{label}</span>
      <span className="text-muted-foreground/70 tabular-nums text-right">
        {String(value ?? '—')}
        {badge && (
          <span className={`ml-1 text-[11px] px-1 py-0.5 rounded-sm border ${
            badge === 'pass' || badge === 'low' || badge === 'none' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
            badge === 'fail' || badge === 'high' || badge === 'severe' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
            'bg-amber-500/20 text-amber-400 border-amber-500/30'
          }`}>{badge}</span>
        )}
      </span>
    </div>
  );
}

const SUB_TABS: { id: AnalysisSubTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "geometry", label: "Geometry" },
  { id: "manufacturing", label: "Mfg" },
  { id: "risks", label: "Risks" },
];

export function AnalysisSubTabs(props: AnalysisSubTabsProps) {
  const [subTab, setSubTab] = useState<AnalysisSubTab>("overview");
  const { score, verdict, llmInfo, repairInfo, gateIssues, materialName, bf, sp, pt, m, t, v, bb, confidenceReport, optimizationState, detailsOpen, setDetailsOpen, errorDetails, loading, handleImproveDesign } = props;

  return (
    <div className="p-4 space-y-4">
      {/* Sub-tab bar */}
      <div className="flex border-b border-border/15 -mx-4 px-4">
        {SUB_TABS.map(tab => (
          <button key={tab.id} onClick={() => setSubTab(tab.id)}
            className={`pb-2 px-2 text-[11px] font-mono tracking-[0.15em] transition-colors border-b-2 ${
              subTab === tab.id
                ? 'text-foreground border-foreground/40'
                : 'text-muted-foreground/40 border-transparent hover:text-muted-foreground/70'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {subTab === "overview" && (
        <div className="space-y-4">
          {/* Hero score */}
          <div className="text-center">
            <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em] mb-1.5">MANUFACTURING CONFIDENCE</div>
            <span className="text-4xl font-bold font-mono tabular-nums tracking-tight" style={{ color: scoreColor(score) }}>{score}%</span>
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-sm border mt-2 text-[12px] font-bold font-mono ${
              verdict === 'PASS' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' :
              verdict === 'WARN' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10' :
              'border-red-500/30 text-red-400 bg-red-500/10'
            }`}>
              {verdict === 'PASS' ? <CheckCircle2 className="w-3 h-3" /> : verdict === 'WARN' ? <AlertTriangle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
              <span>{verdict}</span>
            </div>
          </div>

          {/* Model Source + Auto Repair */}
          {llmInfo && (
            <div className="text-center">
              <span className={`text-[10px] font-mono tracking-[0.2em] px-2 py-0.5 rounded-sm border ${
                llmInfo.startsWith('Template:') ? 'text-amber-400/60 border-amber-400/20 bg-amber-400/5' : 'text-primary/60 border-primary/20 bg-primary/5'
              }`}>
                {llmInfo.startsWith('Template:') ? 'TEMPLATE' : 'AI GENERATED'}
              </span>
              {repairInfo && (
                <div className="mt-1">
                  <span className={`text-[10px] font-mono tracking-[0.15em] px-2 py-0.5 rounded-sm border ${
                    repairInfo.repaired
                      ? repairInfo.repairType === 'fillet' ? 'text-emerald-400/60 border-emerald-400/20 bg-emerald-400/5'
                      : 'text-amber-400/60 border-amber-400/20 bg-amber-400/5'
                      : 'text-muted-foreground/30 border-muted-foreground/10'
                  }`}>
                    {repairInfo.repaired
                      ? `AUTO REPAIR · ${repairInfo.repairType.toUpperCase()} · ${repairInfo.attempts} ATTEMPT${repairInfo.attempts !== 1 ? 'S' : ''}`
                      : 'AUTO REPAIR · NOT NEEDED'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Print Check */}
          <div className="space-y-1.5">
            <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em]">PRINT CHECK</div>
            <div className="p-2.5 border border-border/15 rounded-sm space-y-1">
              <TechRow label="Bed fit" value={bf ? (bf.fits ? `✓ ${bf.printerProfile.name}` : `✗ ${bf.printerProfile.name}`) : '—'} badge={bf?.fits ? 'pass' : bf?.fits === false ? 'fail' : undefined} />
              <TechRow label="Material" value={materialName || '—'} />
              <TechRow label="Support" value={sp?.totalSupportVolumeMm3 != null ? `${Math.round(sp.totalSupportVolumeMm3)} mm³` : '—'} />
              <TechRow label="Print time" value={pt ? `${pt.estimatedPrintTimeHours.toFixed(1)} h` : '—'} />
              <TechRow label="Material wt" value={pt ? `${pt.materialWeightGrams.toFixed(1)} g` : '—'} />
              <TechRow label="Cost" value={pt ? `$${pt.materialCostUsd.toFixed(2)}` : '—'} />
            </div>
          </div>

          {/* Key Issues */}
          {gateIssues.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em]">KEY ISSUES</div>
              {gateIssues.slice(0, 3).map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-[12px] font-mono leading-relaxed">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${
                    issue.severity === 'error' ? 'bg-red-400' : issue.severity === 'warning' ? 'bg-amber-400' : 'bg-emerald-400'
                  }`} />
                  <span className="text-muted-foreground/60">{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* IMPROVE DESIGN */}
          <button onClick={handleImproveDesign} disabled={loading}
            className="w-full h-9 inline-flex items-center justify-center gap-2 bg-foreground text-background rounded-sm text-sm font-mono font-bold hover:bg-foreground/90 disabled:opacity-30 transition-all">
            <RefreshCw className="w-4 h-4" /> IMPROVE DESIGN
          </button>

          {/* Optimization State */}
          {optimizationState && (
            <div className="space-y-2 p-3 border border-primary/15 bg-primary/5 rounded-sm">
              <div className="text-sm text-muted-foreground/50 font-mono tracking-wider">AI OPTIMIZATION</div>
              <div className="text-[13px] text-primary/90 font-mono">
                {optimizationState.plan.action === 'wall_thickening' ? 'Thicken walls' :
                 optimizationState.plan.action === 'orientation_change' ? 'Rotate orientation' : 'No action needed'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── GEOMETRY ── */}
      {subTab === "geometry" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 border border-border/15 rounded-sm">
              <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em] mb-2">TOPOLOGY</div>
              <div className="space-y-1.5">
                <TechRow label="Tri" value={t?.triangleCount} />
                <TechRow label="Verts" value={t?.vertexCount} />
                <TechRow label="Shells" value={t?.shellCount} />
                <TechRow label="Manifold" value={t?.isManifold ? '✓' : '✗'} badge={t?.isManifold ? 'pass' : 'fail'} />
                <TechRow label="Watertight" value={v?.isWatertight ? '✓' : '✗'} badge={v?.isWatertight ? 'pass' : 'fail'} />
                <TechRow label="Holes" value={v?.holeCount} />
              </div>
            </div>
            <div className="p-3 border border-border/15 rounded-sm">
              <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em] mb-2">METRICS</div>
              <div className="space-y-1.5">
                <TechRow label="Volume" value={m?.meshVolumeMm3 != null ? `${Math.round(m.meshVolumeMm3)} mm³` : '—'} />
                <TechRow label="Surface" value={m?.surfaceAreaMm2 != null ? `${Math.round(m.surfaceAreaMm2)} mm²` : '—'} />
                {bb && <TechRow label="BBox" value={`${bb.x.toFixed(0)} × ${bb.y.toFixed(0)} × ${bb.z.toFixed(0)} mm`} />}
                <TechRow label="Avg wall" value={m?.avgWallThicknessMm != null ? `${m.avgWallThicknessMm.toFixed(1)} mm` : '—'} />
                <TechRow label="Min wall" value={m?.minWallThicknessMm != null ? `${m.minWallThicknessMm.toFixed(1)} mm` : '—'} />
                <TechRow label="Overhang" value={m?.overhang?.severity ?? '—'} badge={m?.overhang?.severity} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MANUFACTURING ── */}
      {subTab === "manufacturing" && (
        <div className="space-y-3">
          <div className="p-3 border border-border/15 rounded-sm space-y-1.5">
            <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em] mb-2">PRINTABILITY</div>
            {sp && <TechRow label="Support" value={sp.totalSupportVolumeMm3 != null ? `${Math.round(sp.totalSupportVolumeMm3)} mm³` : '—'} />}
            {sp && <TechRow label="Difficulty" value={sp.difficulty ?? '—'} badge={sp.difficulty} />}
            {bf && <TechRow label="Bed" value={bf.fits ? `✓ ${bf.printerProfile.name}` : `✗ ${bf.printerProfile.name}`} badge={bf.fits ? 'pass' : 'fail'} />}
            {pt && <TechRow label="Time" value={`${pt.estimatedPrintTimeHours.toFixed(1)} h`} />}
            {pt && <TechRow label="Material" value={`${pt.materialWeightGrams.toFixed(1)} g`} />}
            {pt && <TechRow label="Cost" value={`$${pt.materialCostUsd.toFixed(2)}`} />}
            {bf && <TechRow label="Bed size" value={`${bf.printerProfile.widthMm}×${bf.printerProfile.depthMm}×${bf.printerProfile.heightMm} mm`} />}
          </div>
        </div>
      )}

      {/* ── RISKS ── */}
      {subTab === "risks" && (
        <div className="space-y-3">
          {confidenceReport?.risks && (
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center rounded-sm p-3 border border-border/20">
                <span className={`w-2 h-2 rounded-full inline-block mb-1 ${confidenceReport.risks.structural.level === 'LOW' ? 'bg-emerald-400' : confidenceReport.risks.structural.level === 'MEDIUM' ? 'bg-amber-400' : 'bg-red-400'}`} />
                <div className="text-[11px] text-muted-foreground/40 font-mono tracking-wider">STRUCTURAL</div>
                <div className={`text-lg font-bold font-mono ${confidenceReport.risks.structural.level === 'LOW' ? 'text-emerald-400' : confidenceReport.risks.structural.level === 'MEDIUM' ? 'text-amber-400' : 'text-red-400'}`}>
                  {confidenceReport.risks.structural.level}
                </div>
              </div>
              <div className="text-center rounded-sm p-3 border border-border/20">
                <span className={`w-2 h-2 rounded-full inline-block mb-1 ${confidenceReport.risks.print.level === 'LOW' ? 'bg-emerald-400' : confidenceReport.risks.print.level === 'MEDIUM' ? 'bg-amber-400' : 'bg-red-400'}`} />
                <div className="text-[11px] text-muted-foreground/40 font-mono tracking-wider">PRINT</div>
                <div className={`text-lg font-bold font-mono ${confidenceReport.risks.print.level === 'LOW' ? 'text-emerald-400' : confidenceReport.risks.print.level === 'MEDIUM' ? 'text-amber-400' : 'text-red-400'}`}>
                  {confidenceReport.risks.print.level}
                </div>
              </div>
              <div className="text-center rounded-sm p-3 border border-border/20">
                <span className={`w-2 h-2 rounded-full inline-block mb-1 ${confidenceReport.risks.manufacturing.level === 'LOW' ? 'bg-emerald-400' : confidenceReport.risks.manufacturing.level === 'MEDIUM' ? 'bg-amber-400' : 'bg-red-400'}`} />
                <div className="text-[11px] text-muted-foreground/40 font-mono tracking-wider">MFG</div>
                <div className={`text-lg font-bold font-mono ${confidenceReport.risks.manufacturing.level === 'LOW' ? 'text-emerald-400' : confidenceReport.risks.manufacturing.level === 'MEDIUM' ? 'text-amber-400' : 'text-red-400'}`}>
                  {confidenceReport.risks.manufacturing.level}
                </div>
              </div>
            </div>
          )}

          {confidenceReport?.repairSuggestions && confidenceReport.repairSuggestions.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em]">REPAIR SUGGESTIONS</div>
              {confidenceReport.repairSuggestions.map((s, i) => (
                <div key={i} className="border border-border/15 rounded-sm p-2.5">
                  <div className="flex items-start gap-2">
                    <span className={`text-[10px] font-mono px-1 py-0.5 rounded-sm border shrink-0 mt-0.5 ${
                      s.impact === 'high' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                      s.impact === 'medium' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                      'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    }`}>{s.impact.toUpperCase()}</span>
                    <div>
                      <div className="text-[12px] text-foreground/70">{s.action}</div>
                      <div className="text-[11px] text-muted-foreground/50 mt-0.5">{s.description}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Expandable full report */}
          <button onClick={() => setDetailsOpen(v => !v)}
            className="w-full h-8 inline-flex items-center justify-center gap-1 border border-border/40 text-muted-foreground hover:text-foreground text-[11px] font-mono rounded-sm transition-all">
            {detailsOpen ? '— HIDE' : '+ VIEW FULL REPORT'}
          </button>
          {detailsOpen && confidenceReport?.explanation?.topRisks && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-muted-foreground/40 font-mono tracking-[0.2em]">RISK ANALYSIS</div>
              {confidenceReport.explanation.topRisks.map((risk, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${risk.impact === 'high' ? 'bg-red-400' : risk.impact === 'medium' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                  <span className="text-muted-foreground/60">{risk.reason}</span>
                </div>
              ))}
            </div>
          )}
          {detailsOpen && errorDetails && (
            <div className="p-2.5 border border-border/15 rounded-sm text-[11px] font-mono text-muted-foreground/40 leading-relaxed whitespace-pre-wrap max-h-[150px] overflow-y-auto">
              {errorDetails}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
