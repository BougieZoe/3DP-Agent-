import { describe, expect, it } from 'vitest';
import { computeLiquidCoolingMetrics, PRESSURE_WALL_MM } from '../liquidCooling';

const base = {
  minWallThicknessMm: 2.0,
  p5WallThicknessMm: 1.8,
  thinWallRatio: 0.0,
  surfaceAreaMm2: 1000,
  volumeMm3: 2000, // 0.5 mm²/mm³ → mid heat-exchange proxy
  shellCount: 1,
  enclosedCavity: false,
  powderTrap: false,
};

describe('computeLiquidCoolingMetrics', () => {
  it('a healthy cold-plate geometry has low risk', () => {
    const r = computeLiquidCoolingMetrics(base);
    expect(r.leakRisk).toBeLessThan(0.4);
    expect(r.channelRisk).toBe(0);
    expect(r.overallRisk).toBeLessThan(0.5);
    expect(r.concerns.some(c => c.includes('reasonable'))).toBe(true);
  });

  it('thin pressure walls push leak risk up', () => {
    const r = computeLiquidCoolingMetrics({ ...base, minWallThicknessMm: 0.4, p5WallThicknessMm: 0.3, thinWallRatio: 0.2 });
    expect(r.leakRisk).toBeGreaterThan(0.5);
    expect(r.pressureWall.minThicknessMm).toBe(0.4);
    expect(r.pressureWall.thresholdMm).toBe(PRESSURE_WALL_MM);
    expect(r.concerns.some(c => c.includes('leak'))).toBe(true);
  });

  it('an enclosed dead-end cavity is a channel risk', () => {
    const r = computeLiquidCoolingMetrics({ ...base, shellCount: 2, enclosedCavity: true });
    expect(r.channelRisk).toBeGreaterThan(0.5);
    expect(r.concerns.some(c => c.includes('cannot flow'))).toBe(true);
  });

  it('metal powder trapped in a channel is the worst channel case', () => {
    const r = computeLiquidCoolingMetrics({ ...base, shellCount: 2, enclosedCavity: true, powderTrap: true });
    expect(r.channelRisk).toBeGreaterThan(0.7);
    expect(r.concerns.some(c => c.includes('powder'))).toBe(true);
  });

  it('more surface per volume raises the heat-exchange proxy', () => {
    const flat = computeLiquidCoolingMetrics({ ...base, surfaceAreaMm2: 1000, volumeMm3: 2000 });
    const finned = computeLiquidCoolingMetrics({ ...base, surfaceAreaMm2: 6000, volumeMm3: 2000 }); // 3 mm²/mm³
    expect(finned.heatExchangeProxy).toBeGreaterThan(flat.heatExchangeProxy);
    expect(finned.heatExchangeProxy).toBe(1); // capped at 1
  });

  it('missing min-wall measurement still returns a bounded result', () => {
    const r = computeLiquidCoolingMetrics({ ...base, minWallThicknessMm: null, p5WallThicknessMm: null });
    expect(r.leakRisk).toBeGreaterThanOrEqual(0);
    expect(r.leakRisk).toBeLessThanOrEqual(1);
    expect(r.overallRisk).toBeGreaterThanOrEqual(0);
    expect(r.overallRisk).toBeLessThanOrEqual(1);
  });
});
