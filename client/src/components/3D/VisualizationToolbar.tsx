/**
 * Enhanced Visualization Toolbar
 *
 * Features:
 * - Toggle overlays on/off
 * - Per-overlay parameter sliders
 * - Real-time adjustment
 * - Multi-overlay compositing
 */

import { useState, useCallback } from 'react';
import { PANEL, SEMANTIC } from '@/lib/visualLanguage';
import { useTheme } from '@/lib/ThemeContext';
import type { translations } from '@/lib/i18n';

type TKey = keyof (typeof translations)['en'];

export interface OverlayParams {
  heatmap: {
    overhangThreshold: number;
    curvatureWeight: number;
    thicknessWeight: number;
    detectBridges: boolean;
  };
  supports: {
    maxAngle: number;
    density: number;
  };
  risks: {
    sensitivity: number;
    minSeverity: number;
  };
  wallThickness: {
    minThickness: number;
    maxThickness: number;
    showThinOnly: boolean;
  };
}

interface VisualizationToolbarProps {
  showHeatmap: boolean;
  showGhosts: boolean;
  showRisks: boolean;
  showPrintPath: boolean;
  showLayerReveal: boolean;
  showFailure: boolean;
  showThermal: boolean;
  showWallThickness: boolean;
  overlayOpacity: number;
  overlayParams: OverlayParams;
  onToggleHeatmap: () => void;
  onToggleGhosts: () => void;
  onToggleRisks: () => void;
  onTogglePrintPath: () => void;
  onToggleLayerReveal: () => void;
  onToggleFailure: () => void;
  onToggleThermal: () => void;
  onToggleWallThickness: () => void;
  onOpacityChange: (value: number) => void;
  onParamsChange: (params: OverlayParams) => void;
  t: (key: TKey) => string;
}

const OVERLAY_ITEMS = [
  { icon: '\uD83C\uDF21', labelKey: 'toolbarHeatmap' as const, key: 'heatmap' as const },
  { icon: '\u25C8', labelKey: 'toolbarSupports' as const, key: 'supports' as const },
  { icon: '\u25C9', labelKey: 'toolbarRisks' as const, key: 'risks' as const },
  { icon: '\u2593', labelKey: 'toolbarWallThickness' as const, key: 'wallThickness' as const },
  { icon: '\u2307', labelKey: 'toolbarPrintPath' as const, key: 'printPath' as const },
  { icon: '\u2261', labelKey: 'toolbarLayerReveal' as const, key: 'layerReveal' as const },
  { icon: '\u26A0', labelKey: 'toolbarFailure' as const, key: 'failure' as const },
  { icon: '\u25CC', labelKey: 'toolbarThermal' as const, key: 'thermal' as const },
];

