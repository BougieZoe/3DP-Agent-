/**
 * Yield attribution invariants — the rules the scoreboard is not allowed to break.
 *
 * Each `it()` here exists because the naive implementation scores better than it
 * deserves: unattempted blocks counted as wins, a single averaged accuracy number
 * hiding which direction the error points, or hit rates quoted across policy
 * versions that no longer ship.
 */

import { describe, expect, it } from 'vitest';

import {
  attributeScraps,
  calibrationFromYield,
  classify,
  describeScoreboard,
  promotionGate,
  scoreYield,
  type YieldRecord,
} from '../yieldAttribution';
import { LEGACY_PYTHON_POLICY_VERSION, VERDICT_POLICY_VERSION } from '../verdictPolicy';

function rec(over: Partial<YieldRecord>): YieldRecord {
  return {
    id: 'job-1',
    modelId: 'large-format-fgf',
    unitId: 'unit-a',
    at: '2026-11-20T10:00:00Z',
    verdict: 'pass',
    policyVersion: VERDICT_POLICY_VERSION,
    outcome: 'printed-ok',
    causes: [],
    method: 'part-measurement',
    ...over,
  };
}

describe('1 — a block that was never attempted proves nothing', () => {
  it('scores blocked + not-attempted as unverified, not as a correct rejection', () => {
    const r = rec({ id: 'j1', verdict: 'blocked', outcome: 'not-attempted' });
    expect(classify(r)).toBe('unverified-block');
    const board = scoreYield([r]);
    expect(board.decidable).toBe(0);
    expect(board.leakRate).toBeNull();
    expect(board.blockedBy).toMatch(/executed pass-verdict job/);
  });

  it('counts a blocked job that was overridden and failed as a correct refusal', () => {
    const r = rec({ id: 'j2', verdict: 'blocked', outcome: 'printed-defect', causes: ['machine'] });
    expect(classify(r)).toBe('override-failed');
    expect(scoreYield([r]).decidable).toBe(1);
  });
});

describe('2 — the two error directions are never averaged', () => {
  it('reports leaks and false blocks as separate rates', () => {
    const records = [
      rec({ id: 'a', verdict: 'pass', outcome: 'printed-ok' }),
      rec({ id: 'b', verdict: 'pass', outcome: 'printed-ok' }),
      rec({ id: 'c', verdict: 'pass', outcome: 'printed-ok' }),
      rec({ id: 'd', verdict: 'pass', outcome: 'printed-defect', causes: ['material'] }),
      rec({ id: 'e', verdict: 'blocked', outcome: 'printed-ok' }),
      rec({ id: 'f', verdict: 'blocked', outcome: 'printed-ok' }),
      rec({ id: 'g', verdict: 'blocked', outcome: 'printed-defect', causes: ['design'] }),
    ];
    const board = scoreYield(records);
    expect(board.leakRate).toBe(0.25);
    expect(board.falseBlockRate).toBe(0.667);
    // A single averaged accuracy here would read 71% and hide both directions.
    expect(board.leaks).toEqual(['d']);
  });

  it('keeps a leak visible even when the overall picture looks healthy', () => {
    const records = [
      ...Array.from({ length: 9 }, (_, i) =>
        rec({ id: `ok-${i}`, verdict: 'pass', outcome: 'printed-ok' }),
      ),
      rec({ id: 'leak', verdict: 'pass', outcome: 'printed-defect', causes: ['params'], at: '2026-11-21T09:00:00Z' }),
    ];
    const board = scoreYield(records);
    expect(board.leakRate).toBe(0.1);
    expect(board.leaks).toEqual(['leak']);
  });
});

describe('3 — abstentions stay out of the denominator', () => {
  it('ignores inconclusive verdicts when scoring', () => {
    const records = [
      rec({ id: 'i1', verdict: 'inconclusive', outcome: 'printed-ok', causes: [] }),
      rec({ id: 'i2', verdict: 'inconclusive', outcome: 'not-attempted', causes: [] }),
      rec({ id: 'p1', verdict: 'pass', outcome: 'printed-ok' }),
    ];
    const board = scoreYield(records);
    expect(board.total).toBe(3);
    expect(board.decidable).toBe(1);
    expect(board.counts['inconclusive-outcome']).toBe(1);
    expect(board.counts.unexercised).toBe(1);
  });
});

describe('4 — no rate from a handful of jobs', () => {
  it('withholds the leak rate below three executed pass jobs', () => {
    const board = scoreYield([
      rec({ id: 'a', verdict: 'pass', outcome: 'printed-ok' }),
      rec({ id: 'b', verdict: 'pass', outcome: 'printed-defect', causes: ['material'] }),
    ]);
    expect(board.leakRate).toBeNull();
    expect(board.blockedBy).toMatch(/need >= 3/);
  });
});

