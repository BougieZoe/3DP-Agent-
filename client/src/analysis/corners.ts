/**
 * Print corners — the skeleton, not the report.
 *
 * A "corner" is one combination of material and layer height that changes what
 * a good print looks like. Today every topology profile resolves to the same
 * numbers regardless of corner, so a corner table would compute three times and
 * say the same thing three times: rigor on the surface, zero information
 * underneath.
 *
 * This module therefore ships the *guard* before the feature:
 *
 *   - a corner whose thresholds were never measured cannot produce a verdict;
 *   - a blocked corner is never folded into the worst-case summary;
 *   - worst-case needs at least two measured corners, because "worst of one"
 *     is just that one, dressed up as a range.
 *
 * Nothing here is wired into the pipeline. Enabling it is a separate decision
 * that requires a corpus first — see `docs/` for the sequencing.
 */

import type { ThresholdsOverride } from './thresholds';
import {
  checkThresholdPresence,
  mergeThresholdOverrides,
  type TopologyProfile,
} from './topologyProfiles';

/** Calibration states a corner can claim. Mirrors TopologyProfile['calibration']. */
export type CornerCalibration = TopologyProfile['calibration'];

export interface CornerDefinition {
  /** Stable id, e.g. `pla@0.20`. Keys the calibration corpus row. */
  id: string;
  material: string;
  layerHeightMm: number;
  /**
   * Measured *for this corner*. Not inherited from the base profile: PLA at
   * 0.2 mm and PA-CF at 0.6 mm cannot share a calibration claim.
   */
  calibration: CornerCalibration;
  /** Overrides measured for this corner. Empty unless a run actually happened. */
  thresholds: ThresholdsOverride;
}

export interface CornerOutcome {
  corner: CornerDefinition;
  /** False means this corner may not influence any verdict — including worst. */
  supported: boolean;
  /** Why it was blocked. Names the reason; never prints a threshold value. */
  blockedReason?: string;
  /** `profileId@thresholdsHash` for the config this corner resolved to. */
  configBaselineId?: string;
  score?: number;
  light?: 'green' | 'yellow' | 'red';
}

export interface CornerReport {
  outcomes: CornerOutcome[];
  /** Corners that produced a usable verdict. */
  supported: CornerOutcome[];
  /** Corners refused because their thresholds are not backed by a measurement. */
  blocked: CornerOutcome[];
  /**
   * Lowest-scoring supported corner. Null unless at least two corners ran —
   * deliberately, so a single measured corner cannot masquerade as a range.
   */
  worst: CornerOutcome | null;
  /** Present whenever `worst` is null, so callers never have to guess why. */
  worstWithheldReason?: string;
}

/** The minimum number of measured corners before a worst case means anything. */
export const MIN_CORNERS_FOR_WORST = 2;

/** How a corner is scored. Injected so this module does not import the pipeline. */
export type CornerJudge = (
  profile: TopologyProfile,
  corner: CornerDefinition,
) => { score: number; light: 'green' | 'yellow' | 'red'; configBaselineId: string };

/**
 * Decide whether a corner may speak at all.
 *
 * Reuses `checkThresholdPresence` so the corner guard and the registry guard
 * cannot drift apart: "declared measured but overrides nothing" fails both.
 */
export function cornerBlockReason(corner: CornerDefinition): string | null {
  if (corner.calibration !== 'measured') {
    return `corner ${corner.id} is \`${corner.calibration}\` — no measured thresholds exist for ${corner.material} @ ${corner.layerHeightMm} mm`;
  }
  const problems = checkThresholdPresence(corner.id, {
    calibration: corner.calibration,
    thresholds: corner.thresholds,
  });
  return problems.length > 0 ? problems[0] : null;
}

/**
 * Evaluate a corner set against a base profile.
 *
 * A blocked corner is never handed to `judge`, so an uncalibrated corner cannot
 * leak a number into a report even by accident.
 */
export function evaluateCorners(
  baseProfile: TopologyProfile,
  corners: readonly CornerDefinition[],
  judge: CornerJudge,
): CornerReport {
  const outcomes: CornerOutcome[] = corners.map((corner) => {
    const blockedReason = cornerBlockReason(corner);
    if (blockedReason) {
      return { corner, supported: false, blockedReason };
    }
    const profile: TopologyProfile = {
      ...baseProfile,
      // Deep merge, not a spread: `ThresholdsOverride` is a recursive mapped
      // type, so spreading it fails type-check (TS2615) and would also replace
      // whole sub-trees that should be merged key-by-key.
      thresholds: mergeThresholdOverrides(baseProfile.thresholds, corner.thresholds),
    };
    const verdict = judge(profile, corner);
    return {
      corner,
      supported: true,
      configBaselineId: verdict.configBaselineId,
      score: verdict.score,
      light: verdict.light,
    };
  });

  const supported = outcomes.filter((o) => o.supported);
  const blocked = outcomes.filter((o) => !o.supported);

  if (supported.length < MIN_CORNERS_FOR_WORST) {
    return {
      outcomes,
      supported,
      blocked,
      worst: null,
      worstWithheldReason:
        supported.length === 0
          ? `no corner has measured thresholds — ${blocked.length} blocked`
          : `only ${supported.length} corner measured — worst case needs ${MIN_CORNERS_FOR_WORST}`,
    };
  }

  const worst = supported.reduce((acc, o) => ((o.score ?? Infinity) < (acc.score ?? Infinity) ? o : acc));
  return { outcomes, supported, blocked, worst };
}
