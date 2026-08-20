import { describe, expect, it } from 'vitest';
import { computeConcreteMetrics, CONCRETE_NOZZLE_MM } from '../concrete';

const base = { minWallThicknessMm: 100, overhangRatio: 0.1, surfaceAreaMm2: 6e6, volumeMm3: 1e9 };

describe('computeConcreteMetrics', () => {
  it('flags features thinner than ~2× nozzle as under-resolved', () => {
    const thin = computeConcreteMetrics({ ...base, minWallThicknessMm: 10 });
    const thick = computeConcreteMetrics({ ...base, minWallThicknessMm: 100 });
    expect(thin.featureResolutionRisk).toBeGreaterThan(thick.featureResolutionRisk);
    expect(thin.featureResolutionRisk).toBeGreaterThan(0.5);
    expect(thin.concerns.some(c => c.includes('nozzle'))).toBe(true);
    expect(CONCRETE_NOZZLE_MM).toBe(20);
  });

  it('high overhang ratio maps to sag risk', () => {
    expect(computeConcreteMetrics({ ...base, overhangRatio: 0.7 }).overhangSagRisk).toBe(0.7);
    expect(computeConcreteMetrics({ ...base, overhangRatio: 0.7 }).concerns.some(c => c.includes('sag'))).toBe(true);
  });

  it('high surface-area-per-volume maps to drying-crack risk', () => {
    const porous = computeConcreteMetrics({ ...base, surfaceAreaMm2: 9e8, volumeMm3: 1e9 }); // SA/V = 0.9
    expect(porous.crackRisk).toBeGreaterThan(0.5);
    expect(porous.concerns.some(c => c.includes('crack'))).toBe(true);
  });

  it('estimates print time from volume (~4h per m³)', () => {
    expect(computeConcreteMetrics({ ...base, volumeMm3: 2e9 }).printTimeHours).toBeCloseTo(8, 0);
    expect(computeConcreteMetrics({ ...base, volumeMm3: 1 }).printTimeHours).toBeGreaterThanOrEqual(0.5);
  });

  it('healthy geometry reports no concerns and bounded risks', () => {
    const r = computeConcreteMetrics({ ...base, minWallThicknessMm: 200, overhangRatio: 0.05 });
    expect(r.featureResolutionRisk).toBeLessThanOrEqual(1);
    expect(r.featureResolutionRisk).toBeGreaterThanOrEqual(0);
    expect(r.concerns.some(c => c.includes('printable'))).toBe(true);
  });
});
