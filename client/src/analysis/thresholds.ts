/**
 * Single source of truth for every analysis threshold.
 *
 * Previously each module hardcoded its own literals (wallThickness.ts,
 * metrics.ts, support.ts, printTime.ts, validation.ts, ruleEngine.ts,
 * lowConfidence.ts). This module consolidates them into one typed config so a
 * value changes in exactly one place, and so tests / overrides can inject a
 * custom config through `getThresholds(override)` without editing sources.
 *
 * ── Migration contract ─────────────────────────────────────────────────────
 * `DEFAULT_ANALYSIS_THRESHOLDS` is byte-identical to the values that were
 * hardcoded before the migration. The comparison OPERATORS at each call site
 * are preserved exactly as they were (most are strict `>` / `<`; the verdict
 * gate uses `>=`). Do not "normalize" a strict comparison to a non-strict one
 * while migrating — the 0.1-step confidence snapping makes the boundary value
 * meaningful (a healthy cube lands on exactly 0.4, which must remain trusted).
 * Each field comment notes the operator its consumer uses.
 *
 * ── Known dead code ────────────────────────────────────────────────────────
 * `wallThickness.lowConfidence` (0.3) and its penalty term were DEAD: the
 * per-sample confidence for any valid sample is min(0.8, 0.3 + hits*0.1) ≥ 0.4,
 * so no valid sample ever fell below 0.3 and `lowConfidenceSampleCount` was
 * always 0, making the low-confidence penalty a permanent ×1 no-op. The field,
 * the count, and the penalty were removed entirely (task-④ option ③) rather
 * than calibrated, because the metric was structurally impossible to revive:
 * any threshold > 0.4 mis-flags every healthy sample, any threshold ≤ 0.4
 * counts nothing.
 */

export interface AnalysisThresholds {
  /**
   * Overhang angle shared by `analyzeOverhang` (metrics.ts) and
   * `estimateSupportVolume` (support.ts). Faces tilted more than this below
   * horizontal count as overhangs (strict `>` in both modules).
   */
  overhangThresholdDeg: number;

  /** Wall-thickness measurement and confidence (wallThickness.ts). */
  wallThickness: {
    /** A sample thinner than this counts as a thin wall (strict `<`). */
    thinWallMm: number;
    /** Ray budget = bounding-box diagonal × this factor. */
    rayDistanceDiagonalFactor: number;
    /** Maximum raycast samples taken. */
    maxSamples: number;
    /** Below this triangle count the sampler returns no measurement. */
    minTriCount: number;
    /** Ray hits closer than this are ignored as coplanar self-hits (strict `>`). */
    rayMinHitDistanceMm: number;
    /** Per-sample confidence base when the ray hits at least one face. */
    hitConfidenceBase: number;
    /** Per-sample confidence added per additional hit (cap applies). */
    hitConfidencePerHit: number;
    /** Per-sample confidence cap for multi-hit samples. */
    hitConfidenceCap: number;
    /** Per-sample confidence assigned when no opposing face was hit. */
    noHitConfidence: number;
    /** Samples thinner than this are discarded as invalid (strict `>`). */
    validThicknessMinMm: number;
    /** Samples with confidence at/below this are discarded as invalid (strict `>`). */
    validConfidenceMin: number;
    /** Percentile ranks used for p1/p5/p10/median summaries. */
    percentiles: { p1: number; p5: number; p10: number; median: number };
    /** Confidence penalties applied inside computeWallConfidence. */
    confidencePenalty: {
      /** thinWallRatio bands — evaluated high-to-low with strict `>`. */
      thinWallRatioBandCritical: number;
      thinWallRatioBandHigh: number;
      thinWallRatioBandModerate: number;
      /** Confidence multipliers for each band (critical/high/moderate). */
      criticalMultiplier: number;
      highMultiplier: number;
      moderateMultiplier: number;
    };
    /** Post-penalty clamp (Math.max(min, Math.min(max, confidence))). */
    confidenceClamp: { min: number; max: number };
    /** Nearest-0.1 snap levels for the final confidence value. */
    confidenceSnapLevels: number[];
    /** deriveWtStatus boundaries (all strict `>` except warningMinThicknessMm). */
    status: {
      /** thinWallRatio > this → 'critical'. */
      criticalThinRatio: number;
      /** thinWallRatio > this → 'warning'. */
      warningThinRatio: number;
      /** p5WallThickness < this → 'warning' (strict `<`). */
      warningMinThicknessMm: number;
    };
  };

