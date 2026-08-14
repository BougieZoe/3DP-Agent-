import { useState, useEffect } from 'react';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import { PatternMatch } from './topologyPatternEngine';
import { PANEL, PATTERN_COLORS_CSS } from '@/lib/visualLanguage';

interface PatternMemoryPanelProps {
  matches: PatternMatch[];
  selectedPatternId: string | null;
  onSelectPattern: (id: string | null) => void;
  language?: ContentLang;
}

/**
 * Shared consequence-chain renderer — the chain is a property of the pattern
 * template, so it is rendered once per pattern group instead of on every card.
 */
export function ConsequenceChain({ steps, language = 'en' }: { steps: string[]; language?: ContentLang }) {
  if (steps.length === 0) return null;
  return (
    <div className="flex items-center gap-1 mt-1.5">
      <span className={`${PANEL.fontTiny} text-muted-foreground/30`}>{'→'}</span>
      {steps.map((step, i) => (
        <span key={step} className={`${PANEL.fontTiny} text-muted-foreground/40`}>
          {translate(CONTENT, `causality.event.${step}`, language)}
          {i < steps.length - 1 && (
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
  /** Best (highest) per-occurrence similarity in this group. */
  bestSimilarity: number;
  /** Average severity (0–1) across occurrences. */
  avgSeverity: number;
  /** Min / max severity (0–1) across occurrences. */
  severityMin: number;
  severityMax: number;
}

function groupByPattern(matches: PatternMatch[]): PatternGroup[] {
  const groups = new Map<string, PatternGroup>();
  matches.forEach((match, index) => {
    let group = groups.get(match.pattern.id);
    if (!group) {
      group = {
        pattern: match.pattern,
        occurrences: [],
        bestSimilarity: 0,
        avgSeverity: 0,
        severityMin: 1,
        severityMax: 0,
      };
      groups.set(match.pattern.id, group);
    }
    group.occurrences.push({ match, index });
    group.bestSimilarity = Math.max(group.bestSimilarity, match.similarity);
    group.severityMin = Math.min(group.severityMin, match.avgClusterSeverity);
    group.severityMax = Math.max(group.severityMax, match.avgClusterSeverity);
  });
  const result: PatternGroup[] = [];
  groups.forEach(group => {
    group.occurrences.sort((a, b) => b.match.avgClusterSeverity - a.match.avgClusterSeverity);
    group.avgSeverity =
      group.occurrences.reduce((sum, o) => sum + o.match.avgClusterSeverity, 0) / group.occurrences.length;
    result.push(group);
  });
  // Most critical group (highest average severity) first.
  return result.sort((a, b) => b.avgSeverity - a.avgSeverity);
}

function OccurrenceRow({ match, colorClass, selected, onSelect, language }: {
  match: PatternMatch;
  colorClass: string;
  selected: boolean;
  onSelect: () => void;
  language: ContentLang;
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
        {(match.avgClusterSeverity * 100).toFixed(0)}% {translate(CONTENT, 'causality.severity', language)}
      </span>
      <span className="text-muted-foreground/40">
        {match.clusterPositions.length} {translate(CONTENT, 'causality.markers', language)}
      </span>
    </button>
  );
}

function PatternGroupCard({ group, selectedPatternId, onSelectPattern, open, onToggle, language }: {
  group: PatternGroup;
  selectedPatternId: string | null;
  onSelectPattern: (id: string | null) => void;
  open: boolean;
  onToggle: () => void;
  language: ContentLang;
}) {
  const colorClass = PATTERN_COLORS_CSS[group.pattern.id] ?? 'text-muted-foreground';
  const sevMin = (group.severityMin * 100).toFixed(0);
  const sevMax = (group.severityMax * 100).toFixed(0);
  const sevAvg = (group.avgSeverity * 100).toFixed(0);

  return (
    <div className={`${PANEL.paddingCard} ${PANEL.roundedInner} ${PANEL.borderSubtle}`}>
      {/* Collapsible group header — name, occurrence count, average severity.
          Collapsed by default; click to expand the individual occurrences. */}
      <button
        onClick={onToggle}
        className="w-full text-left flex items-center gap-2"
        aria-expanded={open}
      >
        <span className={`${PANEL.fontTiny} text-muted-foreground/30 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>
          {'▸'}
        </span>
        <span className={`${PANEL.fontSmall} ${colorClass}`}>{group.pattern.name}</span>
        <span className={`${PANEL.chip} text-muted-foreground/40 ${PANEL.borderSubtle}`}>
          ×{group.occurrences.length}
        </span>
        {group.pattern.recurrenceCount > 1 && (
          <span className={`${PANEL.chip} text-muted-foreground/30 ${PANEL.borderSubtle}`}>
            {translate(CONTENT, 'causality.seen', language, { count: group.pattern.recurrenceCount })}
          </span>
        )}
        <span className={`ml-auto ${PANEL.fontValue} ${colorClass}`}>{sevAvg}%</span>
      </button>

      {/* Summary line — the collapsed state shows severity range + average. */}
      <div className={`${PANEL.fontTiny} text-muted-foreground/40 mt-0.5 ml-4 leading-tight`}>
        {translate(CONTENT, 'causality.severity', language)} {sevMin}–{sevMax}% · avg {sevAvg}% · {translate(CONTENT, 'causality.bestMatch', language)} {group.bestSimilarity}%
      </div>

      {/* Expanded: description, per-occurrence rows, consequence chain. */}
      {open && (
        <div className="mt-2 space-y-2">
          <div className={`${PANEL.fontTiny} text-muted-foreground/60 leading-tight`}>
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
                  language={language}
                />
              );
            })}
          </div>

          <ConsequenceChain steps={group.pattern.consequenceChain} language={language} />
        </div>
      )}
    </div>
  );
}

export function PatternMemoryPanel({ matches, selectedPatternId, onSelectPattern, language = 'en' }: PatternMemoryPanelProps) {
  const groups = groupByPattern(matches);

  // Groups are collapsed by default; open one if it contains the selected occurrence.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (selectedPatternId) {
      // Occurrence ids are `${pattern.id}-${index}`; pattern ids use underscores.
      const id = selectedPatternId.split('-')[0];
      if (groups.some(g => g.pattern.id === id)) initial.add(id);
    }
    return initial;
  });

  // Selecting an occurrence (e.g. from a 3D highlight) opens its group.
  useEffect(() => {
    if (!selectedPatternId) return;
    const id = selectedPatternId.split('-')[0];
    setOpenGroups(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, [selectedPatternId]);

  if (matches.length === 0) {
    return (
      <div className="pt-4 space-y-4">
        <div className={PANEL.fontLabel}>{translate(CONTENT, 'causality.patternsHeader', language)}</div>
        <div className={`${PANEL.fontTiny} text-muted-foreground/40 text-center py-8 ${PANEL.borderSubtle} ${PANEL.roundedInner} border-dashed`}>
          {translate(CONTENT, 'causality.noPatterns', language)}
        </div>
      </div>
    );
  }

  const toggle = (id: string) => setOpenGroups(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className={PANEL.fontLabel}>{translate(CONTENT, 'causality.patternsHeader', language)}</span>
        <span className={`${PANEL.fontValue} text-muted-foreground/30`}>{translate(CONTENT, 'causality.patternsFound', language, { count: groups.length })}</span>
      </div>

      {groups.map(group => (
        <PatternGroupCard
          key={group.pattern.id}
          group={group}
          selectedPatternId={selectedPatternId}
          onSelectPattern={onSelectPattern}
          open={openGroups.has(group.pattern.id)}
          onToggle={() => toggle(group.pattern.id)}
          language={language}
        />
      ))}
    </div>
  );
}
