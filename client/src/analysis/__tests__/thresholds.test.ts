import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ANALYSIS_THRESHOLDS,
  getThresholds,
  validateThresholds,
  type ThresholdsOverride,
} from '../thresholds';

describe('DEFAULT_ANALYSIS_THRESHOLDS — byte-equivalence with legacy literals', () => {
  it('overhang & wall-thickness core values match the pre-migration literals', () => {
    expect(DEFAULT_ANALYSIS_THRESHOLDS.overhangThresholdDeg).toBe(50);
    const wt = DEFAULT_ANALYSIS_THRESHOLDS.wallThickness;
    expect(wt.thinWallMm).toBe(0.8);
    expect(wt.rayDistanceDiagonalFactor).toBe(1.05);
    expect(wt.maxSamples).toBe(200);
    expect(wt.hitConfidenceBase).toBe(0.3);
    expect(wt.hitConfidencePerHit).toBe(0.1);
    expect(wt.hitConfidenceCap).toBe(0.8);
    expect(wt.noHitConfidence).toBe(0.1);
    expect(wt.confidencePenalty.criticalMultiplier).toBe(0.5);
    expect(wt.confidencePenalty.highMultiplier).toBe(0.75);
    expect(wt.confidencePenalty.moderateMultiplier).toBe(0.9);
    expect(wt.confidencePenalty.thinWallRatioBandCritical).toBe(0.25);
    expect(wt.confidencePenalty.thinWallRatioBandHigh).toBe(0.1);
    expect(wt.confidencePenalty.thinWallRatioBandModerate).toBe(0.02);
    expect(wt.confidenceClamp).toEqual({ min: 0.1, max: 0.95 });
    expect(wt.status.criticalThinRatio).toBe(0.15);
    expect(wt.status.warningThinRatio).toBe(0.05);
    expect(wt.status.warningMinThicknessMm).toBe(0.4);
    expect(wt.percentiles).toEqual({ p1: 0.01, p5: 0.05, p10: 0.1, median: 0.5 });
    expect(wt.validThicknessMinMm).toBe(0);
    expect(wt.validConfidenceMin).toBe(0.1);
    expect(wt.minTriCount).toBe(4);
    expect(wt.rayMinHitDistanceMm).toBe(0.01);
    expect(wt.confidenceSnapLevels).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });

  it('overhang buckets and deriveOhStatus match metrics.ts', () => {
    const oh = DEFAULT_ANALYSIS_THRESHOLDS.overhang;
    expect(oh.bucketsDeg).toEqual([
      { minAngle: 0, maxAngle: 30 },
      { minAngle: 30, maxAngle: 45 },
      { minAngle: 45, maxAngle: 60 },
      { minAngle: 60, maxAngle: 75 },
      { minAngle: 75, maxAngle: 90 },
    ]);
    expect(oh.severitySevereRatio).toBe(0.3);
    expect(oh.statusCriticalRatio).toBe(0.15);
    expect(oh.statusWarningRatio).toBe(0.05);
  });

  it('support values match support.ts and deriveSupportStatus', () => {
    const sup = DEFAULT_ANALYSIS_THRESHOLDS.support;
    expect(sup.densityGPerMm3).toBe(0.00124);
    expect(sup.angleBuckets).toEqual([
      { label: '45-60°', min: 45, max: 60, ratio: 0.3 },
      { label: '60-75°', min: 60, max: 75, ratio: 0.5 },
      { label: '75-90°', min: 75, max: 90, ratio: 0.8 },
    ]);
    expect(sup.minHeightMm).toBe(0.5);
    expect(sup.difficulty).toEqual({
      veryDifficultFaceRatio: 0.3,
      veryDifficultVolumeMm3: 50000,
      difficultFaceRatio: 0.15,
      difficultVolumeMm3: 20000,
      moderateFaceRatio: 0.05,
      moderateVolumeMm3: 5000,
    });
    expect(sup.confidence).toEqual({
      highConfidenceFaceCount: 10,
      lowConfidenceFaceCount: 0,
      highConfidence: 0.6,
      lowConfidence: 0.4,
      noneConfidence: 0.9,
    });
    expect(sup.deriveStatus).toEqual({
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
    });
  });

  it('printTime values match printTime.ts', () => {
    const pt = DEFAULT_ANALYSIS_THRESHOLDS.printTime;
    expect(pt.machineRatePerHourUsd).toBe(2);
    expect(pt.volumetricRates).toEqual({ 0.05: 120, 0.1: 240, 0.16: 384, 0.2: 480, 0.28: 672, 0.32: 768 });
    expect(pt.defaultLayerHeightMm).toBe(0.2);
    expect(pt.overhangPenalty).toEqual({ severeRatio: 0.3, severeMultiplier: 1.5, moderateRatio: 0.15, moderateMultiplier: 1.25 });
    expect(pt.overheadMinutes).toBe(5);
    expect(pt.confidence).toEqual({
      tinyVolumeMm3: 100,
      hugeVolumeMm3: 10000000,
      smallVolumeMm3: 1000,
      largeVolumeMm3: 1000000,
      low: 0.3,
      medium: 0.5,
      high: 0.6,
    });
  });

  it('validation values match validation.ts', () => {
    const va = DEFAULT_ANALYSIS_THRESHOLDS.validation;
    expect(va.degenerateAreaThreshold).toBe(1e-12);
    expect(va.degenerateFaceRatioCritical).toBe(0.5);
    expect(va.flippedNormalRatioWarning).toBe(0.1);
    expect(va.flippedNormalRatioFlipOrientation).toBe(0.8);
    expect(va.confidence).toEqual({ degenerate: 0.2, warning: 0.7, good: 0.9 });
  });

  it('report values match ruleEngine.ts', () => {
    const rep = DEFAULT_ANALYSIS_THRESHOLDS.report;
    expect(rep.confidenceLowBelow).toBe(0.4);
    expect(rep.confidenceModerateBelow).toBe(0.7);
    expect(rep.wallCriticalThinRatio).toBe(0.15);
    expect(rep.sizeUnusualMinMm).toBe(1);
    expect(rep.sizeUnusualMaxMm).toBe(1000);
    expect(rep.processLargeVolumeMm3).toBe(500000);
    expect(rep.processMidVolumeMm3).toBe(50000);
  });

  it('verdictGate value matches lowConfidence.ts', () => {
    expect(DEFAULT_ANALYSIS_THRESHOLDS.verdictGate.minTrustedWallConfidence).toBe(0.4);
  });
});

