// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { getPrintStats, recordPrintOutcome } from '../printFeedback';

describe('printFeedback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records outcomes and aggregates ok-rate', () => {
    recordPrintOutcome({ confidence: 82, verdict: 'PASS', outcome: 'ok' });
    recordPrintOutcome({ confidence: 60, verdict: 'WARN', outcome: 'issue' });
    recordPrintOutcome({ confidence: 45, verdict: 'FAIL', outcome: 'fail' });

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
});
