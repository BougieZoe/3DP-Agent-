import { describe, it, expect } from 'vitest';
import { binSamples, getBinColor } from '../WallThicknessHistogram';
import type { WallThicknessSample } from '../../analysis/types';

function sample(thickness: number, confidence = 0.5): WallThicknessSample {
  return { position: { x: 0, y: 0, z: 0 }, thickness, confidence };
}

describe('binSamples', () => {
  it('returns empty bins for empty input', () => {
    const result = binSamples([], 12);
    expect(result.validCount).toBe(0);
    expect(result.bins).toHaveLength(0);
  });

  it('filters out zero-thickness samples', () => {
    const samples = [sample(0, 0.1), sample(0, 0.5), sample(1.5)];
    const result = binSamples(samples, 12);
    expect(result.validCount).toBe(1);
  });

  it('filters out low-confidence samples', () => {
    const samples = [sample(1.0, 0.1), sample(2.0, 0.05), sample(3.0, 0.5)];
    const result = binSamples(samples, 12);
    // confidence <= 0.1 is filtered
    expect(result.validCount).toBe(1);
  });

  it('produces a single bin when all values are identical', () => {
    const samples = [sample(1.5), sample(1.5), sample(1.5)];
    const result = binSamples(samples, 12);
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0].count).toBe(3);
    expect(result.validCount).toBe(3);
  });

  it('distributes samples across bins', () => {
    const samples = [
      sample(0.5), sample(1.0), sample(1.5), sample(2.0),
      sample(2.5), sample(3.0), sample(3.5), sample(4.0),
    ];
    const result = binSamples(samples, 4);
    expect(result.bins).toHaveLength(4);
    expect(result.validCount).toBe(8);
    // All bins should have at least one sample
    expect(result.bins.every(b => b.count > 0)).toBe(true);
  });

  it('returns correct min/max', () => {
    const samples = [sample(0.3), sample(2.7)];
    const result = binSamples(samples, 12);
    expect(result.min).toBeCloseTo(0.3);
    expect(result.max).toBeCloseTo(2.7);
  });

  it('first bin minVal <= threshold even when maxVal exceeds it (stepped-wall regression)', () => {
    const thin = Array.from({ length: 12 }, () => sample(0.5));
    const thick = Array.from({ length: 10 }, () => sample(4.0));
    const extra = Array.from({ length: 4 }, () => sample(10.0));
    const result = binSamples([...thin, ...thick, ...extra], 12);
    const firstBin = result.bins[0];
    expect(firstBin.minVal).toBeLessThanOrEqual(0.8);
    expect(firstBin.maxVal).toBeGreaterThan(0.8);
    // Color logic: use minVal, not maxVal — maxVal fails to flag thin section
    expect(firstBin.minVal <= 0.8).toBe(true);
    expect(firstBin.maxVal <= 0.8).toBe(false);
  });

  it('color decision matches component logic: red when minVal <= threshold', () => {
    // Regression: component passes entry.minVal to getBinColor, not entry.maxVal.
    // Stepped-wall first bin: minVal=0.5, maxVal=2.917, threshold=0.8
    // minVal → red (correct thin-wall warning), maxVal → blue (silent miss)
    const { bins } = binSamples(
      [...Array(12).fill(null).map(() => sample(0.5)),
       ...Array(10).fill(null).map(() => sample(4.0)),
       ...Array(4).fill(null).map(() => sample(10.0))],
      12,
    );
    const firstBin = bins[0];
    expect(getBinColor(firstBin.minVal, 0.8)).toBe('#cc6666');
    expect(getBinColor(firstBin.maxVal, 0.8)).toBe('#66ccff');
  });
});
