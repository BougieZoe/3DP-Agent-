import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VERDICT_POLICY,
  VERDICT_POLICY_VERSION,
  describeVerdictPolicy,
  evaluateVerdict,
  type VerdictObservation,
} from './verdictPolicy';

/** 一份"什么都没问题"的观测，测试按需覆盖单点。 */
const clean: VerdictObservation = {
  isWatertight: true,
  holeCount: 0,
  boundaryEdgeCount: 0,
  volumeReliable: true,
  minWallThicknessMm: 2.4,
  fitsBuildVolume: true,
  estimatedPrintTimeMinutes: 96,
  estimatedSupportGrams: 12.5,
};

describe('verdictPolicy 真值墙', () => {
  it('全项可信时判 pass，且不抑制任何派生值', () => {
    const v = evaluateVerdict(clean);
    expect(v.status).toBe('pass');
    expect(v.reasons).toHaveLength(0);
    expect(v.suppressed).toHaveLength(0);
    expect(v.policyVersion).toBe(VERDICT_POLICY_VERSION);
  });

  it('薄壁低于硬门判 blocked，并带出观测值与限值', () => {
    const v = evaluateVerdict({ ...clean, minWallThicknessMm: 0.5 });
    expect(v.status).toBe('blocked');
    const reason = v.reasons.find((r) => r.code === 'WALL_BELOW_MIN');
    expect(reason).toBeDefined();
    expect(reason?.observed).toBe(0.5);
    expect(reason?.limit).toBe(DEFAULT_VERDICT_POLICY.minWallMm);
  });

  it('壁厚恰好等于硬门不算越界（边界取闭区间下界）', () => {
    const v = evaluateVerdict({ ...clean, minWallThicknessMm: DEFAULT_VERDICT_POLICY.minWallMm });
    expect(v.status).toBe('pass');
  });

  it('非水密时判 inconclusive，且打印时间与支撑克重被抑制', () => {
    const v = evaluateVerdict({ ...clean, isWatertight: false, volumeReliable: false });
    expect(v.status).toBe('inconclusive');
    expect(v.reasons.some((r) => r.code === 'TOPOLOGY_UNVERIFIED')).toBe(true);
    expect(v.suppressed).toContain('estimatedPrintTimeMinutes');
    expect(v.suppressed).toContain('estimatedSupportGrams');
  });

  it('超包络判 blocked，blocked 优先于 inconclusive', () => {
    const v = evaluateVerdict({
      ...clean,
      fitsBuildVolume: false,
      isWatertight: false,
      volumeReliable: false,
    });
    expect(v.status).toBe('blocked');
    expect(v.reasons.filter((r) => r.kind === 'block')).toHaveLength(1);
  });

  it('壁厚未测出时不得判 pass，只能 inconclusive', () => {
    const v = evaluateVerdict({ ...clean, minWallThicknessMm: null });
    expect(v.status).toBe('inconclusive');
    expect(v.reasons.some((r) => r.code === 'WALL_UNMEASURED')).toBe(true);
  });

  it('体积不可靠但拓扑闭合时单独记 VOLUME_UNRELIABLE', () => {
    const v = evaluateVerdict({ ...clean, volumeReliable: false });
    expect(v.status).toBe('inconclusive');
    expect(v.reasons.some((r) => r.code === 'VOLUME_UNRELIABLE')).toBe(true);
  });

  it('派生值本来就是 null 时不重复计入 suppressed', () => {
    const v = evaluateVerdict({
      ...clean,
      isWatertight: false,
      volumeReliable: false,
      estimatedPrintTimeMinutes: null,
      estimatedSupportGrams: null,
    });
    expect(v.status).toBe('inconclusive');
    expect(v.suppressed).toHaveLength(0);
  });

  it('策略快照可序列化且版本号透出', () => {
    const snapshot = describeVerdictPolicy();
    expect(snapshot.version).toBe(VERDICT_POLICY_VERSION);
    expect(JSON.parse(JSON.stringify(snapshot)).minWallMm).toBe(
      DEFAULT_VERDICT_POLICY.minWallMm,
    );
  });
});
