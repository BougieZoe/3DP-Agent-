import { CausalityGraph } from './causalityEngine';
import { usePrintPlayback } from '@/components/playback/PrintPlaybackContext';
import { PANEL, PHASE_COLORS_CSS, EVENT_COLORS_CSS } from '@/lib/visualLanguage';

interface ManufacturingTimelineProps {
  graph: CausalityGraph | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const PHASES = [
  { label: 'BASE', range: [0, 0.1] as [number, number] },
  { label: 'SUPPORT', range: [0.1, 0.25] as [number, number] },
  { label: 'BRIDGE', range: [0.25, 0.4] as [number, number] },
  { label: 'THERMAL', range: [0.4, 0.6] as [number, number] },
  { label: 'OVERHANG', range: [0.6, 0.75] as [number, number] },
  { label: 'FAILURE ZONE', range: [0.75, 1] as [number, number] },
];

const TYPE_LABELS: Record<string, string> = {
  thermal_accumulation: 'TH',
  cooling_imbalance: 'CI',
  support_instability: 'SI',
  bridge_oscillation: 'BO',
  wall_vibration: 'WV',
  overhang_sag: 'OS',
  delamination_risk: 'DR',
  failure_spike: 'FX',
};

export function ManufacturingTimeline({ graph, selectedId, onSelect }: ManufacturingTimelineProps) {
  const { state, setProgress, togglePlay } = usePrintPlayback();

  if (!graph || graph.events.length === 0) return null;

  const sorted = [...graph.events].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div className={`absolute bottom-12 left-3 right-3 z-10 ${PANEL.bg} ${PANEL.glass} ${PANEL.border} ${PANEL.rounded} ${PANEL.padding}`}>
      <div className="relative h-4 mb-1">
        {PHASES.map((phase, i) => (
          <div
            key={i}
            className={`absolute h-full ${PHASE_COLORS_CSS[i].color} rounded-[1px]`}
            style={{ left: `${phase.range[0] * 100}%`, width: `${(phase.range[1] - phase.range[0]) * 100}%` }}
          >
            <span className="text-[7px] font-mono text-muted-foreground/40 ml-0.5 leading-none">{phase.label}</span>
          </div>
        ))}
      </div>

      <div className="relative h-5 flex items-center">
        {sorted.map(event => {
          const isSelected = selectedId === event.id;
          const colorStyles = EVENT_COLORS_CSS[event.type];
          return (
            <button
              key={event.id}
              onClick={() => {
                onSelect(isSelected ? null : event.id);
                setProgress(event.timestamp);
              }}
              className={`absolute flex items-center gap-0.5 ${PANEL.chip} transition-all -translate-x-1/2 ${
                isSelected
                  ? `${colorStyles} z-10`
                  : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5 z-0 border border-transparent'
              }`}
              style={{ left: `${event.timestamp * 100}%` }}
              title={event.label}
            >
              <span className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white/80' : ''}`} />
              <span>{TYPE_LABELS[event.type] ?? event.type.slice(0, 2).toUpperCase()}</span>
            </button>
          );
        })}
      </div>

      <div className="relative h-1.5 mt-1 bg-muted/20 rounded-full cursor-pointer group"
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const p = (e.clientX - rect.left) / rect.width;
          setProgress(Math.max(0, Math.min(1, p)));
        }}
      >
        <div className="h-full bg-primary/35 rounded-full transition-all" style={{ width: `${state.progress * 100}%` }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-primary/60 rounded-full shadow-sm transition-none pointer-events-none"
          style={{ left: `calc(${state.progress * 100}% - 5px)` }}
        />
      </div>

      <div className="flex items-center gap-2 mt-1">
        <button onClick={togglePlay} className={`${PANEL.fontTiny} text-muted-foreground/50 hover:text-muted-foreground transition-colors`}>
          {state.isPlaying ? '\u23F8' : '\u25B6'}
        </button>
        <span className={`${PANEL.fontTiny} text-muted-foreground/40`}>
          L{state.currentLayer + 1}/{state.totalLayers}
        </span>
        <span className={`${PANEL.fontTiny} text-muted-foreground/30`}>
          {(state.progress * 100).toFixed(0)}%
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span className={`${PANEL.fontTiny} text-muted-foreground/30`}>
            {state.speed}x
          </span>
        </div>
      </div>
    </div>
  );
}