  /** Overhang analysis (metrics.ts). */
  overhang: {
    /** Angle buckets for the tilt breakdown; tilt >= min && tilt < max. */
    bucketsDeg: Array<{ minAngle: number; maxAngle: number }>;
    /** Area-weighted ratio > this → severity 'severe' (else 'moderate'). */
    severitySevereRatio: number;
    /** deriveOhStatus boundaries (strict `>`). */
    statusCriticalRatio: number;
    statusWarningRatio: number;
  };

  /** Support estimation and status derivation (support.ts + metrics.deriveSupportStatus). */
  support: {
    /** Filament density used to convert support volume to grams. */
    densityGPerMm3: number;
    /** Volume-per-angle buckets; tilt >= min && tilt < max. */
    angleBuckets: Array<{ label: string; min: number; max: number; ratio: number }>;
    /** Support volume is scaled by max(minHeightMm, height). */
    minHeightMm: number;
    /**
     * difficulty derivation (support.ts). Each tier is an OR of a face-ratio
     * bound and a volume bound, all strict `>`.
     */
    difficulty: {
      /** supportRatio > this OR totalSupportVolume > next → 'very_difficult'. */
      veryDifficultFaceRatio: number;
      veryDifficultVolumeMm3: number;
      /** supportRatio > this OR totalSupportVolume > next → 'difficult'. */
      difficultFaceRatio: number;
      difficultVolumeMm3: number;
      /** supportRatio > this OR totalSupportVolume > next → 'moderate'. */
      moderateFaceRatio: number;
      moderateVolumeMm3: number;
    };
    /** Per-result confidence assignment (strict `>` on face counts). */
    confidence: {
      /** supportFaceCount > this → highConfidence. */
      highConfidenceFaceCount: number;
      /** supportFaceCount > this (else) → lowConfidence. */
      lowConfidenceFaceCount: number;
      highConfidence: number;
      lowConfidence: number;
      /** No support faces → this confidence. */
      noneConfidence: number;
    };
    /** deriveSupportStatus boundaries (metrics.ts). */
    deriveStatus: {
      /** largestRegionRatio > this AND tallSupportRatio > next → critical. */
      criticalLargestRegionRatio: number;
      criticalTallSupportRatio: number;
      /** supportRegions.length > this → warning. */
      warningIslands: number;
      /** tallSupportRatio > this → warning. */
      warningTallSupportRatio: number;
      /** directionality > this → warning. */
      warningDirectionality: number;
      /** Warning confidence = min(base + reasons*perReason, cap). */
      warningConfidenceBase: number;
      warningConfidencePerReason: number;
      warningConfidenceCap: number;
      criticalConfidence: number;
      /** No support faces at all → this confidence. */
      noSupportConfidence: number;
      goodConfidence: number;
    };
  };

  /** Print-time & cost estimation (printTime.ts). */
  printTime: {
    /** Machine-hour cost in USD. */
    machineRatePerHourUsd: number;
    /** Volumetric rate (mm³/min) per layer height (mm). */
    volumetricRates: Record<number, number>;
    defaultLayerHeightMm: number;
    /** Overhang penalty: ratio > severeRatio → ×severeMultiplier, ratio > moderateRatio → ×moderateMultiplier, else ×1. */
    overhangPenalty: {
      severeRatio: number;
      severeMultiplier: number;
      moderateRatio: number;
      moderateMultiplier: number;
    };
    /** Fixed overhead minutes per print. */
    overheadMinutes: number;
    /** Confidence tiers by volume (all strict `<`/`>` bounds). */
    confidence: {
      tinyVolumeMm3: number;
      hugeVolumeMm3: number;
      smallVolumeMm3: number;
      largeVolumeMm3: number;
      low: number;
      medium: number;
      high: number;
    };
  };

