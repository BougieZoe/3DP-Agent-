import { describe, it, expect } from 'vitest';
import { versionRows } from '../ReportGenerator';
import type { ModelSnapshot, ModelVersion } from '@/lib/modelVersions';

const snap = (over: Partial<ModelSnapshot> = {}): ModelSnapshot => ({
  minWallMm: 0.2, thinWallRatio: 0.4, overhangFaces: 1000, overhangRatio: 0.3,
  isWatertight: false, volumeReliable: false, volumeMm3: 0, triangleCount: 100, ...over,
});
const v = (at: number, snapshot: ModelSnapshot, action: ModelVersion['action'] = 'upload'): ModelVersion =>
  ({ id: String(at), at, action, snapshot });

describe('versionRows', () => {
  it('says nothing with fewer than two versions', () => {
    expect(versionRows([], 'en')).toEqual([]);
    expect(versionRows([v(1, snap())], 'en')).toEqual([]);
  });

  it('reports an improvement as a positive, non-warning row', () => {
    const rows = versionRows([v(1, snap({ minWallMm: 0.2 })), v(2, snap({ minWallMm: 0.9 }), 'repair')], 'en');
    const wall = rows.find((r) => /wall/i.test(r.label))!;
    expect(wall.value).toContain('0.20 → 0.90 mm (+0.70)');
    expect(wall.warn).toBe(false);
  });

  it('flags a regression as a warning', () => {
    const rows = versionRows([v(1, snap({ minWallMm: 0.2 })), v(2, snap({ minWallMm: 0.1 }), 'repair')], 'en');
    expect(rows.find((r) => /wall/i.test(r.label))!.warn).toBe(true);
  });

  it('reports the shell state change', () => {
    const rows = versionRows([v(1, snap({ isWatertight: false })), v(2, snap({ isWatertight: true }), 'repair')], 'en');
    const shell = rows.find((r) => /shell/i.test(r.label))!;
    expect(shell.value).toBe('open → sealed');
    expect(shell.warn).toBe(false);
  });

  it('omits rows that did not change', () => {
    const rows = versionRows([v(1, snap()), v(2, snap(), 'repair')], 'en');
    expect(rows.some((r) => /overhang/i.test(r.label))).toBe(false);
    expect(rows.some((r) => /shell/i.test(r.label))).toBe(false);
  });
});

describe('versionRows with discarded attempts', () => {
  it('ignores a discarded attempt when comparing states', () => {
    const good = v(2, snap({ minWallMm: 0.9 }), 'repair');
    const bad: ModelVersion = { ...v(3, snap({ minWallMm: 0.05 }), 'repair'), outcome: 'discarded' };
    const rows = versionRows([v(1, snap({ minWallMm: 0.2 })), good, bad], 'en');
    const wall = rows.find((r) => /wall/i.test(r.label))!;
    expect(wall.value).toContain('0.20 → 0.90 mm (+0.70)');
    expect(wall.warn).toBe(false);
  });
});
