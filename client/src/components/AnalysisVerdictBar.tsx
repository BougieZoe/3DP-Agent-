import { memo } from 'react';
import { DEFAULT_ANALYSIS_THRESHOLDS } from '@/analysis/thresholds';

/**
 * AnalysisVerdictBar — the "first screen" of an analysis.
 *
 * Why this exists: the previous layout opened with four identical empty cards
 * that only carried a word ("CRITICAL") and no number, so a user had to scroll
 * ~600px to find out *what* was critical and *by how much*. This bar answers
 * three questions above the fold, in this order:
 *
 *   1. Is this part printable as-is?      → verdict pill
 *   2. What are the numbers behind that?  → four metric cells
 *   3. What do I do next?                 → up to three ranked actions
 *
 * It deliberately computes NO new score. Every state here is a rollup of a
 * value the analysis pipeline already produced; the thresholds used for the
 * "against what?" column come from the same DEFAULT_ANALYSIS_THRESHOLDS table
 * the analyzer reads, so the bar can never disagree with the engine.
 */

export interface VerdictMetric {
  key: string;
  label: string;
  value: string;
  unit?: string;
  /** Reference the value is judged against, e.g. "< 0.8 mm". */
  against?: string;
  status: 'good' | 'warning' | 'critical' | 'unknown';
  /**
   * Optional drill-down. When present the cell becomes a button that turns the
   * matching 3D overlay on — the number and the evidence it came from are one
   * click apart instead of two tabs apart.
   */
  onActivate?: () => void;
  /** True when the matching overlay is already on, so the cell reads as pressed. */
  active?: boolean;
}

export type VerdictLevel = 'ready' | 'minor' | 'fix' | 'blocked' | 'unknown';

/**
 * A ranked next step. When it carries an `onActivate` it becomes a button that
 * jumps to the evidence (tab + matching 3D overlay); otherwise it stays static
 * prose. Actions without a destination are deliberate: a fake affordance on an
 * action that cannot be located is worse than plain text.
 */
export interface VerdictAction {
  text: string;
  onActivate?: () => void;
  active?: boolean;
}

export interface AnalysisVerdictBarProps {
  fileName: string;
  unitsLabel: string;
  dims: { x: number; y: number; z: number } | null;
  triangleCount: number;
  /** 0..1 — the pipeline's own overall confidence, shown verbatim. */
  confidence: number | null;
  metrics: VerdictMetric[];
  /** Ranked, concrete next actions. Max 3 are rendered. */
  actions: VerdictAction[];
  level: VerdictLevel;
  verdictLabel: string;
  /** Slot for the "replace model" affordance so the page keeps one uploader. */
  replaceSlot?: React.ReactNode;
  onOpenReport?: () => void;
  reportLabel?: string;
  /** Localized "confidence" caption; omitted hides the confidence figure. */
  confidenceLabel?: string;
  /** "FDM · PLA · 50° · mm" — the assumptions this analysis ran under. */
  contextLine?: string;
  /** Localized unit words; English defaults keep the component usable alone. */
  triangleUnitLabel?: string;
  /**
   * Modules that threw. Rendered as a warning strip so a placeholder zero is
   * never read as a measurement.
   */
  moduleErrors?: Array<{ module: string; placeholder: boolean }>;
  moduleErrorsLabel?: string;
}

const LEVEL_STYLE: Record<VerdictLevel, { chip: string; dot: string }> = {
  ready:   { chip: 'border-emerald-400/40 text-emerald-400 bg-emerald-400/5', dot: 'bg-emerald-400' },
  minor:   { chip: 'border-yellow-400/40 text-yellow-400 bg-yellow-400/5',   dot: 'bg-yellow-400' },
  fix:     { chip: 'border-orange-400/45 text-orange-300 bg-orange-400/5',    dot: 'bg-orange-400' },
  blocked: { chip: 'border-red-400/45 text-red-400 bg-red-400/5',             dot: 'bg-red-400' },
  unknown: { chip: 'border-border text-muted-foreground bg-transparent',      dot: 'bg-muted-foreground' },
};

