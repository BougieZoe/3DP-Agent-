import { PANEL, COLORS } from '@/lib/visualLanguage';
import type { ProcessRecommendation, ManufacturingGoal } from '@/lib/manufacturingRecommendation';

interface ManufacturingRecommendationPanelProps {
  recommendations: ProcessRecommendation[];
  selectedGoal: ManufacturingGoal;
  onGoalChange: (goal: ManufacturingGoal) => void;
  language?: string;
}

const GOAL_OPTIONS: Array<{ value: ManufacturingGoal; label: string }> = [
  { value: 'prototype', label: 'PROTOTYPE' },
  { value: 'production', label: 'PRODUCTION' },
  { value: 'large-format', label: 'LARGE FORMAT' },
  { value: 'high-detail', label: 'HIGH DETAIL' },
];

const FIT_STYLES: Record<ProcessRecommendation['fit'], { badge: string; border: string }> = {
  optimal:    { badge: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', border: 'border-emerald-400/20' },
  viable:     { badge: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30',       border: 'border-cyan-400/20' },
  marginal:   { badge: 'text-amber-400 bg-amber-400/10 border-amber-400/30',     border: 'border-amber-400/20' },
  'not-recommended': { badge: 'text-red-400 bg-red-400/10 border-red-400/30',    border: 'border-red-400/10' },
};

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = confidence >= 0.7 ? 'bg-emerald-400' : confidence >= 0.5 ? 'bg-cyan-400' : confidence >= 0.3 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="w-full h-1 bg-border/30 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ManufacturingRecommendationPanel({
  recommendations,
  selectedGoal,
  onGoalChange,
}: ManufacturingRecommendationPanelProps) {
  if (!recommendations || recommendations.length === 0) {
    return (
      <div className={`${PANEL.bg} ${PANEL.glass} ${PANEL.border} ${PANEL.rounded} ${PANEL.padding}`}>
        <div className={`${PANEL.fontLabel} mb-2`}>MANUFACTURING RECOMMENDATIONS</div>
        <div className="flex items-center justify-center h-16">
          <span className={`${PANEL.fontTiny} text-muted-foreground/50`}>Upload a model to see process recommendations</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${PANEL.bg} ${PANEL.glass} ${PANEL.border} ${PANEL.rounded} ${PANEL.padding} space-y-3`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className={PANEL.fontLabel}>MANUFACTURING RECOMMENDATIONS</span>
      </div>

      {/* Goal selector */}
      <div className="flex gap-1 flex-wrap">
        {GOAL_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => onGoalChange(opt.value)}
            className={`${PANEL.chip} border transition-colors ${
              selectedGoal === opt.value
                ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-400'
                : 'border-border/30 text-muted-foreground/40 hover:border-border/60 hover:text-muted-foreground/60'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Process cards */}
      <div className="space-y-2">
        {recommendations.map(rec => {
          const styles = FIT_STYLES[rec.fit];
          return (
            <div
              key={rec.processId}
              className={`${PANEL.borderSubtle} ${PANEL.roundedInner} ${PANEL.paddingCard} border-l-2 ${styles.border} space-y-2`}
            >
              {/* Row 1: name + fit badge */}
              <div className="flex items-center justify-between">
                <span className={`${PANEL.fontSmall} text-foreground/80`}>{rec.processName}</span>
                <span className={`${PANEL.chip} border ${styles.badge}`}>
                  {rec.fit.toUpperCase()}
                </span>
              </div>

              {/* Confidence bar */}
              <div className="flex items-center gap-2">
                <ConfidenceBar confidence={rec.confidence} />
                <span className={`${PANEL.fontTiny} text-muted-foreground/40`}>{Math.round(rec.confidence * 100)}%</span>
              </div>

              {/* Reasons */}
              {rec.reasons.length > 0 && (
                <div className="space-y-0.5">
                  {rec.reasons.map((r, i) => (
                    <div key={i} className={`${PANEL.fontTiny} text-emerald-400/70 flex items-start gap-1`}>
                      <span className="text-emerald-400/40 shrink-0">+</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Warnings */}
              {rec.warnings.length > 0 && (
                <div className="space-y-0.5">
                  {rec.warnings.map((w, i) => (
                    <div key={i} className={`${PANEL.fontTiny} text-amber-400/70 flex items-start gap-1`}>
                      <span className="text-amber-400/40 shrink-0">!</span>
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Materials */}
              <div className="flex flex-wrap gap-1">
                {rec.materialExamples.slice(0, 5).map(m => (
                  <span key={m} className={`${PANEL.chip} border border-border/20 text-muted-foreground/40`}>{m}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
