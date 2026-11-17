// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { getPrintStats, recordCalibrationOutcome, type CalibrationContext } from '../printFeedback';
import { captureFeedback } from '../feedback';

const ctx: CalibrationContext = {
  fileHash: 'test-file',
  rulesVersion: 1,
  thresholdsHash: 'thresholds',
  inputHash: 'input',
};

function record(confidence: number, verdict: string, outcome: 'ok' | 'issue' | 'fail') {
  recordCalibrationOutcome({ ...ctx, confidence, verdict, outcome });
}

describe('printFeedback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('aggregates the versioned calibration store', () => {
    record(0.82, 'PASS', 'ok');
    record(0.6, 'WARN', 'issue');
    record(0.45, 'FAIL', 'fail');

    const stats = getPrintStats();
    expect(stats.count).toBe(3);
    expect(stats.okRate).toBeCloseTo(1 / 3);
    expect(stats.byVerdict.pass).toEqual({ total: 1, ok: 1 });
  });

  it('returns empty stats when nothing is recorded', () => {
    const stats = getPrintStats();
    expect(stats.count).toBe(0);
    expect(stats.okRate).toBeNull();
  });

  it('migrates the old unversioned list exactly once', () => {
    localStorage.setItem('3dp.printFeedback', JSON.stringify([
      { confidence: 82, verdict: 'PASS', outcome: 'ok', timestamp: 1 },
      { confidence: 0.4, verdict: 'FAIL', outcome: 'fail', timestamp: 2 },
      { confidence: 50, verdict: 'WARN', outcome: 'issue', timestamp: 3 },
    ]));

    expect(getPrintStats().count).toBe(3);
    expect(localStorage.getItem('3dp.printFeedback')).toBeNull();
    expect(getPrintStats().count).toBe(3);
  });

  it('does not treat product feedback as a print outcome', () => {
    captureFeedback('Bug report', 'Button is broken', 'bug');
    expect(getPrintStats().count).toBe(0);
  });
});