const VALUE_STYLE: Record<VerdictMetric['status'], string> = {
  good: 'text-foreground',
  warning: 'text-yellow-400',
  critical: 'text-red-400',
  unknown: 'text-muted-foreground/50',
};

const DOT_STYLE: Record<VerdictMetric['status'], string> = {
  good: 'bg-emerald-400/80',
  warning: 'bg-yellow-400/80',
  critical: 'bg-red-400/80',
  unknown: 'bg-muted-foreground/30',
};

function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

export const AnalysisVerdictBar = memo(function AnalysisVerdictBar({
  fileName,
  unitsLabel,
  dims,
  triangleCount,
  confidence,
  metrics,
  actions,
  level,
  verdictLabel,
  replaceSlot,
  onOpenReport,
  reportLabel,
  confidenceLabel,
  contextLine,
  triangleUnitLabel = 'tris',
  moduleErrors,
  moduleErrorsLabel,
}: AnalysisVerdictBarProps) {
  const levelStyle = LEVEL_STYLE[level];
  const shownActions = actions.slice(0, 3);

  return (
    <section
      aria-label={fileName}
      className="border border-border rounded-sm bg-card/60 overflow-hidden"
    >
      {/* Identity + verdict */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 border-b border-border/60">
        <span className="w-full sm:w-auto sm:min-w-0 sm:flex-1 truncate text-[13px] font-mono text-foreground" title={fileName}>
          {fileName}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 shrink-0 border rounded-sm px-2 py-0.5 text-[10px] font-mono tracking-widest ${levelStyle.chip}`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${levelStyle.dot}`} />
          {verdictLabel}
        </span>
        {replaceSlot}
      </div>

      {/* Meta line — context, deliberately quiet */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[11px] font-mono text-muted-foreground/50 border-b border-border/40">
        {dims && (
          <span className="tabular-nums">
            {dims.x.toFixed(1)} × {dims.y.toFixed(1)} × {dims.z.toFixed(1)} {unitsLabel}
          </span>
        )}
        <span aria-hidden>·</span>
        <span className="tabular-nums">{formatCount(triangleCount)} {triangleUnitLabel}</span>
        {contextLine && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">{contextLine}</span>
          </>
        )}
        {confidence != null && confidenceLabel && (
          <>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {confidenceLabel} {Math.round(confidence * 100)}%
            </span>
          </>
        )}
      </div>

      {/* The four facts that decide the verdict */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/40">
        {metrics.map((m) => {
          const body = (
            <>
              <dt className="text-[10px] font-mono tracking-widest text-muted-foreground/50 truncate">
                {m.label}
              </dt>
              <dd className="mt-1 flex items-baseline gap-1 min-w-0">
                <span className={`text-[15px] font-mono tabular-nums ${VALUE_STYLE[m.status]}`}>
                  {m.value}
                </span>
                {m.unit && <span className="text-[10px] font-mono text-muted-foreground/40">{m.unit}</span>}
                <span className={`ml-auto inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT_STYLE[m.status]}`} />
              </dd>
              {m.against && (
                <div className="mt-0.5 text-[10px] font-mono text-muted-foreground/35 truncate">
                  {m.against}
                </div>
              )}
            </>
          );
          if (!m.onActivate) {
            return (
              <div key={m.key} className="px-3 py-2.5 min-w-0">
                {body}
              </div>
            );
          }
          return (
            <button
              key={m.key}
              type="button"
              onClick={m.onActivate}
              aria-pressed={!!m.active}
              title={m.label}
              className={`px-3 py-2.5 min-w-0 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary/60 ${
                m.active ? 'bg-primary/[0.06] shadow-[inset_0_-2px_0_0_var(--color-primary)]' : ''
              }`}
            >
              {body}
            </button>
          );
        })}
      </dl>

      {moduleErrors && moduleErrors.length > 0 && (
        <div className="flex items-start gap-2 border-t border-amber-400/20 bg-amber-400/[0.04] px-3 py-2">
          <span className="mt-[3px] shrink-0 text-[10px] text-amber-400">▲</span>
          <p className="min-w-0 text-[11px] font-mono leading-relaxed text-amber-300/80">
            {(moduleErrorsLabel ?? '{n} modules failed: {list}').replace(
              '{list}',
              moduleErrors.map((e) => e.module + (e.placeholder ? '*' : '')).join(', '),
            ).replace('{n}', String(moduleErrors.length))}
          </p>
        </div>
      )}

      {/* What to do about it */}
      {(shownActions.length > 0 || onOpenReport) && (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-border/60 px-3 py-2.5">
          <ul className="min-w-0 flex-1 space-y-1">
            {shownActions.map((action, i) => (
              <li key={i} className="min-w-0">
                {action.onActivate ? (
                  <button
                    type="button"
                    onClick={action.onActivate}
                    aria-pressed={!!action.active}
                    className={`group flex w-full items-start gap-2 rounded-sm text-left text-[11px] font-mono leading-relaxed transition-colors hover:bg-foreground/[0.04] focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary/60 ${
                      action.active ? 'text-primary' : 'text-muted-foreground/75 hover:text-foreground'
                    }`}
                  >
                    <span className="mt-[3px] shrink-0 text-muted-foreground/30 tabular-nums">{i + 1}.</span>
                    <span className="min-w-0 flex-1">{action.text}</span>
                    <span
                      aria-hidden
                      className="mt-[2px] shrink-0 text-[10px] text-muted-foreground/25 transition-colors group-hover:text-primary"
                    >
                      {action.active ? '●' : '◷'}
                    </span>
                  </button>
                ) : (
                  <div className="flex items-start gap-2 text-[11px] font-mono leading-relaxed text-muted-foreground/75">
                    <span className="mt-[3px] shrink-0 text-muted-foreground/30 tabular-nums">{i + 1}.</span>
                    <span className="min-w-0">{action.text}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {onOpenReport && (
            <button
              type="button"
              onClick={onOpenReport}
              className="shrink-0 h-7 px-3 border border-primary/40 text-primary text-[11px] font-mono rounded-sm hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              {reportLabel ?? 'Report →'}
            </button>
          )}
        </div>
      )}
    </section>
  );
});

/**
 * Roll the pipeline's own verdicts into one headline. No arithmetic — a
 * precedence order over states that already exist. `blocked` wins because a
 * non-watertight mesh makes every downstream measurement suspect.
 */
export function deriveVerdict(input: {
  isWatertight: boolean | null;
  isManifold: boolean | null;
  wallStatus: 'good' | 'warning' | 'critical' | null;
  overhangStatus: 'good' | 'warning' | 'critical' | null;
  available: boolean;
}): VerdictLevel {
  // A proven mesh-integrity failure outranks measurement confidence: an open
  // shell is a fact even when the wall-thickness module could not be trusted.
  if (input.isWatertight === false || input.isManifold === false) return 'blocked';
  if (!input.available) return 'unknown';
  if (input.wallStatus === 'critical' || input.overhangStatus === 'critical') return 'fix';
  if (input.wallStatus === 'warning' || input.overhangStatus === 'warning') return 'minor';
  if (input.wallStatus === null || input.overhangStatus === null) return 'unknown';
  return 'ready';
}

/** Threshold labels come from the analyzer's own table, never re-typed. */
export const VERDICT_THRESHOLDS = {
  thinWallMm: DEFAULT_ANALYSIS_THRESHOLDS.wallThickness.thinWallMm,
  overhangDeg: DEFAULT_ANALYSIS_THRESHOLDS.overhangThresholdDeg,
};
