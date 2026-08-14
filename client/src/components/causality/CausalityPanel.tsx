import { Fragment } from 'react';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import { CausalityGraph, CausalityEvent, CausalEdge } from './causalityEngine';
import { PANEL, EVENT_COLORS_CSS } from '@/lib/visualLanguage';

interface CausalityPanelProps {
  graph: CausalityGraph | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  language?: ContentLang;
}

const TYPE_ICONS: Record<string, string> = {
  thermal_accumulation: '⧗',
  cooling_imbalance: '↓↑',
  support_instability: '⊥',
  bridge_oscillation: '∿',
  wall_vibration: '∼',
  overhang_sag: '↓',
  delamination_risk: '═',
  failure_spike: '⚠',
};

function EventNode({ event, selected, onSelect }: { event: CausalityEvent; selected: boolean; onSelect: () => void }) {
  const colorClass = EVENT_COLORS_CSS[event.type]?.split(' ')[0] ?? 'text-muted-foreground';
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left ${PANEL.paddingCard} ${PANEL.roundedInner} ${PANEL.borderSubtle} transition-all ${
        selected
          ? `${PANEL.selectedBorder} ${PANEL.selectedBg}`
          : 'border-transparent hover:border-border/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-xs ${colorClass}`}>{TYPE_ICONS[event.type] ?? '●'}</span>
        <span className={`${PANEL.fontSmall} ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
          {event.label}
        </span>
        <span className={`ml-auto ${PANEL.fontValue} ${colorClass}`}>
          {(event.severity * 100).toFixed(0)}%
        </span>
      </div>
      <div className={`${PANEL.fontTiny} text-muted-foreground/50 ml-5 mt-0.5 leading-tight`}>
        {event.description}
      </div>
    </button>
  );
}

export function CausalityPanel({ graph, selectedId, onSelect, language = 'en' }: CausalityPanelProps) {
  if (!graph || graph.events.length === 0) {
    return (
      <div className="pt-4 space-y-4">
        <div className={`${PANEL.fontTiny} text-muted-foreground/40 text-center py-12`}>
          {translate(CONTENT, 'causality.noData', language)}
        </div>
      </div>
    );
  }

  const sorted = [...graph.events].sort((a, b) => a.timestamp - b.timestamp);

  const incomingEdges = new Map<string, CausalEdge[]>();
  const outgoingEdges = new Map<string, CausalEdge[]>();
  for (const edge of graph.edges) {
    if (!outgoingEdges.has(edge.sourceId)) outgoingEdges.set(edge.sourceId, []);
    outgoingEdges.get(edge.sourceId)!.push(edge);
    if (!incomingEdges.has(edge.targetId)) incomingEdges.set(edge.targetId, []);
    incomingEdges.get(edge.targetId)!.push(edge);
  }

  const selectedEvent = graph.events.find(e => e.id === selectedId);

  // Build the events to render: the full chronological list, or — when a
  // selection is active — the causal chain upstream → selected → downstream.
  let events: CausalityEvent[] = sorted;
  let chainActive = false;
  if (selectedId && selectedEvent) {
    chainActive = true;
    const chain: CausalityEvent[] = [];
    const visited = new Set<string>();
    const walk = (id: string, dir: 'up' | 'down') => {
      if (visited.has(id)) return;
      visited.add(id);
      const ev = graph.events.find(e => e.id === id);
      if (ev && id !== selectedId) chain.push(ev);
      const edges = dir === 'up' ? incomingEdges.get(id) : outgoingEdges.get(id);
      for (const e of edges ?? []) {
        walk(dir === 'up' ? e.sourceId : e.targetId, dir);
      }
    };
    walk(selectedId, 'up');
    chain.reverse();
    chain.push(selectedEvent);
    walk(selectedId, 'down');
    events = chain;
  }

  return (
    <div className="pt-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className={PANEL.fontLabel}>{translate(CONTENT, 'causality.chainHeader', language)}</span>
        {chainActive && (
          <button
            onClick={() => onSelect(null)}
            className={`${PANEL.fontTiny} text-muted-foreground/40 hover:text-muted-foreground transition-colors`}
          >
            {translate(CONTENT, 'causality.clearSelection', language)}
          </button>
        )}
      </div>

      {/* Distinct presentation vs. the patterns list below: a faint panel with a
          left accent, and vertical connectors between events when a causal
          chain is being traced. */}
      <div className={`${PANEL.borderSubtle} ${PANEL.roundedInner} ${PANEL.padding} border-l-2`}>
        <div className={PANEL.gapItems}>
          {events.map((event, i) => (
            <Fragment key={event.id}>
              {chainActive && i > 0 && (
                <div className="flex justify-center py-0.5">
                  <span className={`${PANEL.fontTiny} text-muted-foreground/20`}>{'↓'}</span>
                </div>
              )}
              <EventNode
                event={event}
                selected={event.id === selectedId}
                onSelect={() => onSelect(event.id === selectedId ? null : event.id)}
              />
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
