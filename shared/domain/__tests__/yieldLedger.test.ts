/**
 * Yield ledger invariants — the collection layer is where honesty is easiest to
 * lose, because the tempting defaults all flatter the product:
 * "completed" read as good, "cancelled" read as a win, a missing verdict read as
 * a pass. Each test below pins one of those defaults shut.
 */

import { describe, expect, it } from 'vitest';

import {
  type FloorJobSnapshot,
  type FloorPrinterSnapshot,
  UNBOUND_MACHINE,
  describeFloor,
  floorScoreboard,
  harvestYield,
} from '../yieldLedger';

const printers: FloorPrinterSnapshot[] = [
  { id: 'printer_a', modelId: 'large-format-fgf' },
  { id: 'printer_b', modelId: 'large-format-fgf' },
  { id: 'printer_legacy', modelId: null },
];

function job(over: Partial<FloorJobSnapshot>): FloorJobSnapshot {
  return {
    id: 'job-1',
    printerId: 'printer_a',
    status: 'completed',
    startedAt: '2026-11-20T08:00:00Z',
    actualEndAt: '2026-11-20T18:00:00Z',
    verdict: { state: 'pass', policyVersion: 'wall-2026-11-23a' },
    quality: 'good',
    ...over,
  };
}

describe('1 — completion is not quality', () => {
  it('counts an uninspected finished part as awaiting inspection', () => {
    const h = harvestYield(
      [job({ id: 'j1', quality: 'pending' }), job({ id: 'j2', quality: undefined })],
      printers,
    );
    expect(h.records).toHaveLength(0);
    expect(h.awaitingInspection).toBe(2);
  });

  it('turns an inspected good part into a record', () => {
    const h = harvestYield([job({ id: 'j1' })], printers);
    expect(h.records).toHaveLength(1);
    expect(h.records[0].outcome).toBe('printed-ok');
  });
});

describe('2 — no verdict, no score', () => {
  it('reports an unscored defect as unjudged rather than as a pass', () => {
    const h = harvestYield(
      [job({ id: 'j1', verdict: undefined, quality: 'defect', scrapCauses: ['material'] })],
      printers,
    );
    expect(h.records).toHaveLength(0);
    expect(h.unjudged).toBe(1);
    expect(h.awaitingInspection).toBe(0);
  });
});

describe('3 — a failed run under a pass verdict is a leak', () => {
  it('files it as false-pass and lists it', () => {
    const jobs = [job({ id: 'j1', status: 'failed', quality: undefined, scrapCauses: ['material'] })];
    const { board } = floorScoreboard(jobs, printers);
    expect(board.counts['false-pass']).toBe(1);
    expect(board.leaks).toEqual(['j1']);
  });
});

describe('4 — overrides are recorded, not silent', () => {
  it('counts a blocked verdict that ran anyway', () => {
    const h = harvestYield(
      [job({ id: 'j1', verdict: { state: 'blocked', policyVersion: 'wall-2026-11-23a' } })],
      printers,
    );
    expect(h.overrides).toBe(1);
    expect(h.records[0].verdict).toBe('blocked');
  });
});

describe('5 — a missing modelId is data debt, not lost history', () => {
  it('files legacy rows under unbound-machine', () => {
    const h = harvestYield([job({ id: 'j1', printerId: 'printer_legacy' })], printers);
    expect(h.records[0].modelId).toBe(UNBOUND_MACHINE);
    expect(h.unboundMachines).toBe(1);
  });
});

describe('6 — open jobs stay out of the ledger', () => {
  it('counts queued and printing jobs as open only', () => {
    const h = harvestYield(
      [
        job({ id: 'q', status: 'queued', quality: undefined, actualEndAt: undefined }),
        job({ id: 'p', status: 'printing', quality: undefined, actualEndAt: undefined }),
        job({ id: 'done' }),
      ],
      printers,
    );
    expect(h.open).toBe(2);
    expect(h.records).toHaveLength(1);
  });
});

describe('7 — cancellation is an abort, not a success', () => {
  it('keeps the cause empty instead of inventing one', () => {
    const h = harvestYield([job({ id: 'c', status: 'cancelled', quality: undefined })], printers);
    expect(h.records[0].outcome).toBe('aborted');
    expect(h.records[0].causes).toEqual([]);
    expect(h.records[0].method).toBe('operator-note');
  });
});

describe('8 — the shift line states the debt in the same breath', () => {
  it('mentions awaiting inspection and unjudged counts', () => {
    const line = describeFloor(
      [
        job({ id: 'a', quality: 'pending' }),
        job({ id: 'b', verdict: undefined, quality: 'defect' }),
        job({ id: 'c' }),
      ],
      printers,
    );
    expect(line).toMatch(/leak n\/a/);
    expect(line).toMatch(/1 awaiting inspection/);
    expect(line).toMatch(/1 unjudged/);
  });
});
