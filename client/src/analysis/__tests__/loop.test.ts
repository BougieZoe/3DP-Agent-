import { describe, it, expect } from 'vitest';
import { computeLoopMetrics } from '../loop';
import { MATERIALS } from '@shared/domain/material';

const BASE = {
  meshVolumeMm3: 6120,
  surfaceAreaMm2: 8196,
  minWallThicknessMm: 0.4,
  thinWallRatio: 0.0952,
  overhangRatio: 0.05,
  supportDifficulty: 'easy' as const,
  supportGrams: 0.1,
  materialCostUsd: 0.17,
  machineCostUsd: 0.6,
  material: MATERIALS.PLA,
  technology: 'fdm' as const,
  contaminated: false,
};

describe('computeLoopMetrics', () => {
  it('scores a clean model 100 with zero failure cost', () => {
    const r = computeLoopMetrics({
      ...BASE,
      thinWallRatio: 0,
      overhangRatio: 0,
      supportDifficulty: 'none',
      supportGrams: 0,
      minWallThicknessMm: 2,
    });
    expect(r.firstTime.score).toBe(100);
    expect(r.firstTime.expectedFailureCostUsd).toBe(0);
    expect(r.firstTime.drivers[0]).toMatch(/no major/i);
  });

  it('penalizes wall_tower-like risks deterministically', () => {
    const a = computeLoopMetrics(BASE);
    const b = computeLoopMetrics(BASE);
    expect(a).toEqual(b); // same input → same output, every run
    // 100 − 5 (easy) − 1.5 (overhang) − 2.38 (thin) → 91
    expect(a.firstTime.score).toBe(91);
    expect(a.firstTime.drivers.length).toBeLessThanOrEqual(3);
    // (1 − 0.91) × (0.17 + 0.60)
    expect(a.firstTime.expectedFailureCostUsd).toBeCloseTo(0.07, 2);
  });

  it('keeps waste units consistent (kg/kg, not g/kg)', () => {
    const r = computeLoopMetrics(BASE);
    // part ≈ 7.59 g, support 0.1 g, loss 10% → ratio ≈ 0.11, never thousands
    expect(r.waste.wasteRatio).toBeGreaterThan(0);
    expect(r.waste.wasteRatio).toBeLessThan(1);
    expect(r.waste.wasteRatio).toBeCloseTo(0.11, 2);
  });

  it('routes PLA support to recyclable', () => {
    const r = computeLoopMetrics(BASE);
    expect(r.waste.fate).toBe('recyclable');
    expect(r.waste.contaminated).toBe(false);
  });

  it('routes pellet-process scrap to fgf-direct, contaminated to landfill', () => {
    const fgf = computeLoopMetrics({
      ...BASE,
      material: MATERIALS.ABS_PELLET,
      technology: 'fgf' as const,
      supportGrams: 27,
    });
    expect(fgf.waste.fate).toBe('fgf-direct');

    const mixed = computeLoopMetrics({ ...BASE, contaminated: true });
    expect(mixed.waste.fate).toBe('landfill');
    expect(mixed.waste.contaminated).toBe(true);
  });

  it('lands unknown materials in landfill with null EOL', () => {
    const r = computeLoopMetrics({
      ...BASE,
      material: MATERIALS.TPU, // no eol profile
    });
    expect(r.waste.fate).toBe('landfill');
    expect(r.eol.monthsCompost).toBeNull();
    expect(r.eol.basisNote).toMatch(/no end-of-life data/i);
  });

  it('adjusts the compost range by geometry for bio cellulose acetate', () => {
    const r = computeLoopMetrics({
      ...BASE,
      material: MATERIALS.ECO_CELLULOSE_ACETATE,
      technology: 'eco' as const,
    });
    // base [2, 6] × 0.75 (min wall 0.4 < 1.0); sv 1.34 keeps ×1 → [2, 5]
    expect(r.eol.monthsCompost).toEqual([2, 5]);
    expect(r.eol.marineDegradable).toBe(true);
    expect(r.eol.geometryFactor).toBe(0.75);
    expect(r.waste.fate).toBe('recyclable');
  });

  it('handles zero volume without crashing', () => {
    const r = computeLoopMetrics({ ...BASE, meshVolumeMm3: 0 });
    expect(r.waste.wasteRatio).toBe(0);
    expect(r.firstTime.score).toBeGreaterThanOrEqual(0);
  });
});
