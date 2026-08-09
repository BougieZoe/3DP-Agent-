/**
 * Physical-truth tests for the canonical wall-thickness raycast.
 *
 * The two regressions this suite pins:
 *  - `maxRayDist` was hardcoded to 20 (model units): any part whose interior
 *    chord exceeds 20 silently "missed" every ray, returning null and forcing
 *    callers to substitute a bounding-box estimate. It must scale with the
 *    model's own bounding-box diagonal.
 *  - When the raycast genuinely cannot measure (no back surface), the result
 *    is `null` with confidence 0 — never a fabricated number.
 */
import { describe, it, expect } from 'vitest';
import { sampleWallThickness, computeWallConfidence } from '@/analysis/wallThickness';
import { fromThreeBufferGeometry } from '@/analysis/geometryConversion';
import {
  createThinWalledTube,
  createThinPlate,
  createCubeOnBed,
  createSingleTriangle,
} from './geometry';

function modelOf(geo: import('three').BufferGeometry) {
  return fromThreeBufferGeometry(geo);
}

describe('sampleWallThickness — physical truth', () => {
  it('measures the wall of a thin-walled hollow tube', () => {
    const model = modelOf(createThinWalledTube(10, 1, 20));
    const result = sampleWallThickness(model.positions, model.indices);
    expect(result.minThickness).not.toBeNull();
    expect(result.minThickness!).toBeGreaterThan(0.8);
    expect(result.minThickness!).toBeLessThan(1.2);
  });

  it('detects a 0.4 mm thin wall (below the 0.8 mm threshold)', () => {
    const model = modelOf(createThinPlate(0.4, 30, 30));
    const result = sampleWallThickness(model.positions, model.indices);
    expect(result.minThickness).not.toBeNull();
    expect(result.minThickness!).toBeGreaterThan(0.2);
    expect(result.minThickness!).toBeLessThan(0.6);
    expect(result.thinWallCount).toBeGreaterThan(0);
    expect(result.thinWallRatio).toBeGreaterThan(0);
  });

  it('measures a 40 mm solid cube (no hardcoded 20 mm ray cap)', () => {
    const model = modelOf(createCubeOnBed(40));
    const result = sampleWallThickness(model.positions, model.indices);
    expect(result.minThickness).not.toBeNull();
    expect(result.minThickness!).toBeGreaterThan(35);
  });

  it('default ray budget scales with the model bounding box', () => {
    // No maxRayDist passed: the module derives it from the bbox diagonal.
    const model = modelOf(createCubeOnBed(40));
    const result = sampleWallThickness(model.positions, model.indices);
    expect(result.minThickness).not.toBeNull();
    expect(result.minThickness!).toBeGreaterThan(35);
  });

  it('an explicit ray budget is respected (tiny budget → unmeasurable)', () => {
    const model = modelOf(createCubeOnBed(40));
    const result = sampleWallThickness(model.positions, model.indices, 200, 1);
    // Rays capped at 1 unit cannot reach the far surface of a 40 mm cube.
    expect(result.minThickness).toBeNull();
    expect(result.averageConfidence).toBe(0);
  });

  it('no back surface → null thickness and zero confidence', () => {
    const model = modelOf(createSingleTriangle());
    const result = sampleWallThickness(model.positions, model.indices);
    expect(result.minThickness).toBeNull();
    expect(result.averageConfidence).toBe(0);
    expect(result.thinWallRatio).toBe(0);
  });
});

describe('computeWallConfidence — no data means confidence 0', () => {
  it('returns 0 (never a fabricated value) when nothing was measured', () => {
    expect(
      computeWallConfidence(null, null, 0, 0, 0, 0, 0),
    ).toBe(0);
    expect(
      computeWallConfidence(null, null, 0, 0, 0, 0, 12),
    ).toBe(0);
  });
});