  /** Mesh validation (validation.ts). */
  validation: {
    /** Face area below this counts as degenerate (strict `<`). */
    degenerateAreaThreshold: number;
    /** degenerateCount > totalFaceCount × this → lowest confidence. */
    degenerateFaceRatioCritical: number;
    /** flippedNormalRatio > this OR any degenerate face → mid confidence. */
    flippedNormalRatioWarning: number;
    /** flippedCount > triangleCount × this → orientation is flipped. */
    flippedNormalRatioFlipOrientation: number;
    /** Confidence values for the three validation tiers. */
    confidence: { degenerate: number; warning: number; good: number };
  };

  /** Report-layer thresholds (ruleEngine.ts). */
  report: {
    /** averageConfidence < this → 'low' (strict `<`). */
    confidenceLowBelow: number;
    /** averageConfidence < this (else) → 'moderate' (strict `<`). */
    confidenceModerateBelow: number;
    /** thinWallRatio > this → wall-critical issue text (strict `>`). */
    wallCriticalThinRatio: number;
    /** maxDim < this → "unusual size" (strict `<`). */
    sizeUnusualMinMm: number;
    /** maxDim > this → "unusual size" (strict `>`). */
    sizeUnusualMaxMm: number;
    /** volume > this → 'large' process tier (strict `>`). */
    processLargeVolumeMm3: number;
    /** volume > this → 'mid' process tier (strict `>`). */
    processMidVolumeMm3: number;
  };

  /**
   * Verdict gate (lowConfidence.ts). Kept as its own group because it gates
   * whether the report shows a confident verdict at all, and it is the ONE
   * threshold that uses `>=` (not strict `>`) — 0.4 must stay trusted.
   */
  verdictGate: {
    /** Wall confidence >= this → measurement trusted (banner hidden). */
    minTrustedWallConfidence: number;
  };

  /** Thermal field & warping analysis (thermal.ts). */
  thermal: {
    /** Shrinkage percent > this → high warping risk. */
    highShrinkagePercent: number;
    /** Heat accumulation risk > this → poor inter-layer adhesion. */
    highHeatAccumulationRisk: number;
    /** Layer fill fraction > this → large flat area risk. */
    largeFlatAreaFillFraction: number;
    /** Warping risk score > this → critical recommendations. */
    criticalWarpingRisk: number;
    /** Warping risk score > this → warning recommendations. */
    warningWarpingRisk: number;
    /** Thermal risk score > this → temperature-related concerns. */
    highThermalRisk: number;
  };
}

/** Deeply-partial override shape accepted by getThresholds(). */
export type ThresholdsOverride = {
  [K in keyof AnalysisThresholds]?: AnalysisThresholds[K] extends Array<unknown>
    ? AnalysisThresholds[K]
    : AnalysisThresholds[K] extends object
      ? ThresholdsOverride[K]
      : AnalysisThresholds[K];
};

/**
 * Default thresholds — byte-identical to the pre-migration hardcoded values.
 * Overhang threshold is shared by metrics.ts and support.ts (both defaulted to
 * 50 and both compare with strict `>`).
 */
