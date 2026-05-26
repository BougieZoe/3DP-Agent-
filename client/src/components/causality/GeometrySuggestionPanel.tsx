import { GeometrySuggestion } from './counterfactualEngine';
import { PANEL, SEMANTIC } from '@/lib/visualLanguage';

interface GeometrySuggestionPanelProps {
  suggestions: GeometrySuggestion[];
  selectedSuggestionId: string | null;
  onSelectSuggestion: (id: string | null) => void;
}

const TYPE_ICON_MAP: Record<string, string> = {
  thicken_wall:    SEMANTIC.suggestionIcon.thickenWall,
  reduce_overhang: SEMANTIC.suggestionIcon.reduceOverhang,
  add_support:     SEMANTIC.suggestionIcon.addSupport,
  split_bridge:    SEMANTIC.suggestionIcon.splitBridge,
  hollow_region:   SEMANTIC.suggestionIcon.hollowRegion,
};

function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  const color = value > 0 ? SEMANTIC.delta.improvement : value < 0 ? SEMANTIC.delta.regression : SEMANTIC.delta.neutral;
  return <span className={`${PANEL.fontTiny} ${color}`}>{value > 0 ? '+' : ''}{value}{suffix}</span>;
}

function SuggestionCard({ suggestion, selected, onSelect }: {
  suggestion: GeometrySuggestion;
  selected: boolean;
  onSelect: () => void;
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
          {suggestion.confidence}% confidence
        </span>
      </div>

      <div className={`${PANEL.fontTiny} text-muted-foreground/60 mb-2 leading-tight`}>
        {suggestion.description}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2">
        <div className={`${PANEL.borderSubtle} ${PANEL.roundedInner} p-1.5`}>
          <div className={`${PANEL.fontTiny} text-muted-foreground/40`}>Risk</div>
          <Delta value={suggestion.riskReduction} suffix="%" />
        </div>
        <div className={`${PANEL.borderSubtle} ${PANEL.roundedInner} p-1.5`}>
          <div className={`${PANEL.fontTiny} text-muted-foreground/40`}>Thermal</div>
          <Delta value={suggestion.thermalImprovement} suffix="%" />
        </div>
        <div className={`${PANEL.borderSubtle} ${PANEL.roundedInner} p-1.5`}>
          <div className={`${PANEL.fontTiny} text-muted-foreground/40`}>Support</div>
          <Delta value={suggestion.supportChange} suffix="%" />
        </div>
      </div>

      {suggestion.patternImpact.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {suggestion.patternImpact.map(p => (
            <span key={p} className={`${PANEL.chip} ${SEMANTIC.delta.improvementChip}`}>
              {p}
            </span>
          ))}
        </div>
      )}

      {suggestion.chainComparison.length > 0 && (
        <div className={`${PANEL.borderSubtle} pt-1.5 mt-1 border-t-0 border-l-0 border-r-0`}>
          <div className={`${PANEL.fontTiny} text-muted-foreground/30 mb-1`}>CONSEQUENCE CHAIN</div>
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
    </button>
  );
}

export function GeometrySuggestionPanel({ suggestions, selectedSuggestionId, onSelectSuggestion }: GeometrySuggestionPanelProps) {
  if (suggestions.length === 0) {
    return (
      <div className="pt-4 space-y-4">
        <div className={PANEL.fontLabel}>COUNTERFACTUAL SUGGESTIONS</div>
        <div className={`${PANEL.fontTiny} text-muted-foreground/40 text-center py-8 ${PANEL.borderSubtle} ${PANEL.roundedInner} border-dashed`}>
          No counterfactual suggestions available for this geometry.
        </div>
      </div>
    );
  }

  return (
    <div className="pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className={PANEL.fontLabel}>COUNTERFACTUAL SUGGESTIONS</span>
        <span className={`${PANEL.fontValue} text-muted-foreground/30`}>{suggestions.length} suggestions</span>
      </div>

      {suggestions.map(s => (
        <SuggestionCard
          key={s.id}
          suggestion={s}
          selected={selectedSuggestionId === s.id}
          onSelect={() => onSelectSuggestion(selectedSuggestionId === s.id ? null : s.id)}
        />
      ))}
    </div>
  );
}
