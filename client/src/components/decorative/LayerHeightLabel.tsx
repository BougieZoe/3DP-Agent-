import { DEFAULT_LAYER_HEIGHT } from '@/analysis/printTime';

/**
 * Static readout of the active print layer height.
 *
 * The app currently has no user-selectable layer-height state — the analysis
 * pipeline always runs at the print-time estimator's DEFAULT_LAYER_HEIGHT
 * (0.2mm). Wire this to real UI state if/when a layer-height selector is added
 * (e.g. lift `layerHeightMm` into an app-level setting and pass it down).
 * Decorative only — aria-hidden and pointer-events-none.
 */
export function LayerHeightLabel() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-2 right-3 select-none text-[11px] font-mono text-muted-foreground/30"
    >
      layer height {DEFAULT_LAYER_HEIGHT.toFixed(2)}mm
    </div>
  );
}