export const DEFAULT_ANALYSIS_THRESHOLDS: AnalysisThresholds = {
  overhangThresholdDeg: 50,

  wallThickness: {
    thinWallMm: 0.8,
    rayDistanceDiagonalFactor: 1.05,
    maxSamples: 200,
    minTriCount: 4,
    rayMinHitDistanceMm: 0.01,
    hitConfidenceBase: 0.3,
    hitConfidencePerHit: 0.1,
    hitConfidenceCap: 0.8,
    noHitConfidence: 0.1,
    validThicknessMinMm: 0,
    validConfidenceMin: 0.1,
    percentiles: { p1: 0.01, p5: 0.05, p10: 0.1, median: 0.5 },
    confidencePenalty: {
      thinWallRatioBandCritical: 0.25,
      thinWallRatioBandHigh: 0.1,
      thinWallRatioBandModerate: 0.02,
      criticalMultiplier: 0.5,
      highMultiplier: 0.75,
      moderateMultiplier: 0.9,
    },
    confidenceClamp: { min: 0.1, max: 0.95 },
    confidenceSnapLevels: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    status: {
      criticalThinRatio: 0.15,
      warningThinRatio: 0.05,
      warningMinThicknessMm: 0.4,
    },
  },

  overhang: {
    bucketsDeg: [
      { minAngle: 0, maxAngle: 30 },
      { minAngle: 30, maxAngle: 45 },
      { minAngle: 45, maxAngle: 60 },
      { minAngle: 60, maxAngle: 75 },
      { minAngle: 75, maxAngle: 90 },
    ],
    severitySevereRatio: 0.3,
    statusCriticalRatio: 0.15,
    statusWarningRatio: 0.05,
  },

  support: {
    densityGPerMm3: 0.00124,
    angleBuckets: [
      { label: '45-60°', min: 45, max: 60, ratio: 0.3 },
      { label: '60-75°', min: 60, max: 75, ratio: 0.5 },
      { label: '75-90°', min: 75, max: 90, ratio: 0.8 },
    ],
    minHeightMm: 0.5,
    difficulty: {
      veryDifficultFaceRatio: 0.3,
      veryDifficultVolumeMm3: 50000,
      difficultFaceRatio: 0.15,
      difficultVolumeMm3: 20000,
      moderateFaceRatio: 0.05,
      moderateVolumeMm3: 5000,
    },
    confidence: {
      highConfidenceFaceCount: 10,
      lowConfidenceFaceCount: 0,
      highConfidence: 0.6,
      lowConfidence: 0.4,
      noneConfidence: 0.9,
    },
    deriveStatus: {
      criticalLargestRegionRatio: 0.5,
      criticalTallSupportRatio: 0.3,
      warningIslands: 3,
      warningTallSupportRatio: 0.3,
      warningDirectionality: 0.7,
      warningConfidenceBase: 0.55,
      warningConfidencePerReason: 0.08,
      warningConfidenceCap: 0.85,
      criticalConfidence: 0.85,
      noSupportConfidence: 1,
      goodConfidence: 0.9,
    },
  },

  printTime: {
    machineRatePerHourUsd: 2,
    volumetricRates: {
      0.05: 120,
      0.1: 240,
      0.16: 384,
      0.2: 480,
      0.28: 672,
      0.32: 768,
    },
    defaultLayerHeightMm: 0.2,
    overhangPenalty: {
      severeRatio: 0.3,
      severeMultiplier: 1.5,
      moderateRatio: 0.15,
      moderateMultiplier: 1.25,
    },
    overheadMinutes: 5,
    confidence: {
      tinyVolumeMm3: 100,
      hugeVolumeMm3: 10000000,
      smallVolumeMm3: 1000,
      largeVolumeMm3: 1000000,
      low: 0.3,
      medium: 0.5,
      high: 0.6,
    },
  },

  validation: {
    degenerateAreaThreshold: 1e-12,
    degenerateFaceRatioCritical: 0.5,
    flippedNormalRatioWarning: 0.1,
    flippedNormalRatioFlipOrientation: 0.8,
    confidence: { degenerate: 0.2, warning: 0.7, good: 0.9 },
  },

  report: {
    confidenceLowBelow: 0.4,
    confidenceModerateBelow: 0.7,
    wallCriticalThinRatio: 0.15,
    sizeUnusualMinMm: 1,
    sizeUnusualMaxMm: 1000,
    processLargeVolumeMm3: 500000,
    processMidVolumeMm3: 50000,
  },

  verdictGate: {
    minTrustedWallConfidence: 0.4,
  },

  thermal: {
    highShrinkagePercent: 0.7,
    highHeatAccumulationRisk: 0.7,
    largeFlatAreaFillFraction: 0.7,
    criticalWarpingRisk: 0.7,
    warningWarpingRisk: 0.4,
    highThermalRisk: 0.6,
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...base };
    for (const key of Object.keys(override)) {
      const next = override[key];
      if (next === undefined) continue;
      out[key] = isPlainObject(base[key]) && isPlainObject(next)
        ? deepMerge(base[key], next)
        : next;
    }
    return out;
  }
  return override ?? base;
}

