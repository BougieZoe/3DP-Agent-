// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { moduleResult } from '@/analysis/types';
import type { UnifiedAnalysis } from '@/analysis/types';
import {
  appendVersion, clearVersions, diffSnapshots, loadVersions,
  snapshotFromAnalysis, MAX_VERSIONS,
} from '../modelVersions';

function analysis(over: Partial<{ minWall: number; thin: number; faces: number; ohRatio: number; watertight: boolean; volumeReliable: boolean }> = {}): UnifiedAnalysis {
  return {
    topology: moduleResult('topology', 1, 1, {
      triangleCount: 100, vertexCount: 60, edgeCount: 150, manifoldEdgeCount: 150,
      boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, shellCount: 1, isManifold: true, problemEdges: [],
    }, ''),
    validation: moduleResult('validation', 1, 1, {
      isWatertight: over.watertight ?? true, holeCount: 0, boundaryEdgeCount: 0,
      flippedNormalFaceCount: 0, totalFaceCount: 100, flippedNormalRatio: 0,
      normalOrientation: 'consistent_outward', degenerateFaceCount: 0,
    }, ''),
    metrics: moduleResult('metrics', 1, 1, {
      meshVolumeMm3: 1000, volumeReliable: over.volumeReliable ?? true, surfaceAreaMm2: 200,
      boundingBoxVolumeMm3: 1200, boundingBoxDimensionsMm: { x: 10, y: 10, z: 10 },
      minWallThicknessMm: over.minWall ?? 0.1, avgWallThicknessMm: 1,
      p1WallThicknessMm: 0.1, p5WallThicknessMm: over.minWall ?? 0.2, p10WallThicknessMm: 0.3,
      medianWallThicknessMm: 1, thinWallCount: 1, thinWallPercentage: 10,
      thinWallRatio: over.thin ?? 0.5, averageConfidence: 0.6, wallThicknessSamples: [],
      overhang: {
        faceCount: over.faces ?? 100, totalFaceCount: 300, ratio: over.ohRatio ?? 0.3,
        severity: 'severe', breakdownByAngleDeg: [], overhangAreaMm2: 1, totalAreaMm2: 10,
      },
    }, ''),
    bedFit: null, support: null, printTime: null,
    timestamp: new Date().toISOString(), modelFileName: 'x.stl', overallConfidence: 0.6,
  } as UnifiedAnalysis;
}

describe('snapshotFromAnalysis', () => {
  it('captures the facts a fix can move', () => {
    const s = snapshotFromAnalysis(analysis());
    // p5 (0.2) is the headline value, matching the verdict bar — not the
    // absolute minimum (0.1).
    expect(s.minWallMm).toBeCloseTo(0.2);
    expect(s.overhangFaces).toBe(100);
    expect(s.isWatertight).toBe(true);
    expect(s.triangleCount).toBe(100);
  });

  it('returns null min-wall rather than NaN when the module has no value', () => {
    const a = analysis();
    a.metrics.result.minWallThicknessMm = null;
    a.metrics.result.p5WallThicknessMm = null;
    a.metrics.result.avgWallThicknessMm = null;
    a.metrics.result.medianWallThicknessMm = null;
    expect(snapshotFromAnalysis(a).minWallMm).toBeNull();
  });
});

describe('diffSnapshots', () => {
  it('signs the delta by direction of change', () => {
    const before = snapshotFromAnalysis(analysis({ minWall: 0.1, faces: 100 }));
    const after = snapshotFromAnalysis(analysis({ minWall: 0.9, faces: 20 }));
    const d = diffSnapshots(before, after);
    expect(d.minWallMm).toBeCloseTo(0.8);   // thicker = improvement
    expect(d.overhangFaces).toBe(-80);      // fewer = improvement
  });

  it('withholds the volume delta when either side is unreliable', () => {
    const a = snapshotFromAnalysis(analysis({ volumeReliable: true }));
    const b = snapshotFromAnalysis(analysis({ volumeReliable: false }));
    expect(diffSnapshots(a, b).volumeMm3).toBeNull();
  });
});

describe('version store', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips and keeps chronological order', () => {
    appendVersion('a.stl', { at: 1, action: 'upload', snapshot: snapshotFromAnalysis(analysis()) });
    appendVersion('a.stl', { at: 2, action: 'repair', snapshot: snapshotFromAnalysis(analysis({ minWall: 0.9 })) });
    const v = loadVersions('a.stl');
    expect(v.map((x) => x.action)).toEqual(['upload', 'repair']);
  });

  it('collapses a duplicate snapshot for the same action', () => {
    const s = snapshotFromAnalysis(analysis());
    appendVersion('b.stl', { at: 1, action: 'upload', snapshot: s });
    appendVersion('b.stl', { at: 2, action: 'upload', snapshot: s });
    expect(loadVersions('b.stl')).toHaveLength(1);
  });

  it('caps history at MAX_VERSIONS', () => {
    for (let i = 0; i < MAX_VERSIONS + 5; i++) {
      appendVersion('c.stl', { at: i, action: 'repair', snapshot: snapshotFromAnalysis(analysis({ minWall: i + 1 })) });
    }
    expect(loadVersions('c.stl')).toHaveLength(MAX_VERSIONS);
  });

  it('survives malformed storage', () => {
    localStorage.setItem('3dp.versions.bad.stl', '{not json');
    expect(loadVersions('bad.stl')).toEqual([]);
  });

  it('clears per file only', () => {
    appendVersion('d.stl', { at: 1, action: 'upload', snapshot: snapshotFromAnalysis(analysis()) });
    appendVersion('e.stl', { at: 1, action: 'upload', snapshot: snapshotFromAnalysis(analysis()) });
    clearVersions('d.stl');
    expect(loadVersions('d.stl')).toEqual([]);
    expect(loadVersions('e.stl')).toHaveLength(1);
  });
});
