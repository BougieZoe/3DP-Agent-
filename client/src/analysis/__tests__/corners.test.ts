import { describe, it, expect, vi } from 'vitest';
import {
  MIN_CORNERS_FOR_WORST,
  cornerBlockReason,
  evaluateCorners,
  type CornerDefinition,
  type CornerJudge,
} from '../corners';
import { TOPOLOGY_PROFILES, type TopologyProfile } from '../topologyProfiles';

const base: TopologyProfile = TOPOLOGY_PROFILES['ai-generation:quad'];

function corner(over: Partial<CornerDefinition> & Pick<CornerDefinition, 'id'>): CornerDefinition {
  return {
    material: 'PLA',
    layerHeightMm: 0.2,
    calibration: 'provisional',
    thresholds: {},
    ...over,
  };
}

/** Judge that always reports the same verdict — scoring is not what is under test. */
const flatJudge = (score = 80, light: 'green' | 'yellow' | 'red' = 'green'): CornerJudge =>
  () => ({ score, light, configBaselineId: `ai-generation:quad@${score}` });

const scoreByCorner: CornerJudge = (_profile, c) => ({
  score: c.id === 'pla@0.2' ? 90 : 40,
  light: c.id === 'pla@0.2' ? 'green' : 'yellow',
  configBaselineId: `ai-generation:quad@${c.id}`,
});

describe('corner guard — uncalibrated corners cannot speak', () => {
  it('blocks a provisional corner and names the combination', () => {
    const reason = cornerBlockReason(corner({ id: 'pla@0.2', calibration: 'provisional' }));
    expect(reason).toBeTruthy();
    expect(reason).toContain('pla@0.2');
    expect(reason).toContain('PLA');
    expect(reason).toContain('0.2');
  });

  it('blocks a corner that claims measured but overrides nothing', () => {
    // Same gap the registry test closes: the claim must be backed by data.
    const reason = cornerBlockReason(corner({ id: 'pa-cf@0.6', material: 'PA-CF', layerHeightMm: 0.6, calibration: 'measured', thresholds: {} }));
    expect(reason).toBeTruthy();
    expect(reason).toContain('pa-cf@0.6');
    expect(reason).toMatch(/overrides nothing/);
  });

  it('accepts a measured corner that carries overrides', () => {
    expect(
      cornerBlockReason(corner({ id: 'pla@0.2', calibration: 'measured', thresholds: { overhangThresholdDeg: 45 } })),
    ).toBeNull();
  });

  it('never hands a blocked corner to the judge', () => {
    const judge = vi.fn(flatJudge());
    const report = evaluateCorners(
      base,
      [
        corner({ id: 'pla@0.2', calibration: 'provisional' }),
        corner({ id: 'pa-cf@0.6', material: 'PA-CF', layerHeightMm: 0.6, calibration: 'default' }),
      ],
      judge,
    );
    expect(judge).not.toHaveBeenCalled();
    expect(report.supported).toHaveLength(0);
    expect(report.blocked).toHaveLength(2);
  });
});

describe('corner guard — worst case is withheld until it means something', () => {
  it('withholds a worst case when no corner is measured', () => {
    const report = evaluateCorners(base, [corner({ id: 'pla@0.2' })], flatJudge());
    expect(report.worst).toBeNull();
    expect(report.worstWithheldReason).toContain('no corner has measured thresholds');
  });

  it('withholds a worst case from a single measured corner', () => {
    const report = evaluateCorners(
      base,
      [corner({ id: 'pla@0.2', calibration: 'measured', thresholds: { overhangThresholdDeg: 45 } })],
      flatJudge(),
    );
    expect(report.supported).toHaveLength(1);
    expect(report.worst).toBeNull();
    expect(report.worstWithheldReason).toContain(String(MIN_CORNERS_FOR_WORST));
  });

  it('withholds a worst case when only one corner survives blocking', () => {
    // Two corners declared, one blocked — a range of one is not a range.
    const report = evaluateCorners(
      base,
      [
        corner({ id: 'pla@0.2', calibration: 'measured', thresholds: { overhangThresholdDeg: 45 } }),
        corner({ id: 'pa-cf@0.6', material: 'PA-CF', layerHeightMm: 0.6, calibration: 'provisional' }),
      ],
      flatJudge(),
    );
    expect(report.blocked).toHaveLength(1);
    expect(report.worst).toBeNull();
  });

  it('reports the lowest-scoring corner once two are measured', () => {
    const report = evaluateCorners(
      base,
      [
        corner({ id: 'pla@0.2', calibration: 'measured', thresholds: { overhangThresholdDeg: 45 } }),
        corner({ id: 'pa-cf@0.6', material: 'PA-CF', layerHeightMm: 0.6, calibration: 'measured', thresholds: { overhangThresholdDeg: 40 } }),
      ],
      scoreByCorner,
    );
    expect(report.supported).toHaveLength(2);
    expect(report.worst?.corner.id).toBe('pa-cf@0.6');
    expect(report.worst?.score).toBe(40);
    expect(report.worstWithheldReason).toBeUndefined();
  });

  it('layers corner thresholds over the base profile without mutating it', () => {
    const seen: TopologyProfile[] = [];
    const judge: CornerJudge = (profile, c) => {
      seen.push(profile);
      return { score: 70, light: 'yellow', configBaselineId: `x@${c.id}` };
    };
    evaluateCorners(
      base,
      [corner({ id: 'pla@0.2', calibration: 'measured', thresholds: { overhangThresholdDeg: 45 } })],
      judge,
    );
    expect(seen[0].thresholds.overhangThresholdDeg).toBe(45);
    expect(base.thresholds).toEqual({});
  });
});
