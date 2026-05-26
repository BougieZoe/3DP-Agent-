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
      {/* Desktop — always visible */}
      <div className={`hidden lg:flex absolute bottom-3 right-3 z-20 flex-col gap-1.5
        ${PANEL.bg} ${PANEL.glass} ${PANEL.border} ${PANEL.rounded} p-2.5 min-w-[172px]`}>
        {panelContent}
      </div>

      {/* Mobile handle button — always visible below lg */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className={`lg:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-30
          ${PANEL.bg} ${PANEL.glass} ${PANEL.border} rounded-full
          px-3 py-1.5 shadow-lg flex items-center gap-2 ${PANEL.fontButton}`}
      >
        OVERLAYS <span className="text-sm leading-none">{isOpen ? '\u2193' : '\u2191'}</span>
      </button>

      {/* Mobile drawer — slides up from bottom */}
      <div className={`
        lg:hidden fixed bottom-0 left-0 right-0 z-20
        transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-y-0' : 'translate-y-full'}
        ${PANEL.bg} ${PANEL.glass} ${PANEL.border}
        rounded-t-xl p-3 flex flex-col gap-1.5
        max-h-[70vh] overflow-y-auto
      `}>
        {panelContent}
      </div>
    </>
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
