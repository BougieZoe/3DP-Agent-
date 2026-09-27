import { useState, useEffect } from 'react';
import { PANEL } from '@/lib/visualLanguage';
import type { MaterialRecommendation, RecommendationResult } from '@/analysis/materialRecommendation';
import type { MaterialTechnology } from '@shared/domain/material';

interface MaterialRecommendationPanelProps {
  result: RecommendationResult | null;
  onSelectMaterial: (material: MaterialRecommendation['material']) => void;
  isLoading?: boolean;
}

const TECHNOLOGY_OPTIONS: Array<{ value: MaterialTechnology; label: string }> = [
  { value: 'fdm', label: 'FDM' },
  { value: 'sla', label: 'SLA' },
  { value: 'sls', label: 'SLS' },
  { value: 'slm', label: 'SLM' },
  { value: 'fgf', label: 'FGF' },
  { value: 'concrete', label: 'Concrete' },
  { value: 'eco', label: 'Eco' },
];

function getScoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-400';
  if (score >= 50) return 'text-cyan-400';
  if (score >= 30) return 'text-amber-400';
  return 'text-red-400';
}

function getScoreBadgeColor(score: number): string {
  if (score >= 70) return 'bg-emerald-400/10 border-emerald-400/30';
  if (score >= 50) return 'bg-cyan-400/10 border-cyan-400/30';
  if (score >= 30) return 'bg-amber-400/10 border-amber-400/30';
  return 'bg-red-400/10 border-red-400/30';
}

export function MaterialRecommendationPanel({
  result,
  onSelectMaterial,
  isLoading = false,
}: MaterialRecommendationPanelProps) {
  const [selectedTech, setSelectedTech] = useState<MaterialTechnology>('fdm');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className={`${PANEL.bg} backdrop-blur-md ${PANEL.border} ${PANEL.rounded} ${PANEL.padding}`}>
        <div className={`${PANEL.fontLabel} mb-2`}>Material Recommendations</div>
        <div className="flex items-center justify-center h-16">
          <div className="animate-pulse text-muted-foreground/50">Analyzing...</div>
        </div>
      </div>
    );
  }

  if (!result || result.recommendations.length === 0) {
    return (
      <div className={`${PANEL.bg} backdrop-blur-md ${PANEL.border} ${PANEL.rounded} ${PANEL.padding}`}>
        <div className={`${PANEL.fontLabel} mb-2`}>Material Recommendations</div>
        <div className="flex items-center justify-center h-16">
          <span className={`${PANEL.fontTiny} text-muted-foreground/50`}>Load an STL to get recommendations</span>
        </div>
      </div>
    );
  }

  return (
    <div className="backdrop-blur-xl bg-background/60 border border-border/30 rounded-md p-3 space-y-3 shadow-lg shadow-black/20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className={PANEL.fontLabel}>Material Recommendations</span>
        <span className={`${PANEL.fontTiny} text-muted-foreground/30`}>
          {result.recommendations.length} found
        </span>
      </div>

      {/* Technology filter */}
      <div className="flex gap-1 flex-wrap">
        {TECHNOLOGY_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`${PANEL.chip} border transition-all duration-200 ${
              selectedTech === opt.value
                ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-400 shadow-sm shadow-cyan-400/10'
                : 'border-border/30 text-muted-foreground/40 hover:border-border/60 hover:text-muted-foreground/60'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Recommendations */}
      <div className="space-y-2">
        {result.recommendations.map((rec, idx) => (
          <div
            key={rec.material.name}
            className={`border rounded-md p-2 transition-all duration-200 cursor-pointer ${
              expandedIndex === idx
                ? 'border-cyan-400/30 bg-cyan-400/5'
                : 'border-border/20 hover:border-border/40'
            }`}
            onClick={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
          >
            {/* Material header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`${PANEL.fontLabel} font-medium`}>{rec.material.name}</span>
                <span className={`${PANEL.fontTiny} text-muted-foreground/50`}>
                  ${rec.material.pricePerKgUsd}/kg
                </span>
              </div>
              <div className={`px-2 py-0.5 rounded border ${getScoreBadgeColor(rec.score)}`}>
                <span className={`${PANEL.fontTiny} font-mono ${getScoreColor(rec.score)}`}>
                  {Math.round(rec.score)}
                </span>
              </div>
            </div>

            {/* Reasons */}
            {rec.reasons.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {rec.reasons.map((reason, i) => (
                  <span key={i} className={`${PANEL.fontTiny} text-emerald-400/70`}>
                    {reason}
                  </span>
                ))}
              </div>
            )}

            {/* Warnings */}
            {rec.warnings.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {rec.warnings.map((warning, i) => (
                  <span key={i} className={`${PANEL.fontTiny} text-amber-400/70`}>
                    {warning}
                  </span>
                ))}
              </div>
            )}

            {/* Expanded details */}
            {expandedIndex === idx && (
              <div className="mt-2 pt-2 border-t border-border/20 space-y-2">
                <div className={`${PANEL.fontTiny} text-muted-foreground/60`}>
                  {rec.material.description}
                </div>
                
                {/* Properties */}
                <div className="grid grid-cols-2 gap-1">
                  {rec.material.tensileStrengthMPa && (
                    <div className={`${PANEL.fontTiny}`}>
                      <span className="text-muted-foreground/40">Strength: </span>
                      <span className="text-cyan-400/80">{rec.material.tensileStrengthMPa} MPa</span>
                    </div>
                  )}
                  {rec.material.glassTransitionTempC && (
                    <div className={`${PANEL.fontTiny}`}>
                      <span className="text-muted-foreground/40">Tg: </span>
                      <span className="text-cyan-400/80">{rec.material.glassTransitionTempC}°C</span>
                    </div>
                  )}
                  {rec.material.shrinkagePercent !== undefined && rec.material.shrinkagePercent !== null && (
                    <div className={`${PANEL.fontTiny}`}>
                      <span className="text-muted-foreground/40">Shrinkage: </span>
                      <span className="text-cyan-400/80">{rec.material.shrinkagePercent}%</span>
                    </div>
                  )}
                </div>

                {/* Select button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectMaterial(rec.material);
                  }}
                  className="w-full px-3 py-1.5 bg-cyan-400/10 border border-cyan-400/30 rounded text-cyan-400 text-sm hover:bg-cyan-400/20 transition-colors"
                >
                  Select {rec.material.name}
                </button>

                {/* Alternatives */}
                {rec.alternatives.length > 0 && (
                  <div className="mt-2">
                    <div className={`${PANEL.fontTiny} text-muted-foreground/40 mb-1`}>Alternatives:</div>
                    <div className="flex gap-1">
                      {rec.alternatives.map(alt => (
                        <button
                          key={alt.name}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectMaterial(alt);
                          }}
                          className={`${PANEL.chip} border border-border/30 text-muted-foreground/60 hover:border-cyan-400/30 hover:text-cyan-400`}
                        >
                          {alt.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Filter info */}
      {result.filters.excludedCount > 0 && (
        <div className={`${PANEL.fontTiny} text-muted-foreground/30`}>
          {result.filters.excludedCount} materials filtered out
        </div>
      )}
    </div>
  );
}
