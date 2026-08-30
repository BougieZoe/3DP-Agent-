import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import { GeometrySuggestion } from './counterfactualEngine';
import { PANEL, SEMANTIC } from '@/lib/visualLanguage';

interface GeometrySuggestionPanelProps {
  suggestions: GeometrySuggestion[];
  selectedSuggestionId: string | null;
  onSelectSuggestion: (id: string | null) => void;
  language?: ContentLang;
  onDownload?: (suggestion: GeometrySuggestion) => void;
  downloadingId?: string | null;
}

const TYPE_ICON_MAP: Record<string, string> = {
  thicken_wall:    SEMANTIC.suggestionIcon.thickenWall,
  reduce_overhang: SEMANTIC.suggestionIcon.reduceOverhang,
  add_support:     SEMANTIC.suggestionIcon.addSupport,
  split_bridge:    SEMANTIC.suggestionIcon.splitBridge,
  hollow_region:   SEMANTIC.suggestionIcon.hollowRegion,
};

/**
 * Collapse repeated pattern names into one entry per distinct type with its
 * occurrence count (most common first), so a card shows e.g.
 * "Thermal Trap Cavity ×17" instead of 17 identical tags.
 */
function groupPatternNames(names: string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  const color = value > 0 ? SEMANTIC.delta.improvement : value < 0 ? SEMANTIC.delta.regression : SEMANTIC.delta.neutral;
  return <span className={`${PANEL.fontTiny} ${color}`}>{value > 0 ? '+' : ''}{value}{suffix}</span>;
}

