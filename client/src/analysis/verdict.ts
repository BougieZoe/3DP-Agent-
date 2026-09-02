/**
 * Verdict gating — determines whether the wall-thickness measurement is
 * reliable enough to show a confident analysis verdict.
 *
 * Extracted from lib/lowConfidence.ts into the analysis layer where it
 * semantically belongs: it is pure threshold logic over analysis results,
 * not a shared utility.
 *
 * The threshold lives in thresholds.verdictGate.minTrustedWallConfidence.
 * The 0.1-step confidence snapping keeps the boundary crisp: 0.4 trusted,
 * 0.3 not.
 */
import { getThresholds, DEFAULT_ANALYSIS_THRESHOLDS, type AnalysisThresholds } from './thresholds';

/** Exported for readouts; the value lives in thresholds.verdictGate.minTrustedWallConfidence. */
export const MIN_TRUSTED_WALL_CONFIDENCE = DEFAULT_ANALYSIS_THRESHOLDS.verdictGate.minTrustedWallConfidence;

/** True when the wall-thickness measurement can support a confident verdict. */
export function isWallConfidenceTrusted(confidence: number, thresholds: AnalysisThresholds = getThresholds()): boolean {
  return confidence >= thresholds.verdictGate.minTrustedWallConfidence;
}
