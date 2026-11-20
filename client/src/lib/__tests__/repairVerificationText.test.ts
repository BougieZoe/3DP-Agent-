import { describe, expect, it } from 'vitest';
import type { RepairVerification } from '../repairVerification';
import { describeRepairVerification } from '../repairVerificationText';

const snapshot = {
  minWallThicknessMm: 1,
  p5WallThicknessMm: 1.1,
  thinWallRatio: 0,
  isWatertight: true,
  holeCount: 0,
  boundaryEdgeCount: 0,
  nonManifoldEdgeCount: 0,
  volumeMm3: 8000,
  volumeReliable: true,
  triangleCount: 100,
};

const base: RepairVerification = {
  accepted: true,
  regressions: [],
  improvements: [],
  before: snapshot,
  after: snapshot,
  summary: '',
};

describe('describeRepairVerification', () => {
  it('localizes the no-improvement summary', () => {
    const text = describeRepairVerification(base, 'zh');

    expect(text.title).toBe('修复已验证');
    expect(text.summary).toBe('修复已验证：未测到回退（关键指标未改善）');
    expect(text.summary).not.toContain('repair');
  });

  it('localizes improvement metrics', () => {
    const text = describeRepairVerification(
      {
        ...base,
        improvements: [
          { code: 'non_manifold_reduced', message: 'non-manifold edges 4→0' },
        ],
        before: { ...snapshot, nonManifoldEdgeCount: 4 },
        after: { ...snapshot, nonManifoldEdgeCount: 0 },
      },
      'zh'
    );

    expect(text.summary).toContain('非流形边 4→0');
  });

  it('localizes rejected repairs and their regression list', () => {
    const text = describeRepairVerification(
      {
        ...base,
        accepted: false,
        regressions: [
          {
            code: 'min_wall_decreased',
            message: 'min wall 1.200→0.800mm',
            before: 1.2,
            after: 0.8,
          },
        ],
      },
      'zh'
    );

    expect(text.title).toBe('修复已丢弃');
    expect(text.regressions).toEqual(['最小壁厚 1.200→0.800mm']);
    expect(text.summary).toContain('修复已拒绝');
  });

  it('keeps English output for English', () => {
    const text = describeRepairVerification(base, 'en');

    expect(text.title).toBe('REPAIR VERIFIED');
    expect(text.summary).toContain('no measured regression');
  });
});
