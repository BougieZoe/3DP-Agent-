import { describe, expect, it } from 'vitest';
import {
  evaluateOverhangHeuristic,
  evaluateWallThicknessHeuristic,
} from '../printabilityHeuristics';

describe('printability heuristics', () => {
  it('preserves current wall thickness thresholds', () => {
    expect(evaluateWallThicknessHeuristic({ x: 1, y: 10, z: 10 }, 30)).toEqual({
      minThickness: 0.5,
      areas: 4,
      status: 'critical',
    });

    expect(evaluateWallThicknessHeuristic({ x: 3, y: 10, z: 10 }, 30)).toEqual({
      minThickness: 1.5,
      areas: 4,
      status: 'warning',
    });

    expect(evaluateWallThicknessHeuristic({ x: 6, y: 10, z: 10 }, 30)).toEqual({
      minThickness: 3,
      areas: 4,
      status: 'good',
    });
  });

  it('preserves current overhang counting behavior', () => {
    const normals = new Float32Array([
      0, Math.cos(10 * Math.PI / 180), 0,
      0, Math.cos(50 * Math.PI / 180), 0,
    ]);

    expect(evaluateOverhangHeuristic(normals, 9)).toEqual({
      angle: 45,
      areas: 1,
      status: 'warning',
    });
  });
});