function SuggestionCard({ suggestion, selected, onSelect, onDownload, onRecalc, recalc, downloading, language }: {
  suggestion: GeometrySuggestion;
  selected: boolean;
  onSelect: () => void;
  onDownload?: (s: GeometrySuggestion) => void;
  onRecalc?: (s: GeometrySuggestion) => void;
  recalc?: { beforeThin: number; afterThin: number; riskBefore: number; riskAfter: number } | null;
  downloading?: boolean;
  language: ContentLang;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left ${PANEL.paddingCard} ${PANEL.roundedInner} ${PANEL.borderSubtle} transition-all ${
        selected
          ? `${PANEL.selectedBorder} ${PANEL.selectedBg}`
          : 'border-transparent hover:border-border/50'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs text-muted-foreground/50`}>{TYPE_ICON_MAP[suggestion.type] ?? '\u25CF'}</span>
        <span className={`${PANEL.fontSmall} text-foreground/80`}>{suggestion.label}</span>
        <span className={`ml-auto ${PANEL.fontValue} text-muted-foreground/40`}>
          {suggestion.confidence}% {translate(CONTENT, 'causality.confidence', language)}
        </span>
      </div>

      <div className={`${PANEL.fontTiny} text-muted-foreground/60 mb-2 leading-tight`}>
        {suggestion.description}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2">
        <div className={`${PANEL.borderSubtle} ${PANEL.roundedInner} p-1.5`}>
          <div className={`${PANEL.fontTiny} text-muted-foreground/40`}>{translate(CONTENT, 'causality.metric.risk', language)}</div>
          <Delta value={suggestion.riskReduction} suffix="%" />
        </div>
        <div className={`${PANEL.borderSubtle} ${PANEL.roundedInner} p-1.5`}>
          <div className={`${PANEL.fontTiny} text-muted-foreground/40`}>{translate(CONTENT, 'causality.metric.thermal', language)}</div>
          <Delta value={suggestion.thermalImprovement} suffix="%" />
        </div>
        <div className={`${PANEL.borderSubtle} ${PANEL.roundedInner} p-1.5`}>
          <div className={`${PANEL.fontTiny} text-muted-foreground/40`}>{translate(CONTENT, 'causality.metric.support', language)}</div>
          <Delta value={suggestion.supportChange} suffix="%" />
        </div>
      </div>

      {suggestion.patternImpact.length > 0 && (
        <div className="space-y-0.5 mb-2">
          {groupPatternNames(suggestion.patternImpact).map(({ name, count }) => (
            <div key={name} className="flex items-center gap-1.5">
              <span className={`${PANEL.chip} ${SEMANTIC.delta.improvementChip}`}>{name}</span>
              <span className={`${PANEL.fontTiny} text-muted-foreground/40`}>×{count}</span>
            </div>
          ))}
        </div>
      )}

      {suggestion.chainComparison.length > 0 && (
        <div className={`${PANEL.borderSubtle} pt-1.5 mt-1 border-t-0 border-l-0 border-r-0`}>
          <div className={`${PANEL.fontTiny} text-muted-foreground/30 mb-1`}>{translate(CONTENT, 'causality.consequenceChain', language)}</div>
          <div className="space-y-0.5">
            {suggestion.chainComparison.map(c => (
              <div key={c.eventId} className={`flex items-center gap-2 ${PANEL.fontTiny}`}>
                <span className="text-muted-foreground/50 flex-1 truncate">{c.label}</span>
                <span className="text-muted-foreground/40">{c.before}%</span>
                <span className={SEMANTIC.chain.arrow}>{'\u2192'}</span>
                <span className={
                  c.after < c.before ? SEMANTIC.chain.improvement
                    : c.after > c.before ? SEMANTIC.chain.regression
                    : SEMANTIC.chain.neutral
                }>
                  {c.after}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 自适应对比 — 选中后先看 12→2，再决定下载 */}
      {selected && (
        <div className="mt-2 space-y-1.5">
          {onRecalc && !recalc && (
            <button
              onClick={(e) => { e.stopPropagation(); onRecalc(suggestion) }}
              className="w-full text-xs font-mono py-1.5 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-border/60 bg-background/40"
            >
              ↻ Preview Fix (thin walls before→after)
            </button>
          )}
          {recalc && (
            <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
              <div className={`${PANEL.borderSubtle} ${PANEL.roundedInner} p-1.5 bg-background/40`}>
                <div className="text-muted-foreground/40">Thin walls</div>
                <div className="text-foreground">{recalc.beforeThin} → <span className="text-emerald-400">{recalc.afterThin}</span></div>
              </div>
              <div className={`${PANEL.borderSubtle} ${PANEL.roundedInner} p-1.5 bg-background/40`}>
                <div className="text-muted-foreground/40">Failure risk</div>
                <div className="text-foreground">{recalc.riskBefore}% → <span className={recalc.riskAfter < recalc.riskBefore ? 'text-cyan-400' : 'text-muted-foreground'}>{recalc.riskAfter}%</span></div>
              </div>
            </div>
          )}
          {onDownload && (
            <button
              onClick={(e) => { e.stopPropagation(); onDownload(suggestion) }}
              disabled={!!downloading}
              className={`w-full text-xs font-mono py-2 rounded-sm border transition-all ${
                downloading ? 'border-border text-muted-foreground/40 bg-muted/10' : 'border-cyan-400/40 text-cyan-400 hover:bg-cyan-400 hover:text-black bg-cyan-400/5'
              }`}
            >
              {downloading ? '▋ repairing...' : '⬇ Download Repaired STL'}
            </button>
          )}
        </div>
      )}
    </button>
  );
}

export function GeometrySuggestionPanel({ suggestions, selectedSuggestionId, onSelectSuggestion, language = 'en', onDownload, onRecalc, recalcMap, downloadingId }: GeometrySuggestionPanelProps & { onRecalc?: (s: GeometrySuggestion)=>void; recalcMap?: Map<string, { beforeThin:number; afterThin:number; riskBefore:number; riskAfter:number }> }) {
  if (suggestions.length === 0) {
    return (
      <div className="pt-4 space-y-4">
        <div className={PANEL.fontLabel}>{translate(CONTENT, 'causality.suggestionsHeader', language)}</div>
        <div className={`${PANEL.fontTiny} text-muted-foreground/40 text-center py-8 ${PANEL.borderSubtle} ${PANEL.roundedInner} border-dashed`}>
          {translate(CONTENT, 'causality.noSuggestions', language)}
        </div>
      </div>
    );
  }

  return (
    <div className="pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className={PANEL.fontLabel}>{translate(CONTENT, 'causality.suggestionsHeader', language)}</span>
        <span className={`${PANEL.fontValue} text-muted-foreground/30`}>{translate(CONTENT, 'causality.suggestionsCount', language, { count: suggestions.length })}</span>
      </div>

      {suggestions.map(s => (
        <SuggestionCard
          key={s.id}
          suggestion={s}
          selected={selectedSuggestionId === s.id}
          onSelect={() => onSelectSuggestion(selectedSuggestionId === s.id ? null : s.id)}
          onDownload={onDownload}
          onRecalc={onRecalc}
          recalc={recalcMap?.get(s.id) ?? null}
          downloading={downloadingId === s.id}
          language={language}
        />
      ))}
    </div>
  );
}
