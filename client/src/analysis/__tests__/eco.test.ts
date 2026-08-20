import { describe, expect, it } from 'vitest';
import { computeEcoMetrics } from '../eco';

describe('computeEcoMetrics', () => {
  it('raises brittleness risk when walls are thin on a brittle material', () => {
    const brittleThin = computeEcoMetrics({ moistureRisk: 0.5, degradationRisk: 0.6, brittlenessRisk: 0.7, thinWallRatio: 0.1 });
    const brittleThick = computeEcoMetrics({ moistureRisk: 0.5, degradationRisk: 0.6, brittlenessRisk: 0.7, thinWallRatio: 0.01 });
    expect(brittleThin.brittlenessRisk).toBeGreaterThan(brittleThick.brittlenessRisk);
    expect(brittleThin.brittlenessRisk).toBeGreaterThan(0.6);
    expect(brittleThin.concerns.some(c => c.includes('brittle'))).toBe(true);
  });

  it('surfaces moisture and degradation advisories', () => {
    const r = computeEcoMetrics({ moistureRisk: 0.8, degradationRisk: 0.7, brittlenessRisk: 0.2, thinWallRatio: 0 });
    expect(r.concerns.some(c => c.includes('dry'))).toBe(true);
    expect(r.concerns.some(c => c.includes('heat/UV'))).toBe(true);
  });

  it('stays quiet and bounded for a well-behaved geometry', () => {
    const r = computeEcoMetrics({ moistureRisk: 0.2, degradationRisk: 0.2, brittlenessRisk: 0.2, thinWallRatio: 0 });
    expect(r.concerns.some(c => c.includes('no major red flags'))).toBe(true);
    expect(r.moistureRisk).toBeLessThanOrEqual(1);
    expect(r.degradationRisk).toBeLessThanOrEqual(1);
    expect(r.brittlenessRisk).toBeLessThanOrEqual(1);
  });
});
