interface VisualizationToolbarProps {
  showHeatmap: boolean;
  showGhosts: boolean;
  showRisks: boolean;
  overlayOpacity: number;
  onToggleHeatmap: () => void;
  onToggleGhosts: () => void;
  onToggleRisks: () => void;
  onOpacityChange: (value: number) => void;
}

export function VisualizationToolbar({
  showHeatmap, showGhosts, showRisks,
  overlayOpacity,
  onToggleHeatmap, onToggleGhosts, onToggleRisks, onOpacityChange,
}: VisualizationToolbarProps) {
  return (
    <div className="absolute bottom-3 right-3 z-20 flex flex-col gap-1.5 bg-background/90 backdrop-blur-sm border border-border/50 rounded-sm p-2.5 min-w-[140px]">
      <div className="text-[10px] font-mono text-muted-foreground/40 tracking-widest mb-1">OVERLAYS</div>

      <ToggleChip label="Heatmap" active={showHeatmap} color="text-orange-400" onClick={onToggleHeatmap} />
      <ToggleChip label="Supports" active={showGhosts} color="text-blue-400" onClick={onToggleGhosts} />
      <ToggleChip label="Risks" active={showRisks} color="text-red-400" onClick={onToggleRisks} />

      <div className="mt-1.5 pt-1.5 border-t border-border/30">
        <div className="text-[10px] font-mono text-muted-foreground/40 mb-1">OPACITY</div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={overlayOpacity}
          onChange={e => onOpacityChange(parseFloat(e.target.value))}
          className="w-full h-1 appearance-none bg-border/50 rounded-full cursor-pointer accent-primary"
        />
      </div>
    </div>
  );
}

function ToggleChip({ label, active, color, onClick }: {
  label: string; active: boolean; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] font-mono px-2 py-1 rounded-sm border text-left transition-all ${
        active
          ? `${color} border-current/30 bg-current/5`
          : 'text-muted-foreground/40 border-transparent hover:text-muted-foreground'
      }`}
    >
      {active ? '▣' : '□'} {label}
    </button>
  );
}
