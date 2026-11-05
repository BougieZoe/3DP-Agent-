import { describe, it, expect } from 'vitest';
import { thickenDeltaMm } from '../autoThicken';

/**
 * The offset amount is the one piece of this that is pure arithmetic. It has
 * two safety properties worth pinning: it never exceeds the cap, and it refuses
 * to "fix" a part that is already above target (a positive delta there would
 * silently grow the part for no reason).
 */
describe('thickenDeltaMm', () => {
  it('moves each surface half the missing thickness', () => {
    expect(thickenDeltaMm(0.2, 0.8)).toBeCloseTo(0.3);
    expect(thickenDeltaMm(0.6, 0.8)).toBeCloseTo(0.1);
  });

  it('caps the offset so a thin-wall fix cannot balloon the part', () => {
    expect(thickenDeltaMm(0.01, 0.8)).toBeCloseTo(0.395); // under the cap
    expect(thickenDeltaMm(0.01, 20)).toBe(2);             // capped
  });

  it('refuses when walls are already at or above target', () => {
    expect(() => thickenDeltaMm(0.8, 0.8)).toThrow(/already at or above/);
    expect(() => thickenDeltaMm(1.2, 0.8)).toThrow(/already at or above/);
  });

  it('refuses without a measurement instead of guessing', () => {
    expect(() => thickenDeltaMm(null)).toThrow(/No wall-thickness measurement/);
    expect(() => thickenDeltaMm(Number.NaN)).toThrow(/No wall-thickness measurement/);
  });
});

import { isThickenImprovement } from '../autoThicken';

describe('isThickenImprovement', () => {
  it('accepts a real gain and rejects a regression or a wash', () => {
    expect(isThickenImprovement(0.11, 0.35)).toBe(true);
    expect(isThickenImprovement(0.11, 0.02)).toBe(false); // observed on an open mesh
    expect(isThickenImprovement(0.11, 0.11)).toBe(false);
  });

  it('refuses to judge when either side is unmeasured', () => {
    expect(isThickenImprovement(null, 0.4)).toBe(false);
    expect(isThickenImprovement(0.2, null)).toBe(false);
    expect(isThickenImprovement(Number.NaN, 0.4)).toBe(false);
  });
});
