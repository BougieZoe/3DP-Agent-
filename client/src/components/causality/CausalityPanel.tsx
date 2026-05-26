import { CausalityGraph, CausalityEvent, CausalEdge } from './causalityEngine';
import { PANEL, EVENT_COLORS_CSS } from '@/lib/visualLanguage';

interface CausalityPanelProps {
  graph: CausalityGraph | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const TYPE_ICONS: Record<string, string> = {
  thermal_accumulation: '\u29D7',
  cooling_imbalance: '\u2193\u2191',
  support_instability: '\u22A5',
  bridge_oscillation: '\u223F',
  wall_vibration: '\u223C',
  overhang_sag: '\u2193',
  delamination_risk: '\u2550',
  failure_spike: '\u26A0',
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
        <span className={`text-xs ${colorClass}`}>{TYPE_ICONS[event.type] ?? '\u25CF'}</span>
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

export function CausalityPanel({ graph, selectedId, onSelect }: CausalityPanelProps) {
  if (!graph || graph.events.length === 0) {
    return (
      <div className="pt-4 space-y-4">
        <div className={`${PANEL.fontTiny} text-muted-foreground/40 text-center py-12`}>
          No causal data available.
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

  return (
    <div className="pt-4 space-y-4">
      <div className={PANEL.fontLabel}>CAUSAL CHAIN</div>

      {selectedId && selectedEvent ? (
        <div className={PANEL.gapItems}>
          {(() => {
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

            return chain.map(event => (
              <EventNode
                key={event.id}
                event={event}
                selected={event.id === selectedId}
                onSelect={() => onSelect(event.id === selectedId ? null : event.id)}
              />
            ));
          })()}

          <button
            onClick={() => onSelect(null)}
            className={`${PANEL.fontTiny} text-muted-foreground/40 hover:text-muted-foreground transition-colors mt-1`}
          >
            {'\u2190'} Clear selection
          </button>
        </div>
      ) : (
        <div className={PANEL.gapItems}>
          {sorted.map(event => (
            <EventNode
              key={event.id}
              event={event}
              selected={false}
              onSelect={() => onSelect(event.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
