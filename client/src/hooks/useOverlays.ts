import { useState, useCallback } from 'react';

export interface OverlayParams {
  heatmap: { overhangThreshold: number; curvatureWeight: number; thicknessWeight: number; detectBridges: boolean };
  supports: { maxAngle: number; density: number };
  risks: { sensitivity: number; minSeverity: number };
  wallThickness: { minThickness: number; maxThickness: number; showThinOnly: boolean };
}

export interface OverlayState {
  showHeatmap: boolean;
  showGhosts: boolean;
  showRisks: boolean;
  showPrintPath: boolean;
  showLayerReveal: boolean;
  showFailure: boolean;
  showThermal: boolean;
  showWallThickness: boolean;
  selectedEventId: string | null;
  selectedPatternId: string | null;
  selectedSuggestionId: string | null;
  overlayOpacity: number;
  overlayParams: OverlayParams;
}

export function useOverlays() {
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showGhosts, setShowGhosts] = useState(false);
  const [showRisks, setShowRisks] = useState(false);
  const [showPrintPath, setShowPrintPath] = useState(false);
  const [showLayerReveal, setShowLayerReveal] = useState(false);
  const [showFailure, setShowFailure] = useState(false);
  const [showThermal, setShowThermal] = useState(false);
  const [showWallThickness, setShowWallThickness] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(0.7);
  const [overlayParams, setOverlayParams] = useState<OverlayParams>({
    heatmap: { overhangThreshold: 45, curvatureWeight: 0.3, thicknessWeight: 0.2, detectBridges: true },
    supports: { maxAngle: 45, density: 0.5 },
    risks: { sensitivity: 1, minSeverity: 0.3 },
    wallThickness: { minThickness: 0.8, maxThickness: 4.0, showThinOnly: false },
  });

  const resetOverlays = useCallback(() => {
    setShowHeatmap(false);
    setShowGhosts(false);
    setShowRisks(false);
    setShowPrintPath(false);
    setShowLayerReveal(false);
    setShowFailure(false);
    setShowThermal(false);
    setShowWallThickness(false);
    setSelectedEventId(null);
    setSelectedPatternId(null);
    setSelectedSuggestionId(null);
    setOverlayOpacity(0.7);
  }, []);

  const handleParamChange = useCallback(<K extends keyof OverlayParams>(
    overlay: K,
    param: keyof OverlayParams[K],
    value: any,
  ) => {
    setOverlayParams(prev => ({
      ...prev,
      [overlay]: { ...prev[overlay], [param]: value },
    }));
  }, []);

  return {
    showHeatmap, setShowHeatmap,
    showGhosts, setShowGhosts,
    showRisks, setShowRisks,
    showPrintPath, setShowPrintPath,
    showLayerReveal, setShowLayerReveal,
    showFailure, setShowFailure,
    showThermal, setShowThermal,
    showWallThickness, setShowWallThickness,
    selectedEventId, setSelectedEventId,
    selectedPatternId, setSelectedPatternId,
    selectedSuggestionId, setSelectedSuggestionId,
    overlayOpacity, setOverlayOpacity,
    overlayParams, handleParamChange,
    resetOverlays,
  };
}
