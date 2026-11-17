/**
 * Repair verification gate tests.
 *
 * Rules under test:
 *  1. Any measured regression rejects the repair, even alongside improvements.
 *  2. Missing baseline or missing re-measurement rejects (cannot verify).
 *  3. "No regression" is accepted but reported separately from improvement.
 *  4. Only measured topology/validation/metrics are consulted.
 */
import { describe, it, expect } from 'vitest';
import type { UnifiedAnalysis } from '@/analysis/types';
import { snapshotRepairMetrics, verifyRepair } from '../repairVerification';

function mod<T>(result: T) {
  return { moduleName: 'x', confidence: 0.9 as never, durationMs: 1, result, explanation: '' };
}

interface Snap {
  minWall?: number | null;
  p5?: number | null;
  watertight?: boolean | null;
  holes?: number | null;
  boundary?: number | null;
  nonManifold?: number | null;
  volume?: number | null;
  volumeReliable?: boolean | null;
  triangles?: number | null;
}

function analysis(s: Snap = {}): UnifiedAnalysis {
  return {
    topology: mod({
      triangleCount: s.triangles ?? 100,
      vertexCount: 60,
      edgeCount: 150,
      manifoldEdgeCount: 150,
      boundaryEdgeCount: s.boundary === undefined ? 0 : s.boundary,
      nonManifoldEdgeCount: s.nonManifold === undefined ? 0 : s.nonManifold,
      shellCount: 1,
      problemEdges: [],
    }),
    validation: mod({
      isWatertight: s.watertight === undefined ? true : s.watertight,
      holeCount: s.holes === undefined ? 0 : s.holes,
      boundaryEdgeCount: s.boundary === undefined ? 0 : s.boundary,
      flippedNormalFaceCount: 0,
      totalFaceCount: 100,
      flippedNormalRatio: 0,
      normalOrientation: 'outward',
      degenerateFaceCount: 0,
    }),
    metrics: mod({
      meshVolumeMm3: s.volume === undefined ? 8000 : s.volume,
      volumeReliable: s.volumeReliable === undefined ? true : s.volumeReliable,
      minWallThicknessMm: s.minWall === undefined ? 1.2 : s.minWall,
      p5WallThicknessMm: s.p5 === undefined ? 1.3 : s.p5,
      thinWallRatio: 0,
      surfaceAreaMm2: 1000,
      boundingBoxDimensionsMm: { x: 10, y: 10, z: 10 },
      overhang: { ratio: 0, faceCount: 0 },
    }),
  } as unknown as UnifiedAnalysis;
}

describe('snapshotRepairMetrics', () => {
  it('returns null when there are no measured modules', () => {
    expect(snapshotRepairMetrics(null)).toBeNull();
    expect(snapshotRepairMetrics({} as UnifiedAnalysis)).toBeNull();
  });

  it('extracts measured facts and keeps missing values null', () => {
    const s = snapshotRepairMetrics(analysis({ minWall: null, holes: null }));
    expect(s?.minWallThicknessMm).toBeNull();
    expect(s?.holeCount).toBeNull();
    expect(s?.isWatertight).toBe(true);
  });
});

describe('verifyRepair', () => {
  it('accepts a repair that fixes holes and thickens walls', () => {
    const before = analysis({ watertight: false, holes: 2, boundary: 8, nonManifold: 4, minWall: 0.5, p5: 0.6 });
    const after = analysis({ watertight: true, holes: 0, boundary: 0, nonManifold: 0, minWall: 1.2, p5: 1.3 });

    const v = verifyRepair(before, after);
    expect(v.accepted).toBe(true);
    expect(v.regressions).toHaveLength(0);
    expect(v.improvements.map((i) => i.code)).toContain('watertight_gained');
    expect(v.summary).toContain('repair verified');
  });

  it('rejects a repair that makes the minimum wall thinner', () => {
    const v = verifyRepair(analysis({ minWall: 1.2 }), analysis({ minWall: 0.8 }));
    expect(v.accepted).toBe(false);
    expect(v.regressions.map((r) => r.code)).toContain('min_wall_decreased');
  });

  it('rejects a repair that makes p5 thinner even if min wall is unchanged', () => {
    const v = verifyRepair(analysis({ p5: 1.3 }), analysis({ p5: 1.0 }));
    expect(v.accepted).toBe(false);
    expect(v.regressions.map((r) => r.code)).toContain('p5_wall_decreased');
  });

  it('rejects newly introduced non-manifold edges', () => {
    const v = verifyRepair(analysis({ nonManifold: 0 }), analysis({ nonManifold: 3 }));
    expect(v.accepted).toBe(false);
    expect(v.regressions.map((r) => r.code)).toContain('non_manifold_increased');
  });

  it('rejects new boundary edges, new holes, or lost watertightness', () => {
    const boundary = verifyRepair(analysis({ boundary: 0 }), analysis({ boundary: 2 }));
    expect(boundary.regressions.map((r) => r.code)).toContain('boundary_increased');

    const holes = verifyRepair(analysis({ holes: 0 }), analysis({ holes: 1 }));
    expect(holes.regressions.map((r) => r.code)).toContain('holes_increased');

    const watertight = verifyRepair(analysis({ watertight: true }), analysis({ watertight: false }));
    expect(watertight.regressions.map((r) => r.code)).toContain('watertight_lost');
  });

  it('rejects unreliable or implausible volume changes', () => {
    const unreliable = verifyRepair(
      analysis({ volumeReliable: true }),
      analysis({ volumeReliable: false }),
    );
    expect(unreliable.regressions.map((r) => r.code)).toContain('volume_unreliable');

    const implausible = verifyRepair(analysis({ volume: 1000 }), analysis({ volume: 5000 }));
    expect(implausible.regressions.map((r) => r.code)).toContain('volume_implausible');
  });

  it('rejects when the baseline is unavailable or re-analysis produced nothing', () => {
    const noBaseline = verifyRepair(null, analysis());
    expect(noBaseline.accepted).toBe(false);
    expect(noBaseline.regressions.map((r) => r.code)).toContain('baseline_unavailable');

    const noAfter = verifyRepair(analysis(), null);
    expect(noAfter.accepted).toBe(false);
    expect(noAfter.regressions.map((r) => r.code)).toContain('analysis_unavailable');
  });

  it('rejects an empty repaired mesh', () => {
    const v = verifyRepair(analysis({ triangles: 100 }), analysis({ triangles: 0 }));
    expect(v.accepted).toBe(false);
    expect(v.regressions.map((r) => r.code)).toContain('empty_result');
  });

  it('accepts an unchanged mesh but does not claim improvement', () => {
    const v = verifyRepair(analysis(), analysis());
    expect(v.accepted).toBe(true);
    expect(v.improvements).toHaveLength(0);
    expect(v.summary).toContain('no key metric improved');
  });

  it('rejects when a regression coexists with an improvement', () => {
    const before = analysis({ watertight: false, minWall: 1.2 });
    const after = analysis({ watertight: true, minWall: 0.7 });
    const v = verifyRepair(before, after);
    expect(v.accepted).toBe(false);
    expect(v.improvements.map((i) => i.code)).toContain('watertight_gained');
    expect(v.regressions.map((r) => r.code)).toContain('min_wall_decreased');
  });
});
