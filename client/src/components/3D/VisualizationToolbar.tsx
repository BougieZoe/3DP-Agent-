import { PANEL, SEMANTIC } from '@/lib/visualLanguage';
import { useTheme } from '@/lib/ThemeContext';



interface VisualizationToolbarProps {
  showHeatmap: boolean;
  showGhosts: boolean;
  showRisks: boolean;
  showPrintPath: boolean;
  showLayerReveal: boolean;
  showFailure: boolean;
  showThermal: boolean;
  overlayOpacity: number;
  onToggleHeatmap: () => void;
  onToggleGhosts: () => void;
  onToggleRisks: () => void;
  onTogglePrintPath: () => void;
  onToggleLayerReveal: () => void;
  onToggleFailure: () => void;
  onToggleThermal: () => void;
  onOpacityChange: (value: number) => void;
}

export function VisualizationToolbar({
  showHeatmap,
  showGhosts,
  showRisks,
  showPrintPath,
  showLayerReveal,
  showFailure,
  showThermal,
  overlayOpacity,
  onToggleHeatmap,
  onToggleGhosts,
  onToggleRisks,
  onTogglePrintPath,
  onToggleLayerReveal,
  onToggleFailure,
  onToggleThermal,
  onOpacityChange,
}: VisualizationToolbarProps) {
  const { themeKey, SEMANTIC, toggleTheme } = useTheme();

  return (
    <div className={`absolute bottom-3 right-3 z-20 flex flex-col gap-1.5 
      ${PANEL.bg} ${PANEL.glass} ${PANEL.border} ${PANEL.rounded} p-2.5 min-w-[172px]`}>
      
      <div className={`${PANEL.fontLabel} mb-1`}>OVERLAYS</div>

      <ToggleChip 
        label="Heatmap" 
        active={showHeatmap} 
        color={SEMANTIC.overlay.heatmap} 
        onClick={onToggleHeatmap} 
      />
      <ToggleChip 
        label="Supports" 
        active={showGhosts} 
        color={SEMANTIC.overlay.supports} 
        onClick={onToggleGhosts} 
      />
      <ToggleChip 
        label="Risks" 
        active={showRisks} 
        color={SEMANTIC.overlay.risks} 
        onClick={onToggleRisks} 
      />

      <div className={`${SEMANTIC.overlay.separator}`} />

      <ToggleChip 
        label="Print Path" 
        active={showPrintPath} 
        color={SEMANTIC.overlay.printPath} 
        onClick={onTogglePrintPath} 
      />
      <ToggleChip 
        label="Layer Reveal" 
        active={showLayerReveal} 
        color={SEMANTIC.overlay.layerReveal} 
        onClick={onToggleLayerReveal} 
      />

      <div className={`${SEMANTIC.overlay.separator}`} />

      <ToggleChip 
        label="Failure" 
        active={showFailure} 
        color={SEMANTIC.overlay.failure} 
        onClick={onToggleFailure} 
      />
      <ToggleChip 
        label="Thermal" 
        active={showThermal} 
        color={SEMANTIC.overlay.thermal} 
        onClick={onToggleThermal} 
      />

      <button
        onClick={toggleTheme}
        className={`${PANEL.fontButton} px-3 py-1.5 ${PANEL.roundedInner} ${PANEL.borderSubtle} 
          flex items-center gap-2 hover:bg-foreground/5 active:bg-foreground/10 transition-all mt-1`}
      >
        <span className="text-base leading-none">
          {themeKey === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}
        </span>
        <span>{themeKey === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
      </button>

      <div className="mt-2 pt-2 border-t border-border/30">
        <div className={`${PANEL.fontLabel} mb-1`}>OPACITY</div>
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

function ToggleChip({ 
  label, 
  active, 
  color, 
  onClick 
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`${PANEL.fontButton} px-2 py-1 ${PANEL.roundedInner} ${PANEL.borderSubtle} text-left transition-all ${
        active
          ? `${color} ${SEMANTIC.toggle.active}`
          : SEMANTIC.toggle.inactive
      }`}
    >
      {active ? '\u25A3' : '\u25A1'} {label}
    </button>
  );
}