describe('5 — thresholds change, denominators do not', () => {
  it('refuses to quote a rate across two policy versions', () => {
    const records = [
      rec({ id: 'old-1', policyVersion: LEGACY_PYTHON_POLICY_VERSION }),
      rec({ id: 'old-2', policyVersion: LEGACY_PYTHON_POLICY_VERSION }),
      rec({ id: 'old-3', policyVersion: LEGACY_PYTHON_POLICY_VERSION }),
      rec({ id: 'new-1' }),
      rec({ id: 'new-2' }),
      rec({ id: 'new-3' }),
    ];
    const mixed = scoreYield(records);
    expect(mixed.leakRate).toBeNull();
    expect(mixed.blockedBy).toMatch(/policy versions/);
    // Nothing was pinned, so nothing was dropped.
    expect(mixed.excludedByVersion).toEqual({ count: 0, versions: [], unstamped: 0 });
  });

  it('pins by filtering, and shows how many records the pin left out', () => {
    const records = [
      rec({ id: 'old-1', policyVersion: LEGACY_PYTHON_POLICY_VERSION }),
      rec({ id: 'old-2', policyVersion: LEGACY_PYTHON_POLICY_VERSION }),
      rec({ id: 'old-3', policyVersion: LEGACY_PYTHON_POLICY_VERSION }),
      rec({ id: 'new-1' }),
      rec({ id: 'new-2' }),
      rec({ id: 'new-3' }),
    ];
    const pinned = scoreYield(records, { policyVersion: VERDICT_POLICY_VERSION });
    // The pin narrows the denominator — and says so instead of pretending the
    // old records never existed.
    expect(pinned.total).toBe(3);
    expect(pinned.excludedByVersion).toEqual({
      count: 3,
      versions: [LEGACY_PYTHON_POLICY_VERSION],
      unstamped: 0,
    });
    expect(pinned.leakRate).toBe(0);
    expect(describeScoreboard(pinned)).toContain(`3 excluded on ${LEGACY_PYTHON_POLICY_VERSION}`);
  });

  it('never names a blank version when stamped and unstamped records mix', () => {
    // Caught on a screenshot of the real panel: the referee line read
    // "records span 3 policy versions (py-…, wall-…, ) — pin one before…",
    // i.e. the unstamped records were counted as a third, nameless policy.
    const records = [
      rec({ id: 'old-1', policyVersion: LEGACY_PYTHON_POLICY_VERSION }),
      rec({ id: 'new-1' }),
      rec({ id: 'u1', policyVersion: undefined as unknown as string }),
      rec({ id: 'u2', policyVersion: '' }),
    ];
    const board = scoreYield(records);
    expect(board.blockedBy).toContain('2 policy versions');
    expect(board.blockedBy).toContain(LEGACY_PYTHON_POLICY_VERSION);
    expect(board.blockedBy).not.toMatch(/,\s*\)/);
  });

  it('does not file an unstamped record under "old policy"', () => {
    // A verdict written before the engine stamped versions, or by a caller that
    // forgot. Reporting it as "excluded on <some version>" would be a lie, and
    // reporting it as "excluded on " (empty) is worse.
    const records = [
      rec({ id: 'u1', policyVersion: undefined as unknown as string }),
      rec({ id: 'u2', policyVersion: undefined as unknown as string }),
      rec({ id: 'u3', policyVersion: '' }),
      rec({ id: 'new-1' }),
    ];
    const board = scoreYield(records, { policyVersion: VERDICT_POLICY_VERSION });
    expect(board.total).toBe(1);
    expect(board.excludedByVersion).toEqual({ count: 3, versions: [], unstamped: 3 });
    const text = describeScoreboard(board);
    expect(text).toContain('3 excluded (no policy version)');
    expect(text).not.toContain('excluded on');
  });

  it('keeps old-policy and unstamped exclusions in separate clauses', () => {
    const records = [
      rec({ id: 'old-1', policyVersion: LEGACY_PYTHON_POLICY_VERSION }),
      rec({ id: 'old-2', policyVersion: LEGACY_PYTHON_POLICY_VERSION }),
      rec({ id: 'u1', policyVersion: undefined as unknown as string }),
      rec({ id: 'new-1' }),
    ];
    const board = scoreYield(records, { policyVersion: VERDICT_POLICY_VERSION });
    expect(board.excludedByVersion).toEqual({
      count: 3,
      versions: [LEGACY_PYTHON_POLICY_VERSION],
      unstamped: 1,
    });
    const text = describeScoreboard(board);
    expect(text).toContain(`2 excluded on ${LEGACY_PYTHON_POLICY_VERSION}`);
    expect(text).toContain('1 excluded (no policy version)');
  });

  it('reads the same whether scoped by hand or by pin', () => {
    const records = [
      rec({ id: 'old-1', policyVersion: LEGACY_PYTHON_POLICY_VERSION }),
      rec({ id: 'new-1' }),
      rec({ id: 'new-2' }),
      rec({ id: 'new-3' }),
    ];
    const pinned = scoreYield(records, { policyVersion: VERDICT_POLICY_VERSION });
    const scoped = scoreYield(
      records.filter((r) => r.policyVersion === VERDICT_POLICY_VERSION),
      { policyVersion: VERDICT_POLICY_VERSION },
    );
    expect(scoped.leakRate).toBe(0);
    expect(pinned.total).toBe(scoped.total);
    expect(pinned.decidable).toBe(scoped.decidable);
  });

  it('an empty pinned board is reported as excluded data, not as a clean record', () => {
    const board = scoreYield([rec({ id: 'old-1', policyVersion: LEGACY_PYTHON_POLICY_VERSION })], {
      policyVersion: VERDICT_POLICY_VERSION,
    });
    expect(board.total).toBe(0);
    expect(board.excludedByVersion.count).toBe(1);
    expect(board.leakRate).toBeNull();
    expect(describeScoreboard(board)).toMatch(/0\/0 decidable/);
  });
});

