/**
 * Low wall-measurement confidence gate.
 *
 * The deterministic mesh verdict (generateQuickReport → ruleEngine) is driven
 * partly by wall-thickness data. When that measurement is unreliable, showing
 * a confident verdict misleads. The report layer renders a banner instead.
 *
 * Baseline is derived from computeWallConfidence in analysis/wallThickness.ts:
 *   - minThickness === null (unmeasurable) → 0.0
 *   - healthy solids resolve to exactly 0.4 (each ray hits ~1 opposing face →
 *     per-sample confidence 0.4; no thin-wall penalty)
 *   - heavy thin walls (ratio > 0.25 → ×0.5) or moderate thin walls over a low
 *     base land in 0.1–0.3
 * The 0.1-step snapping keeps the boundary crisp: 0.4 trusted, 0.3 not.
 *
 * The threshold itself lives in thresholds.verdictGate.minTrustedWallConfidence.
 * This is the ONE comparison that uses `>=` (not strict `>`): a healthy cube
 * resolving to exactly 0.4 must stay trusted.
 */
import { getThresholds, DEFAULT_ANALYSIS_THRESHOLDS, type AnalysisThresholds } from '@/analysis/thresholds';

/** Exported for readouts; the value lives in thresholds.verdictGate.minTrustedWallConfidence. */
export const MIN_TRUSTED_WALL_CONFIDENCE = DEFAULT_ANALYSIS_THRESHOLDS.verdictGate.minTrustedWallConfidence;

/** True when the wall-thickness measurement can support a confident verdict. */
export function isWallConfidenceTrusted(confidence: number, thresholds: AnalysisThresholds = getThresholds()): boolean {
  return confidence >= thresholds.verdictGate.minTrustedWallConfidence;
}