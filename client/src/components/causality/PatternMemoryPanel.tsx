import { PatternMatch } from './topologyPatternEngine';
import { PANEL, PATTERN_COLORS_CSS } from '@/lib/visualLanguage';

interface PatternMemoryPanelProps {
  matches: PatternMatch[];
  selectedPatternId: string | null;
  onSelectPattern: (id: string | null) => void;
}

function PatternCard({ match, selected, onSelect }: {
  match: PatternMatch;
  selected: boolean;
  onSelect: () => void;
}) {
  const colorClass = PATTERN_COLORS_CSS[match.pattern.id] ?? 'text-muted-foreground';
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
        <span className={`${PANEL.fontSmall} ${colorClass}`}>
          {match.pattern.name}
        </span>
        {match.pattern.recurrenceCount > 1 && (
          <span className={`${PANEL.chip} text-muted-foreground/40 ${PANEL.borderSubtle}`}>
            x{match.pattern.recurrenceCount}
          </span>
        )}
      </div>

      <div className={`${PANEL.fontTiny} text-muted-foreground/60 mb-2 leading-tight`}>
        {match.pattern.description}
      </div>

      <div className={`flex items-center gap-3 ${PANEL.fontTiny}`}>
        <span className={colorClass}>{match.similarity}%</span>
        <span className="text-muted-foreground/40">
          {(match.avgClusterSeverity * 100).toFixed(0)}% severity
        </span>
        <span className="text-muted-foreground/40">
          {match.clusterPositions.length} markers
        </span>
      </div>

      {match.pattern.consequenceChain.length > 0 && (
        <div className="flex items-center gap-1 mt-1.5">
          <span className={`${PANEL.fontTiny} text-muted-foreground/30`}>{'\u2192'}</span>
          {match.pattern.consequenceChain.map((step, i) => (
            <span key={step} className={`${PANEL.fontTiny} text-muted-foreground/40`}>
              {step.replace(/_/g, ' ')}{i < match.pattern.consequenceChain.length - 1 && (
                <span className="text-muted-foreground/20 mx-0.5">{'\u2192'}</span>
              )}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

export function PatternMemoryPanel({ matches, selectedPatternId, onSelectPattern }: PatternMemoryPanelProps) {
  if (matches.length === 0) {
    return (
      <div className="pt-4 space-y-4">
        <div className={PANEL.fontLabel}>RECOGNIZED PATTERNS</div>
        <div className={`${PANEL.fontTiny} text-muted-foreground/40 text-center py-8 ${PANEL.borderSubtle} ${PANEL.roundedInner} border-dashed`}>
          No structural patterns detected in this analysis.
        </div>
      </div>
    );
  }

  const sorted = [...matches].sort((a, b) => b.similarity - a.similarity);

  return (
    <div className="pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className={PANEL.fontLabel}>RECOGNIZED PATTERNS</span>
        <span className={`${PANEL.fontValue} text-muted-foreground/30`}>{matches.length} found</span>
      </div>

      {sorted.map((match, i) => (
        <PatternCard
          key={`${match.pattern.id}-${i}`}
          match={match}
          selected={selectedPatternId === `${match.pattern.id}-${i}`}
          onSelect={() => onSelectPattern(selectedPatternId === `${match.pattern.id}-${i}` ? null : `${match.pattern.id}-${i}`)}
        />
      ))}
    </div>
  );
}
