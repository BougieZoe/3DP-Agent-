import { useState } from 'react';
import { PANEL } from '@/lib/visualLanguage';
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

const FIT_STYLES: Record<ProcessRecommendation['fit'], { badge: string; border: string; bar: string }> = {
  optimal:    { badge: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', border: 'border-emerald-400/20', bar: 'bg-emerald-400' },
  viable:     { badge: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30',       border: 'border-cyan-400/20',   bar: 'bg-cyan-400' },
  marginal:   { badge: 'text-amber-400 bg-amber-400/10 border-amber-400/30',     border: 'border-amber-400/20',  bar: 'bg-amber-400' },
  'not-recommended': { badge: 'text-red-400 bg-red-400/10 border-red-400/30',    border: 'border-red-400/10',    bar: 'bg-red-400' },
};

function ShortName(name: string): string {
  const m = name.match(/^([A-Z]+)/);
  return m ? m[1] : name.split(' ')[0];
}

export function ManufacturingRecommendationPanel({
  recommendations,
  selectedGoal,
  onGoalChange,
}: ManufacturingRecommendationPanelProps) {
  const [topIndex, setTopIndex] = useState(0);

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

  const rotate = () => setTopIndex(i => (i + 1) % recommendations.length);

  const visible = recommendations.length <= 3
    ? recommendations
    : [0, 1, 2].map(offset => recommendations[(topIndex + offset) % recommendations.length]);

  return (
    <div className={`${PANEL.bg} ${PANEL.glass} ${PANEL.border} ${PANEL.rounded} ${PANEL.padding} space-y-3`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className={PANEL.fontLabel}>MANUFACTURING RECOMMENDATIONS</span>
        {recommendations.length > 1 && (
          <span className={`${PANEL.fontTiny} text-muted-foreground/30`}>
            {topIndex + 1}/{recommendations.length}
          </span>
        )}
      </div>

      {/* Goal selector */}
      <div className="flex gap-1 flex-wrap">
        {GOAL_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => { onGoalChange(opt.value); setTopIndex(0); }}
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

      {/* Card stack */}
      <div className="relative" style={{ minHeight: recommendations.length > 1 ? 180 : 140 }}>
        {visible.map((rec, stackPos) => {
          const styles = FIT_STYLES[rec.fit];
          const isTop = stackPos === 0;
          const offset = stackPos;
          const scale = 1 - offset * 0.03;
          const translateY = offset * 8;

          return (
            <div
              key={`${rec.processId}-${topIndex}-${stackPos}`}
              onClick={isTop && recommendations.length > 1 ? rotate : undefined}
              className={`absolute inset-0 ${PANEL.glass} border ${styles.border} ${PANEL.rounded} transition-all duration-300 ease-out ${
                isTop ? 'cursor-pointer hover:border-foreground/30' : ''
              }`}
              style={{
                transform: `translateY(${translateY}px) scale(${scale})`,
                zIndex: 10 - offset,
                opacity: offset === 0 ? 1 : offset === 1 ? 0.6 : 0.3,
              }}
            >
              <div className={`${PANEL.paddingCard} space-y-2`}>
                {/* Name + badge row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`${PANEL.fontSmall} text-foreground/80 font-medium`}>{ShortName(rec.processName)}</span>
                    <span className={`${PANEL.fontTiny} text-muted-foreground/30 hidden sm:inline`}>
                      {rec.processName.replace(/^[^(]+\(/, '').replace(/\)$/, '')}
                    </span>
                  </div>
                  <span className={`${PANEL.chip} border ${styles.badge}`}>
                    {rec.fit.toUpperCase()}
                  </span>
                </div>

                {/* Confidence bar */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 bg-border/30 rounded-full overflow-hidden">
                    <div className={`h-full ${styles.bar} rounded-full transition-all duration-500`}
                         style={{ width: `${Math.round(rec.confidence * 100)}%` }} />
                  </div>
                  <span className={`${PANEL.fontTiny} text-muted-foreground/40 w-8 text-right`}>
                    {Math.round(rec.confidence * 100)}%
                  </span>
                </div>

                {/* Details — only on top card */}
                {isTop && (
                  <>
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
                    <div className="flex flex-wrap gap-1">
                      {rec.materialExamples.slice(0, 5).map(m => (
                        <span key={m} className={`${PANEL.chip} border border-border/20 text-muted-foreground/40`}>{m}</span>
                      ))}
                    </div>
                    {recommendations.length > 1 && (
                      <div className={`${PANEL.fontTiny} text-muted-foreground/20 text-center pt-1`}>
                        click to see next →
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