/**
 * Return the effective thresholds. With no override the frozen default is
 * returned; with an override the two are deep-merged (arrays replace
 * wholesale, objects merge key-by-key).
 */
export function getThresholds(override?: ThresholdsOverride): AnalysisThresholds {
  return override ? deepMerge(DEFAULT_ANALYSIS_THRESHOLDS, override) as AnalysisThresholds : DEFAULT_ANALYSIS_THRESHOLDS;
}

/**
 * Validate a thresholds config (default or override-merged). Returns a list of
 * human-readable problems; an empty array means the config is sound.
 */
export function validateThresholds(
  thresholds: AnalysisThresholds = DEFAULT_ANALYSIS_THRESHOLDS,
): string[] {
  const errors: string[] = [];

  const finitePositive = (path: string, value: number): void => {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${path} must be a finite number > 0, got ${value}`);
    }
  };
  const ratio = (path: string, value: number): void => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      errors.push(`${path} must be a ratio in [0, 1], got ${value}`);
    }
  };
  const strictlyIncreasing = (path: string, values: number[], label = 'must be strictly increasing'): void => {
    for (let i = 1; i < values.length; i++) {
      if (values[i] <= values[i - 1]) {
        errors.push(`${path} ${label} (index ${i - 1}=${values[i - 1]}, index ${i}=${values[i]})`);
        return;
      }
    }
  };

  // ── overhang ────────────────────────────────────────────────────────────────
  finitePositive('overhangThresholdDeg', thresholds.overhangThresholdDeg);
  if (thresholds.overhangThresholdDeg > 90) {
    errors.push(`overhangThresholdDeg must be ≤ 90, got ${thresholds.overhangThresholdDeg}`);
  }
  const bucketMinAngles = thresholds.overhang.bucketsDeg.map(b => b.minAngle);
  const bucketMaxAngles = thresholds.overhang.bucketsDeg.map(b => b.maxAngle);
  strictlyIncreasing('overhang.bucketsDeg[].minAngle', bucketMinAngles);
  for (let i = 0; i < thresholds.overhang.bucketsDeg.length; i++) {
    const bucket = thresholds.overhang.bucketsDeg[i];
    if (bucket.minAngle >= bucket.maxAngle) {
      errors.push(`overhang.bucketsDeg[${i}] minAngle (${bucket.minAngle}) must be < maxAngle (${bucket.maxAngle})`);
    }
  }
  strictlyIncreasing('overhang.bucketsDeg[].maxAngle', bucketMaxAngles, 'must be strictly increasing and < 90');
  ratio('overhang.severitySevereRatio', thresholds.overhang.severitySevereRatio);
  if (thresholds.overhang.statusCriticalRatio <= thresholds.overhang.statusWarningRatio) {
    errors.push('overhang.statusCriticalRatio must be > statusWarningRatio');
  }
  ratio('overhang.statusCriticalRatio', thresholds.overhang.statusCriticalRatio);
  ratio('overhang.statusWarningRatio', thresholds.overhang.statusWarningRatio);

  // ── wallThickness ────────────────────────────────────────────────────────────
  const wt = thresholds.wallThickness;
  finitePositive('wallThickness.thinWallMm', wt.thinWallMm);
  finitePositive('wallThickness.rayDistanceDiagonalFactor', wt.rayDistanceDiagonalFactor);
  finitePositive('wallThickness.maxSamples', wt.maxSamples);
  finitePositive('wallThickness.minTriCount', wt.minTriCount);
  finitePositive('wallThickness.rayMinHitDistanceMm', wt.rayMinHitDistanceMm);
  if (wt.hitConfidenceBase <= 0 || wt.hitConfidenceBase >= wt.hitConfidenceCap) {
    errors.push(`wallThickness.hitConfidenceBase (${wt.hitConfidenceBase}) must be in (0, hitConfidenceCap=${wt.hitConfidenceCap})`);
  }
  finitePositive('wallThickness.hitConfidencePerHit', wt.hitConfidencePerHit);
  ratio('wallThickness.hitConfidenceCap', wt.hitConfidenceCap);
  ratio('wallThickness.noHitConfidence', wt.noHitConfidence);
  ratio('wallThickness.validConfidenceMin', wt.validConfidenceMin);
  if (wt.validConfidenceMin < wt.noHitConfidence) {
    errors.push(`wallThickness.validConfidenceMin (${wt.validConfidenceMin}) must be >= noHitConfidence (${wt.noHitConfidence})`);
  }
  finitePositive('wallThickness.percentiles.p1', wt.percentiles.p1);
  strictlyIncreasing('wallThickness.percentiles', [wt.percentiles.p1, wt.percentiles.p5, wt.percentiles.p10, wt.percentiles.median], 'must be strictly increasing percentiles');
  if (wt.percentiles.median > 1) errors.push('wallThickness.percentiles.median must be ≤ 1');
  const bands = [
    wt.confidencePenalty.thinWallRatioBandCritical,
    wt.confidencePenalty.thinWallRatioBandHigh,
    wt.confidencePenalty.thinWallRatioBandModerate,
  ];
  for (const b of bands) ratio('wallThickness.confidencePenalty.thinWallRatioBand*', b);
  strictlyIncreasing('wallThickness.confidencePenalty.thinWallRatioBand*', [...bands].reverse(), 'must be strictly decreasing when read high→low');
  const multipliers = [wt.confidencePenalty.criticalMultiplier, wt.confidencePenalty.highMultiplier, wt.confidencePenalty.moderateMultiplier];
  for (let i = 0; i < multipliers.length; i++) {
    ratio(`wallThickness.confidencePenalty.multipliers[${i}]`, multipliers[i]);
  }
  if (wt.confidenceClamp.min >= wt.confidenceClamp.max) {
    errors.push(`wallThickness.confidenceClamp.min (${wt.confidenceClamp.min}) must be < max (${wt.confidenceClamp.max})`);
  }
  ratio('wallThickness.confidenceClamp.min', wt.confidenceClamp.min);
  ratio('wallThickness.confidenceClamp.max', wt.confidenceClamp.max);
  strictlyIncreasing('wallThickness.confidenceSnapLevels', wt.confidenceSnapLevels);
  if (wt.confidenceSnapLevels[0] !== 0 || wt.confidenceSnapLevels[wt.confidenceSnapLevels.length - 1] !== 1) {
    errors.push('wallThickness.confidenceSnapLevels must span [0, 1]');
  }
  if (wt.status.criticalThinRatio <= wt.status.warningThinRatio) {
    errors.push('wallThickness.status.criticalThinRatio must be > warningThinRatio');
  }
  ratio('wallThickness.status.criticalThinRatio', wt.status.criticalThinRatio);
  ratio('wallThickness.status.warningThinRatio', wt.status.warningThinRatio);
  finitePositive('wallThickness.status.warningMinThicknessMm', wt.status.warningMinThicknessMm);

  // ── support ──────────────────────────────────────────────────────────────────
  const sup = thresholds.support;
  finitePositive('support.densityGPerMm3', sup.densityGPerMm3);
  const supBucketLabels: string[] = [];
  for (let i = 0; i < sup.angleBuckets.length; i++) {
    const b = sup.angleBuckets[i];
    if (supBucketLabels.includes(b.label)) errors.push(`support.angleBuckets[${i}] duplicate label "${b.label}"`);
    supBucketLabels.push(b.label);
    if (b.min >= b.max) errors.push(`support.angleBuckets[${i}] min (${b.min}) must be < max (${b.max})`);
    if (b.min < 0 || b.max > 90) errors.push(`support.angleBuckets[${i}] must be within [0, 90]`);
    ratio(`support.angleBuckets[${i}].ratio`, b.ratio);
  }
  strictlyIncreasing('support.angleBuckets[].min', sup.angleBuckets.map(b => b.min));
  finitePositive('support.minHeightMm', sup.minHeightMm);
  const faceRatios = [sup.difficulty.moderateFaceRatio, sup.difficulty.difficultFaceRatio, sup.difficulty.veryDifficultFaceRatio];
  for (const r of faceRatios) ratio('support.difficulty.*FaceRatio', r);
  strictlyIncreasing('support.difficulty.*FaceRatio', faceRatios);
  const volumes = [sup.difficulty.moderateVolumeMm3, sup.difficulty.difficultVolumeMm3, sup.difficulty.veryDifficultVolumeMm3];
  for (const v of volumes) finitePositive('support.difficulty.*VolumeMm3', v);
  strictlyIncreasing('support.difficulty.*VolumeMm3', volumes);
  if (sup.confidence.highConfidenceFaceCount <= sup.confidence.lowConfidenceFaceCount) {
    errors.push('support.confidence.highConfidenceFaceCount must be > lowConfidenceFaceCount');
  }
  finitePositive('support.confidence.highConfidenceFaceCount', sup.confidence.highConfidenceFaceCount);
  ratio('support.confidence.highConfidence', sup.confidence.highConfidence);
  ratio('support.confidence.lowConfidence', sup.confidence.lowConfidence);
  ratio('support.confidence.noneConfidence', sup.confidence.noneConfidence);
  ratio('support.deriveStatus.criticalLargestRegionRatio', sup.deriveStatus.criticalLargestRegionRatio);
  ratio('support.deriveStatus.criticalTallSupportRatio', sup.deriveStatus.criticalTallSupportRatio);
  finitePositive('support.deriveStatus.warningIslands', sup.deriveStatus.warningIslands);
  ratio('support.deriveStatus.warningTallSupportRatio', sup.deriveStatus.warningTallSupportRatio);
  ratio('support.deriveStatus.warningDirectionality', sup.deriveStatus.warningDirectionality);
  if (sup.deriveStatus.warningConfidenceBase >= sup.deriveStatus.warningConfidenceCap) {
    errors.push('support.deriveStatus.warningConfidenceBase must be < warningConfidenceCap');
  }
  ratio('support.deriveStatus.warningConfidenceBase', sup.deriveStatus.warningConfidenceBase);
  finitePositive('support.deriveStatus.warningConfidencePerReason', sup.deriveStatus.warningConfidencePerReason);
  ratio('support.deriveStatus.warningConfidenceCap', sup.deriveStatus.warningConfidenceCap);
  ratio('support.deriveStatus.criticalConfidence', sup.deriveStatus.criticalConfidence);
  ratio('support.deriveStatus.noSupportConfidence', sup.deriveStatus.noSupportConfidence);
  ratio('support.deriveStatus.goodConfidence', sup.deriveStatus.goodConfidence);

  // ── printTime ────────────────────────────────────────────────────────────────
  const pt = thresholds.printTime;
  finitePositive('printTime.machineRatePerHourUsd', pt.machineRatePerHourUsd);
  const rateKeys = Object.keys(pt.volumetricRates).map(Number);
  for (const [key, value] of Object.entries(pt.volumetricRates)) {
    finitePositive(`printTime.volumetricRates[${key}]`, value);
    const k = Number(key);
    if (!Number.isFinite(k) || k <= 0) {
      errors.push(`printTime.volumetricRates key "${key}" must be a finite number > 0`);
    }
  }
  strictlyIncreasing('printTime.volumetricRates layer-height keys', rateKeys);
  finitePositive('printTime.defaultLayerHeightMm', pt.defaultLayerHeightMm);
  if (pt.overhangPenalty.severeRatio <= pt.overhangPenalty.moderateRatio) {
    errors.push('printTime.overhangPenalty.severeRatio must be > moderateRatio');
  }
  ratio('printTime.overhangPenalty.severeRatio', pt.overhangPenalty.severeRatio);
  ratio('printTime.overhangPenalty.moderateRatio', pt.overhangPenalty.moderateRatio);
  if (pt.overhangPenalty.severeMultiplier <= pt.overhangPenalty.moderateMultiplier) {
    errors.push('printTime.overhangPenalty.severeMultiplier must be > moderateMultiplier');
  }
  finitePositive('printTime.overhangPenalty.severeMultiplier', pt.overhangPenalty.severeMultiplier);
  finitePositive('printTime.overhangPenalty.moderateMultiplier', pt.overhangPenalty.moderateMultiplier);
  finitePositive('printTime.overheadMinutes', pt.overheadMinutes);
  const volumeBounds = [pt.confidence.tinyVolumeMm3, pt.confidence.smallVolumeMm3, pt.confidence.largeVolumeMm3, pt.confidence.hugeVolumeMm3];
  for (const v of volumeBounds) finitePositive('printTime.confidence.*VolumeMm3', v);
  strictlyIncreasing('printTime.confidence volume bounds', volumeBounds);
  strictlyIncreasing('printTime.confidence confidence levels', [pt.confidence.low, pt.confidence.medium, pt.confidence.high]);
  for (const c of [pt.confidence.low, pt.confidence.medium, pt.confidence.high]) ratio('printTime.confidence level', c);

  // ── validation ───────────────────────────────────────────────────────────────
  const va = thresholds.validation;
  finitePositive('validation.degenerateAreaThreshold', va.degenerateAreaThreshold);
  ratio('validation.degenerateFaceRatioCritical', va.degenerateFaceRatioCritical);
  ratio('validation.flippedNormalRatioWarning', va.flippedNormalRatioWarning);
  ratio('validation.flippedNormalRatioFlipOrientation', va.flippedNormalRatioFlipOrientation);
  if (va.flippedNormalRatioFlipOrientation < va.flippedNormalRatioWarning) {
    errors.push('validation.flippedNormalRatioFlipOrientation must be ≥ flippedNormalRatioWarning');
  }
  strictlyIncreasing('validation.confidence', [va.confidence.degenerate, va.confidence.warning, va.confidence.good]);

  // ── report ───────────────────────────────────────────────────────────────────
  const rep = thresholds.report;
  ratio('report.confidenceLowBelow', rep.confidenceLowBelow);
  ratio('report.confidenceModerateBelow', rep.confidenceModerateBelow);
  if (rep.confidenceLowBelow >= rep.confidenceModerateBelow) {
    errors.push('report.confidenceLowBelow must be < confidenceModerateBelow');
  }
  ratio('report.wallCriticalThinRatio', rep.wallCriticalThinRatio);
  if (rep.sizeUnusualMinMm >= rep.sizeUnusualMaxMm) {
    errors.push('report.sizeUnusualMinMm must be < sizeUnusualMaxMm');
  }
  finitePositive('report.sizeUnusualMinMm', rep.sizeUnusualMinMm);
  finitePositive('report.sizeUnusualMaxMm', rep.sizeUnusualMaxMm);
  if (rep.processMidVolumeMm3 >= rep.processLargeVolumeMm3) {
    errors.push('report.processMidVolumeMm3 must be < processLargeVolumeMm3');
  }
  finitePositive('report.processMidVolumeMm3', rep.processMidVolumeMm3);
  finitePositive('report.processLargeVolumeMm3', rep.processLargeVolumeMm3);

  // ── verdictGate ──────────────────────────────────────────────────────────────
  ratio('verdictGate.minTrustedWallConfidence', thresholds.verdictGate.minTrustedWallConfidence);
  if (thresholds.verdictGate.minTrustedWallConfidence <= 0 || thresholds.verdictGate.minTrustedWallConfidence > 1) {
    errors.push('verdictGate.minTrustedWallConfidence must be in (0, 1]');
  }

  return errors;
}
