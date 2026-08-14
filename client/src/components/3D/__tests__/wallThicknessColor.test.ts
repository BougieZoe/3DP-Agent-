import { describe, it, expect } from 'vitest';
import { wallThicknessColor } from '../WallThicknessHeatmap';

const THIN = 0.8;

describe('wallThicknessColor', () => {
  it('thin walls (<= thinWallMm) resolve to hot red', () => {
    const [r, g, b] = wallThicknessColor(0.4, THIN, 5);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeLessThan(0.3);
  });

  it('boundary value at thinWallMm clamps to red', () => {
    const [r, g, b] = wallThicknessColor(THIN, THIN, 5);
    expect(r).toBe(1.0);
    expect(g).toBeLessThan(0.2);
    expect(b).toBeLessThan(0.2);
  });

  it('thick walls (>= maxMm) resolve to cyan', () => {
    const [r, g, b] = wallThicknessColor(6, THIN, 5);
    expect(b).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(r);
  });

  it('ramp is monotonic: red falls, blue rises across the domain', () => {
    const reds: number[] = [];
    const blues: number[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = 0.8 + (4.2 * i) / 20;
      const [r, , b] = wallThicknessColor(t, THIN, 5);
      reds.push(r);
      blues.push(b);
    }
    for (let i = 1; i < reds.length; i++) {
      expect(reds[i]).toBeLessThanOrEqual(reds[i - 1] + 1e-9);
      expect(blues[i]).toBeGreaterThanOrEqual(blues[i - 1] - 1e-9);
    }
  });

  it('degenerate domain (maxMm === thinWallMm) does not divide by zero', () => {
    const [r, g, b] = wallThicknessColor(0.5, THIN, THIN);
    expect(Number.isFinite(r)).toBe(true);
    expect(Number.isFinite(g)).toBe(true);
    expect(Number.isFinite(b)).toBe(true);
  });
});