describe('getThresholds deep-merge', () => {
  it('returns the default object untouched when called without an override', () => {
    const t = getThresholds();
    expect(t).toBe(DEFAULT_ANALYSIS_THRESHOLDS);
    expect(validateThresholds(t)).toEqual([]);
  });

  it('overrides a nested scalar without disturbing siblings', () => {
    const t = getThresholds({ wallThickness: { thinWallMm: 1.2 } });
    expect(t.wallThickness.thinWallMm).toBe(1.2);
    expect(t.overhangThresholdDeg).toBe(50);
    expect(t.wallThickness.confidenceClamp).toEqual({ min: 0.1, max: 0.95 });
  });

  it('deep-merges nested object groups', () => {
    const t = getThresholds({ support: { confidence: { highConfidence: 0.7 } } });
    expect(t.support.confidence.highConfidence).toBe(0.7);
    expect(t.support.confidence.lowConfidence).toBe(0.4);
    expect(t.support.confidence.noneConfidence).toBe(0.9);
  });

  it('replaces arrays wholesale (buckets) rather than merging element-wise', () => {
    const t = getThresholds({ overhang: { bucketsDeg: [{ minAngle: 0, maxAngle: 90 }] } });
    expect(t.overhang.bucketsDeg).toEqual([{ minAngle: 0, maxAngle: 90 }]);
    expect(validateThresholds({ ...DEFAULT_ANALYSIS_THRESHOLDS, overhang: { ...DEFAULT_ANALYSIS_THRESHOLDS.overhang, bucketsDeg: t.overhang.bucketsDeg } })).toEqual([]);
  });

  it('treats undefined keys in an override as no-ops', () => {
    const t = getThresholds({ verdictGate: { minTrustedWallConfidence: undefined } } as ThresholdsOverride);
    expect(t.verdictGate.minTrustedWallConfidence).toBe(0.4);
  });
});

describe('validateThresholds', () => {
  it('rejects a non-finite value', () => {
    const bad = getThresholds({ verdictGate: { minTrustedWallConfidence: Number.NaN } });
    expect(validateThresholds(bad)).toContain('verdictGate.minTrustedWallConfidence must be a ratio in [0, 1], got NaN');
  });

  it('rejects an out-of-range ratio', () => {
    const bad = getThresholds({ wallThickness: { noHitConfidence: 1.5 } });
    expect(validateThresholds(bad)).toContain('wallThickness.noHitConfidence must be a ratio in [0, 1], got 1.5');
  });

  it('rejects unordered status tiers', () => {
    const bad = getThresholds({ wallThickness: { status: { criticalThinRatio: 0.04 } } });
    expect(validateThresholds(bad).some(e => e.includes('wallThickness.status.criticalThinRatio must be > warningThinRatio'))).toBe(true);
  });

  it('rejects snap levels that do not walk 0 → 1', () => {
    const bad = getThresholds({ wallThickness: { confidenceSnapLevels: [0.2, 0.4] } });
    const errors = validateThresholds(bad);
    expect(errors.some(e => e.includes('wallThickness.confidenceSnapLevels must span [0, 1]'))).toBe(true);
  });

  it('rejects support confidence tiers out of order', () => {
    const bad = getThresholds({ support: { confidence: { lowConfidenceFaceCount: 12 } } });
    expect(validateThresholds(bad).some(e => e.includes('support.confidence.highConfidenceFaceCount must be > lowConfidenceFaceCount'))).toBe(true);
  });

  it('returns no errors for the pristine default', () => {
    expect(validateThresholds()).toEqual([]);
  });
});