/**
 * Physical-truth tests for the analysis metrics, run against real geometry.
 *
 * Build axis is Z (slicer convention). The old overhang measure used
 * `Math.abs(normal.y)` — it flagged vertical walls and flat tops on Z-up
 * models and never considered the build plate. These tests pin the corrected,
 * physically meaningful behavior:
 *  - only DOWNWARD-facing faces (nz < 0) can be overhangs;
 *  - faces resting on the build plate are supported by the bed;
 *  - a thin-walled hollow tube reports its wall thickness, not the bbox min;
 *  - a solid part larger than 20 mm is measured (no hardcoded ray cap);
 *  - when the raycast cannot measure, wall thickness is `null` with
 *    confidence 0 — never a bounding-box estimate.
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeOverhang,
  computeMetrics,
  overhangTiltBelowHorizontalDeg,
  isOnBuildPlate,
} from '@/analysis/metrics';
import { fromThreeBufferGeometry } from '@/analysis/geometryConversion';
import {
  createCubeOnBed,
  createOverhangRamp,
  createUpwardRamp,
  createVerticalWall,
  createSuspendedCeiling,
  createThinWalledTube,
  createThinPlate,
  createSingleTriangle,
} from './geometry';

function modelOf(geo: import('three').BufferGeometry) {
  return fromThreeBufferGeometry(geo);
}

describe('overhangTiltBelowHorizontalDeg (Z-up, sign-aware)', () => {
  it('returns null for upward and horizontal normals', () => {
    expect(overhangTiltBelowHorizontalDeg(1, 1)).toBeNull(); // flat top (+Z)
    expect(overhangTiltBelowHorizontalDeg(0, 1)).toBeNull(); // vertical wall
    expect(overhangTiltBelowHorizontalDeg(0.5, 1)).toBeNull(); // up-sloping
  });

  it('returns the tilt below horizontal for downward normals', () => {
    // Ceiling (straight down) → 90° below horizontal.
    expect(overhangTiltBelowHorizontalDeg(-1, 1)).toBeCloseTo(90, 5);
    // 45° downward normal → 45° below horizontal.
    expect(overhangTiltBelowHorizontalDeg(-Math.SQRT1_2, 1)).toBeCloseTo(45, 5);
  });
});

describe('isOnBuildPlate', () => {
  it('treats faces at the model minimum Z as supported by the bed', () => {
    expect(isOnBuildPlate(0, 0, 20)).toBe(true);
    expect(isOnBuildPlate(0.001, 0, 20)).toBe(true); // within eps
    expect(isOnBuildPlate(5, 0, 20)).toBe(false);
  });
});

describe('analyzeOverhang — Z-up physical truth', () => {
  it('a cube resting on the build plate has zero overhang faces', () => {
    const model = modelOf(createCubeOnBed(20));
    const result = analyzeOverhang(model.positions, model.indices);
    // Bottom rests on the bed; sides and top are not downward-facing.
    expect(result.faceCount).toBe(0);
    expect(result.totalFaceCount).toBe(12);
  });

  it('a vertical wall is never an overhang', () => {
    const model = modelOf(createVerticalWall());
    expect(analyzeOverhang(model.positions, model.indices).faceCount).toBe(0);
  });

  it('an upward ramp is never an overhang', () => {
    const model = modelOf(createUpwardRamp(20, 20, 45));
    expect(analyzeOverhang(model.positions, model.indices).faceCount).toBe(0);
  });

  it('a 60° downward ramp is an overhang; a 30° one is not (threshold 50°)', () => {
    const steep = modelOf(createOverhangRamp(10, 10, 60));
    expect(analyzeOverhang(steep.positions, steep.indices).faceCount).toBe(2);

    const shallow = modelOf(createOverhangRamp(10, 10, 30));
    expect(analyzeOverhang(shallow.positions, shallow.indices).faceCount).toBe(0);
  });

  it('a suspended horizontal ceiling (90° overhang) is flagged', () => {
    const model = modelOf(createSuspendedCeiling(20, 20, 20));
    const result = analyzeOverhang(model.positions, model.indices);
    // Only the ceiling's two triangles are downward + off the bed.
    expect(result.faceCount).toBe(2);
  });
});

describe('computeMetrics — no silent bounding-box fallback', () => {
  it('a thin-walled hollow tube reports its wall thickness, not the bbox min', () => {
    const model = modelOf(createThinWalledTube(10, 1, 20));
    const result = computeMetrics(model);
    const minWall = result.result.minWallThicknessMm;
    // The bbox min dimension of this tube is the OUTER DIAMETER (20), which
    // would hide a 1 mm wall entirely. The raycast must report the wall.
    expect(minWall).not.toBeNull();
    expect(minWall!).toBeGreaterThan(0.8);
    expect(minWall!).toBeLessThan(1.2);
  });

  it('a solid part larger than 20 mm is measured (dynamic ray budget)', () => {
    const model = modelOf(createCubeOnBed(40));
    const result = computeMetrics(model);
    // Old hardcoded `maxRayDist = 20` made every ray on a 40 mm cube "miss",
    // returning null and triggering the bbox fallback. Now it measures ≈ 40.
    expect(result.result.minWallThicknessMm).not.toBeNull();
    expect(result.result.minWallThicknessMm!).toBeGreaterThan(35);
    expect(result.result.thinWallRatio).toBe(0);
  });

  it('a 0.4 mm thin plate is flagged as thin wall', () => {
    const model = modelOf(createThinPlate(0.4, 30, 30));
    const result = computeMetrics(model);
    expect(result.result.minWallThicknessMm).not.toBeNull();
    expect(result.result.thinWallRatio).toBeGreaterThan(0);
    expect(result.result.thinWallCount).toBeGreaterThan(0);
  });

  it('unmeasurable geometry returns null wall thickness and confidence 0 — never a bbox estimate', () => {
    const model = modelOf(createSingleTriangle());
    const result = computeMetrics(model);
    expect(result.result.minWallThicknessMm).toBeNull();
    expect(result.confidence).toBe(0);
    // Sanity: the bbox-min half-extent would have been a small positive number;
    // we must NOT have substituted it.
    expect(result.result.avgWallThicknessMm).toBeNull();
    expect(result.result.p5WallThicknessMm).toBeNull();
  });

  it('cube overhang through computeMetrics is zero (bed-supported)', () => {
    const model = modelOf(createCubeOnBed(20));
    const result = computeMetrics(model);
    expect(result.result.overhang.faceCount).toBe(0);
  });
});