export function VisualizationToolbar({
  showHeatmap,
  showGhosts,
  showRisks,
  showPrintPath,
  showLayerReveal,
  showFailure,
  showThermal,
  showWallThickness,
  overlayOpacity,
  overlayParams,
  onToggleHeatmap,
  onToggleGhosts,
  onToggleRisks,
  onTogglePrintPath,
  onToggleLayerReveal,
  onToggleFailure,
  onToggleThermal,
  onToggleWallThickness,
  onOpacityChange,
  onParamsChange,
  t,
}: VisualizationToolbarProps) {
  const { themeKey, SEMANTIC, toggleTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedOverlay, setExpandedOverlay] = useState<string | null>(null);
  // Three analysis overlays are the common case. The print-process overlays
  // (path/layer/failure/thermal/risks) live behind one disclosure so the
  // panel opens at a readable length instead of eight stacked toggles.
  const [showMoreOverlays, setShowMoreOverlays] = useState(false);

  const activeMap: Record<string, boolean> = {
    heatmap: showHeatmap,
    supports: showGhosts,
    risks: showRisks,
    wallThickness: showWallThickness,
    printPath: showPrintPath,
    layerReveal: showLayerReveal,
    failure: showFailure,
    thermal: showThermal,
  };

  const toggleMap: Record<string, () => void> = {
    heatmap: onToggleHeatmap,
    supports: onToggleGhosts,
    risks: onToggleRisks,
    wallThickness: onToggleWallThickness,
    printPath: onTogglePrintPath,
    layerReveal: onToggleLayerReveal,
    failure: onToggleFailure,
    thermal: onToggleThermal,
  };

  const colorMap = SEMANTIC.overlay;

  const handleParamChange = useCallback((
    overlay: keyof OverlayParams,
    key: string,
    value: number | boolean,
  ) => {
    const newParams = { ...overlayParams };
    (newParams[overlay] as Record<string, unknown>)[key] = value;
    onParamsChange(newParams);
  }, [overlayParams, onParamsChange]);

  const panelContent = (
    <>
      <div className={`${PANEL.fontLabel} mb-1`}>{t('overlays')}</div>

      <ToggleChip
        label={t('toolbarHeatmap')}
        active={showHeatmap}
        color={SEMANTIC.overlay.heatmap}
        onClick={onToggleHeatmap}
        onExpand={() => setExpandedOverlay(expandedOverlay === 'heatmap' ? null : 'heatmap')}
        expanded={expandedOverlay === 'heatmap'}
      />
      {expandedOverlay === 'heatmap' && showHeatmap && (
        <div className="ml-4 space-y-2 py-2">
          <SliderParam
            label={t('tbOverhangThreshold')}
            value={overlayParams.heatmap.overhangThreshold}
            min={20} max={70} step={5}
            unit="°"
            onChange={v => handleParamChange('heatmap', 'overhangThreshold', v)}
          />
          <SliderParam
            label={t('tbCurvatureWeight')}
            value={overlayParams.heatmap.curvatureWeight}
            min={0} max={1} step={0.1}
            onChange={v => handleParamChange('heatmap', 'curvatureWeight', v)}
          />
          <SliderParam
            label={t('tbThicknessWeight')}
            value={overlayParams.heatmap.thicknessWeight}
            min={0} max={1} step={0.1}
            onChange={v => handleParamChange('heatmap', 'thicknessWeight', v)}
          />
          <ToggleParam
            label={t('tbBridgeDetection')}
            value={overlayParams.heatmap.detectBridges}
            onChange={v => handleParamChange('heatmap', 'detectBridges', v)}
          />
          <LegendHint title={t('legendTitle')} items={[
            { color: 'bg-red-500', label: t('legendHeatHigh') },
            { color: 'bg-orange-500', label: t('legendHeatMid') },
            { color: 'bg-green-500', label: t('legendHeatSafe') },
          ]} />
        </div>
      )}

      <ToggleChip
        label={t('toolbarWallThickness')}
        active={showWallThickness}
        color={SEMANTIC.overlay.wallThickness}
        onClick={onToggleWallThickness}
        onExpand={() => setExpandedOverlay(expandedOverlay === 'wallThickness' ? null : 'wallThickness')}
        expanded={expandedOverlay === 'wallThickness'}
      />
      {expandedOverlay === 'wallThickness' && showWallThickness && (
        <div className="ml-4 space-y-2 py-2">
          <SliderParam
            label={t('tbMinThickness')}
            value={overlayParams.wallThickness.minThickness}
            min={0.2} max={2} step={0.1}
            unit="mm"
            onChange={v => handleParamChange('wallThickness', 'minThickness', v)}
          />
          <SliderParam
            label={t('tbMaxThickness')}
            value={overlayParams.wallThickness.maxThickness}
            min={2} max={10} step={0.5}
            unit="mm"
            onChange={v => handleParamChange('wallThickness', 'maxThickness', v)}
          />
          <ToggleParam
            label={t('tbShowThinOnly')}
            value={overlayParams.wallThickness.showThinOnly}
            onChange={v => handleParamChange('wallThickness', 'showThinOnly', v)}
          />
          <LegendHint title={t('legendTitle')} items={[
            { color: 'bg-red-500', label: t('legendWallTooThin') },
            { color: 'bg-yellow-500', label: t('legendWallThin') },
            { color: 'bg-green-500', label: t('legendWallOk') },
            { color: 'bg-cyan-400', label: t('legendWallThick') },
          ]} />
        </div>
      )}

      <ToggleChip
        label={t('toolbarSupports')}
        active={showGhosts}
        color={SEMANTIC.overlay.supports}
        onClick={onToggleGhosts}
        onExpand={() => setExpandedOverlay(expandedOverlay === 'supports' ? null : 'supports')}
        expanded={expandedOverlay === 'supports'}
      />
      {expandedOverlay === 'supports' && showGhosts && (
        <div className="ml-4 space-y-2 py-2">
          <SliderParam
            label={t('tbMaxAngle')}
            value={overlayParams.supports.maxAngle}
            min={30} max={60} step={5}
            unit="°"
            onChange={v => handleParamChange('supports', 'maxAngle', v)}
          />
          <SliderParam
            label={t('tbDensity')}
            value={overlayParams.supports.density}
            min={0.1} max={1} step={0.1}
            onChange={v => handleParamChange('supports', 'density', v)}
          />
          <LegendHint title={t('legendTitle')} items={[
            { color: 'bg-blue-500', label: t('legendOverhangFace') },
            { color: 'bg-orange-500', label: t('legendBridge') },
          ]} />
        </div>
      )}

      {/* Secondary overlays — collapsed by default. The badge keeps a hidden
          active overlay discoverable instead of silently shaping the view. */}
      <button
        onClick={() => setShowMoreOverlays(v => !v)}
        aria-expanded={showMoreOverlays}
        className="mt-1 flex w-full items-center justify-between rounded-sm px-1 py-1 text-[10px] font-mono text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        <span>
          {t('overlaysMore')}
          {(() => {
            const n = [showRisks, showPrintPath, showLayerReveal, showFailure, showThermal].filter(Boolean).length;
            return n > 0 ? ` · ${n}` : '';
          })()}
        </span>
        <span className={`transition-transform ${showMoreOverlays ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {showMoreOverlays && (
        <>
          <ToggleChip
            label={t('toolbarRisks')}
            active={showRisks}
            color={SEMANTIC.overlay.risks}
            onClick={onToggleRisks}
            onExpand={() => setExpandedOverlay(expandedOverlay === 'risks' ? null : 'risks')}
            expanded={expandedOverlay === 'risks'}
          />
          {expandedOverlay === 'risks' && showRisks && (
            <div className="ml-4 space-y-2 py-2">
              <SliderParam
                label={t('tbSensitivity')}
                value={overlayParams.risks.sensitivity}
                min={0.1} max={2} step={0.1}
                onChange={v => handleParamChange('risks', 'sensitivity', v)}
              />
              <SliderParam
                label={t('tbMinSeverity')}
                value={overlayParams.risks.minSeverity}
                min={0} max={1} step={0.1}
                onChange={v => handleParamChange('risks', 'minSeverity', v)}
              />
              <LegendHint title={t('legendTitle')} items={[
                { color: 'bg-red-500', label: t('legendRiskHigh') },
                { color: 'bg-yellow-500', label: t('legendRiskMid') },
                { color: 'bg-cyan-400', label: t('legendRiskLow') },
              ]} />
            </div>
          )}

          <ToggleChip
            label={t('toolbarPrintPath')}
            active={showPrintPath}
            color={SEMANTIC.overlay.printPath}
            onClick={onTogglePrintPath}
          />
          <ToggleChip
            label={t('toolbarLayerReveal')}
            active={showLayerReveal}
            color={SEMANTIC.overlay.layerReveal}
            onClick={onToggleLayerReveal}
          />
          <ToggleChip
            label={t('toolbarFailure')}
            active={showFailure}
            color={SEMANTIC.overlay.failure}
            onClick={onToggleFailure}
          />
          <ToggleChip
            label={t('toolbarThermal')}
            active={showThermal}
            color={SEMANTIC.overlay.thermal}
            onClick={onToggleThermal}
          />
        </>
      )}

      <button
        onClick={toggleTheme}
        className={`${PANEL.fontButton} px-3 py-1.5 ${PANEL.roundedInner} ${PANEL.borderSubtle}
          flex items-center gap-2 hover:bg-foreground/5 active:bg-foreground/10 transition-all mt-1`}
      >
        <span className="text-base leading-none">
          {themeKey === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}
        </span>
        <span>{themeKey === 'dark' ? t('toolbarLightMode') : t('toolbarDarkMode')}</span>
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
        {OVERLAY_ITEMS.map(({ icon, labelKey, key }) => (
          <IconButton
            key={key}
            icon={icon}
            label={t(labelKey)}
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
            {themeKey === 'dark' ? t('toolbarLightMode') : t('toolbarDarkMode')}
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
        {t('overlays')} <span className="text-sm leading-none">{isOpen ? '\u2193' : '\u2191'}</span>
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
  onClick,
  onExpand,
  expanded,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
  onExpand?: () => void;
  expanded?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onClick}
        className={`${PANEL.fontButton} flex-1 px-2 py-1 ${PANEL.roundedInner} ${PANEL.borderSubtle} text-left transition-all ${
          active
            ? `${color} ${SEMANTIC.toggle.active}`
            : SEMANTIC.toggle.inactive
        }`}
      >
        {active ? '\u25A3' : '\u25A1'} {label}
      </button>
      {onExpand && (
        <button
          onClick={onExpand}
          className={`w-6 h-6 flex items-center justify-center rounded text-[10px] transition-all ${
            expanded ? 'bg-foreground/10 text-foreground/70' : 'text-foreground/30 hover:text-foreground/50'
          }`}
        >
          {expanded ? '\u25B2' : '\u25BC'}
        </button>
      )}
    </div>
  );
}

function SliderParam({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[10px] font-mono text-foreground/50">
        <span>{label}</span>
        <span>{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-0.5 appearance-none bg-border/50 rounded-full cursor-pointer accent-primary"
      />
    </div>
  );
}

function ToggleParam({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between text-[10px] font-mono text-foreground/50 cursor-pointer">
      <span>{label}</span>
      <div
        onClick={() => onChange(!value)}
        className={`w-8 h-4 rounded-full transition-colors ${
          value ? 'bg-primary/60' : 'bg-border/50'
        }`}
      >
        <div className={`w-3 h-3 rounded-full bg-foreground transition-transform mt-0.5 ${
          value ? 'translate-x-4.5' : 'translate-x-0.5'
        }`} />
      </div>
    </label>
  );
}

function LegendHint({ items, title }: { items: Array<{ color: string; label: string }>; title: string }) {
  return (
    <div className="mt-2 pt-2 border-t border-border/20">
      <div className="text-[9px] font-mono text-foreground/30 mb-1.5">{title}</div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-[10px] text-foreground/50">
            <div className={`w-2.5 h-2.5 rounded-sm ${item.color}`} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
