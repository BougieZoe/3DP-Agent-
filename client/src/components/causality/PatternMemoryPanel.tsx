import { PatternMatch } from './topologyPatternEngine';
import { PANEL, PATTERN_COLORS_CSS } from '@/lib/visualLanguage';

interface PatternMemoryPanelProps {
  matches: PatternMatch[];
  selectedPatternId: string | null;
  onSelectPattern: (id: string | null) => void;
}

/**
 * Shared consequence-chain renderer — the chain is a property of the pattern
 * template, so it is rendered once per pattern group instead of on every card.
 */
export function ConsequenceChain({ steps }: { steps: string[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="flex items-center gap-1 mt-1.5">
      <span className={`${PANEL.fontTiny} text-muted-foreground/30`}>{'→'}</span>
      {steps.map((step, i) => (
        <span key={step} className={`${PANEL.fontTiny} text-muted-foreground/40`}>
          {step.replace(/_/g, ' ')}{i < steps.length - 1 && (
            <span className="text-muted-foreground/20 mx-0.5">{'→'}</span>
          )}
        </span>
      ))}
    </div>
  );
}

interface PatternGroup {
  pattern: PatternMatch['pattern'];
  /**
   * Each occurrence carries its index in the original `matches` prop.
   * Home.tsx resolves selection as `${pattern.id}-${index}` against that
   * same array, so the id must use the prop index, not the display order.
   */
  occurrences: Array<{ match: PatternMatch; index: number }>;
  bestSimilarity: number;
}

function groupByPattern(matches: PatternMatch[]): PatternGroup[] {
  const groups = new Map<string, PatternGroup>();
  matches.forEach((match, index) => {
    let group = groups.get(match.pattern.id);
    if (!group) {
      group = { pattern: match.pattern, occurrences: [], bestSimilarity: 0 };
      groups.set(match.pattern.id, group);
    }
    group.occurrences.push({ match, index });
    group.bestSimilarity = Math.max(group.bestSimilarity, match.similarity);
  });
  const result: PatternGroup[] = [];
  groups.forEach(group => {
    group.occurrences.sort((a, b) => b.match.similarity - a.match.similarity);
    result.push(group);
  });
  return result.sort((a, b) => b.bestSimilarity - a.bestSimilarity);
}

function OccurrenceRow({ match, colorClass, selected, onSelect }: {
  match: PatternMatch;
  colorClass: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left flex items-center gap-3 px-1.5 py-1 border transition-all ${PANEL.roundedInner} ${PANEL.fontTiny} ${
        selected
          ? `${PANEL.selectedBorder} ${PANEL.selectedBg}`
          : 'border-transparent hover:border-border/50'
      }`}
    >
      <span className={colorClass}>{match.similarity}%</span>
      <span className="text-muted-foreground/40">
        {(match.avgClusterSeverity * 100).toFixed(0)}% severity
      </span>
      <span className="text-muted-foreground/40">
        {match.clusterPositions.length} markers
      </span>
    </button>
  );
}

function PatternGroupCard({ group, selectedPatternId, onSelectPattern }: {
  group: PatternGroup;
  selectedPatternId: string | null;
  onSelectPattern: (id: string | null) => void;
}) {
  const colorClass = PATTERN_COLORS_CSS[group.pattern.id] ?? 'text-muted-foreground';
  return (
    <div className={`${PANEL.paddingCard} ${PANEL.roundedInner} ${PANEL.borderSubtle}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`${PANEL.fontSmall} ${colorClass}`}>
          {group.pattern.name}
        </span>
        {group.pattern.recurrenceCount > 1 && (
          <span className={`${PANEL.chip} text-muted-foreground/40 ${PANEL.borderSubtle}`}>
            x{group.pattern.recurrenceCount}
          </span>
        )}
        <span className={`ml-auto ${PANEL.fontTiny} text-muted-foreground/40`}>
          {group.occurrences.length} occurrence{group.occurrences.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className={`${PANEL.fontTiny} text-muted-foreground/60 mb-2 leading-tight`}>
        {group.pattern.description}
      </div>

      <div className={PANEL.gapItems}>
        {group.occurrences.map(({ match, index }) => {
          const occurrenceId = `${match.pattern.id}-${index}`;
          return (
            <OccurrenceRow
              key={occurrenceId}
              match={match}
              colorClass={colorClass}
              selected={selectedPatternId === occurrenceId}
              onSelect={() => onSelectPattern(selectedPatternId === occurrenceId ? null : occurrenceId)}
            />
          );
        })}
      </div>

      <ConsequenceChain steps={group.pattern.consequenceChain} />
    </div>
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

  const groups = groupByPattern(matches);

  return (
    <div className="pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className={PANEL.fontLabel}>RECOGNIZED PATTERNS</span>
        <span className={`${PANEL.fontValue} text-muted-foreground/30`}>{groups.length} found</span>
      </div>

      {groups.map(group => (
        <PatternGroupCard
          key={group.pattern.id}
          group={group}
          selectedPatternId={selectedPatternId}
          onSelectPattern={onSelectPattern}
        />
      ))}
    </div>
  );
}