describe('5b — one policy version, one literal', () => {
  it('stamps the same version the engine ships', () => {
    expect(rec({}).policyVersion).toBe(VERDICT_POLICY_VERSION);
    // Guard: a version pinned in a test must come from the constant, never typed.
    expect(VERDICT_POLICY_VERSION).not.toBe(LEGACY_PYTHON_POLICY_VERSION);
  });
});

describe('6 — a scrap with no cause is reported, not rounded away', () => {
  it('counts missing and unknown causes as unresolved', () => {
    const records = [
      rec({ id: 's1', outcome: 'printed-defect', causes: [] }),
      rec({ id: 's2', outcome: 'printed-defect', causes: ['unknown'] }),
      rec({ id: 's3', outcome: 'printed-defect', causes: ['unknown', 'machine'] }),
      rec({ id: 's4', outcome: 'printed-ok' }),
    ];
    const board = scoreYield(records);
    expect(board.unresolvedScraps).toBe(2);

    const report = attributeScraps(records);
    expect(report.scraps).toBe(3);
    expect(report.unresolved).toBe(2);
    expect(report.attributed).toBe(false);
  });

  it('orders unknown last so the actionable cause reads first', () => {
    const report = attributeScraps([
      rec({ id: 'x', outcome: 'printed-defect', causes: ['unknown', 'material'] }),
      rec({ id: 'y', outcome: 'printed-defect', causes: ['unknown'] }),
    ]);
    expect(report.causes[0].cause).toBe('material');
    expect(report.causes[report.causes.length - 1].cause).toBe('unknown');
    expect(report.causes.find((c) => c.cause === 'unknown')!.count).toBe(2);
  });
});

describe('7 — weak attribution cannot buy a stronger grade', () => {
  it('leaves operator notes below field-calibrated', () => {
    const records = [
      rec({
        id: 'n1',
        unitId: 'unit-a',
        method: 'operator-note',
        measurements: [{ axis: 'chamber-temp', unit: '°C', value: 290 }],
      }),
      rec({
        id: 'n2',
        unitId: 'unit-b',
        method: 'operator-note',
        measurements: [{ axis: 'chamber-temp', unit: '°C', value: 292 }],
      }),
      rec({
        id: 'n3',
        unitId: 'unit-c',
        method: 'operator-note',
        measurements: [{ axis: 'chamber-temp', unit: '°C', value: 288 }],
      }),
    ];
    const agg = promotionGate(records, { modelId: 'large-format-fgf', axis: 'chamber-temp' });
    expect(agg.acceptedSamples).toBe(3);
    expect(agg.grade).toBe('unverified');
    expect(agg.blockedBy).toMatch(/thermocouple or part measurement/);
  });

  it('promotes only cross-unit, strong-method, three-sample evidence', () => {
    const records = [
      rec({ id: 'm1', unitId: 'unit-a', measurements: [{ axis: 'chamber-temp', unit: '°C', value: 290 }] }),
      rec({ id: 'm2', unitId: 'unit-b', measurements: [{ axis: 'chamber-temp', unit: '°C', value: 292 }] }),
      rec({ id: 'm3', unitId: 'unit-c', measurements: [{ axis: 'chamber-temp', unit: '°C', value: 289 }] }),
    ];
    const agg = promotionGate(records, { modelId: 'large-format-fgf', axis: 'chamber-temp' });
    expect(agg.grade).toBe('field-calibrated');
    expect(agg.unitsContributing).toBe(3);
  });
});

describe('8 — an aborted run is kept, but not trusted', () => {
  it('marks measurements from aborted jobs as not accepted', () => {
    const observations = calibrationFromYield([
      rec({
        id: 'ab',
        outcome: 'aborted',
        causes: ['machine'],
        measurements: [{ axis: 'chamber-temp', unit: '°C', value: 250 }],
      }),
      rec({
        id: 'ok',
        measurements: [{ axis: 'chamber-temp', unit: '°C', value: 291 }],
      }),
    ]);
    expect(observations).toHaveLength(2);
    expect(observations.find((o) => o.id === 'ab#chamber-temp')!.accepted).toBe(false);
    expect(observations.find((o) => o.id === 'ok#chamber-temp')!.accepted).toBe(true);
  });
});

describe('9 — the summary line says what is missing', () => {
  it('prints n/a instead of a fake percentage', () => {
    const board = scoreYield([rec({ id: 'only', verdict: 'pass', outcome: 'printed-ok' })]);
    const line = describeScoreboard(board);
    expect(line).toMatch(/leak n\/a/);
    expect(line).toMatch(/false-block n\/a/);
  });
});
