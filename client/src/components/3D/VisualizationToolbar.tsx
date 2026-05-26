import { useState } from 'react';
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

const OVERLAY_ITEMS = [
  { icon: '\uD83C\uDF21', label: 'Heatmap', key: 'heatmap' as const },
  { icon: '\u25C8', label: 'Supports', key: 'supports' as const },
  { icon: '\u25C9', label: 'Risks', key: 'risks' as const },
  { icon: '\u2307', label: 'Print Path', key: 'printPath' as const },
  { icon: '\u2261', label: 'Layer Reveal', key: 'layerReveal' as const },
  { icon: '\u26A0', label: 'Failure', key: 'failure' as const },
  { icon: '\u25CC', label: 'Thermal', key: 'thermal' as const },
];

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
  const [isOpen, setIsOpen] = useState(false);

  const activeMap: Record<string, boolean> = {
    heatmap: showHeatmap,
    supports: showGhosts,
    risks: showRisks,
    printPath: showPrintPath,
    layerReveal: showLayerReveal,
    failure: showFailure,
    thermal: showThermal,
  };

  const toggleMap: Record<string, () => void> = {
    heatmap: onToggleHeatmap,
    supports: onToggleGhosts,
    risks: onToggleRisks,
    printPath: onTogglePrintPath,
    layerReveal: onToggleLayerReveal,
    failure: onToggleFailure,
    thermal: onToggleThermal,
  };

  const colorMap = SEMANTIC.overlay;

  const panelContent = (
    <>
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
    </>
  );

  return (
    <>
      {/* Desktop icon bar */}
      <div className={`hidden lg:flex absolute right-0 top-1/2 -translate-y-1/2 z-20
        flex-col items-center gap-1.5 w-10 py-2.5
        backdrop-blur-sm bg-background/30 border-l border-border/20 rounded-l-xl`}>
        {OVERLAY_ITEMS.map(({ icon, label, key }) => (
          <IconButton
            key={key}
            icon={icon}
            label={label}
            active={activeMap[key]}
            color={colorMap[key]}
            onClick={toggleMap[key]}
          />
        ))}

        <div className="w-5 h-px bg-border/20 my-1" />

        <div className="h-14 flex items-center justify-center">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={overlayOpacity}
            onChange={e => onOpacityChange(parseFloat(e.target.value))}
            className="w-14 h-0.5 appearance-none bg-border/50 rounded-full cursor-pointer accent-primary"
            style={{ transform: 'rotate(-90deg)' }}
          />
        </div>

        <div className="w-5 h-px bg-border/20 my-1" />

        <button
          onClick={toggleTheme}
          className="group relative w-8 h-8 flex items-center justify-center rounded-lg transition-all
            text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5"
        >
          <span className="text-sm">{themeKey === 'dark' ? '\u2600' : '\u263E'}</span>
          <span className="absolute right-full top-1/2 -translate-y-1/2 mr-2 px-2 py-0.5
            rounded-sm bg-foreground/10 backdrop-blur-sm text-[10px] font-mono text-foreground/70
            whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            {themeKey === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </span>
        </button>
      </div>

      {/* Mobile handle button */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className={`lg:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-30
          bg-background/60 backdrop-blur-md border border-border/20 rounded-full
          px-3 py-1.5 shadow-lg flex items-center gap-2 ${PANEL.fontButton}`}
      >
        OVERLAYS <span className="text-sm leading-none">{isOpen ? '\u2193' : '\u2191'}</span>
      </button>

      {/* Mobile drawer */}
      <div className={`
        lg:hidden fixed bottom-0 left-0 right-0 z-20
        transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-y-0' : 'translate-y-full'}
        bg-background/60 backdrop-blur-md border-t border-border/20
        rounded-t-xl p-3 flex flex-col gap-1.5
        max-h-[70vh] overflow-y-auto
      `}>
        {panelContent}
      </div>
    </>
  );
}

function IconButton({ icon, label, active, color, onClick }: {
  icon: string;
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative w-8 h-8 flex items-center justify-center rounded-lg transition-all
        ${active
          ? `${color} bg-current/10`
          : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/5'
        }`}
    >
      <span className="text-sm">{icon}</span>
      <span className="absolute right-full top-1/2 -translate-y-1/2 mr-2 px-2 py-0.5
        rounded-sm bg-foreground/10 backdrop-blur-sm text-[10px] font-mono text-foreground/70
        whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {label}
      </span>
    </button>
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
