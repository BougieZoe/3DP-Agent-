/**
 * Assertion run (`tsx client/src/lib/__tests__/yieldView.check.ts`).
 *
 * Runs in this environment because vitest's rollup native binding is broken
 * here; keeps the panel's projection honest without a DOM.
 */
import { buildYieldView } from '../yieldView';
import type { PrintJob } from '../printFarm';

let checks = 0;
function eq<T>(actual: T, expected: T, label: string) {
  checks += 1;
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
function ok(cond: boolean, label: string) {
  checks += 1;
  if (!cond) throw new Error(`${label}: expected truthy`);
}

function makeJob(over: Partial<PrintJob> & { id: string; printerId: string }): PrintJob {
  return {
    name: over.id,
    fileName: `${over.id}.gcode`,
    status: 'completed',
    progress: 100,
    startedAt: '2026-11-20T08:00:00.000Z',
    estimatedEndAt: '2026-11-20T12:00:00.000Z',
    material: 'PLA',
    materialUsedGrams: 120,
    layers: { current: 200, total: 200 },
    temperatures: { nozzle: 215, bed: 60 },
    errors: [],
    ...over,
  } as PrintJob;
}

const jobs: PrintJob[] = [
  // judged pass, part good  -> true-pass
  makeJob({ id: 'j1', printerId: 'p1', verdict: { state: 'pass', policyVersion: 'v1' }, quality: 'good' }),
  // judged pass, part scrapped -> false-pass (the expensive direction)
  makeJob({
    id: 'j2',
    printerId: 'p1',
    verdict: { state: 'pass', policyVersion: 'v1' },
    quality: 'defect',
    scrapCauses: ['machine'],
    attributionMethod: 'part-measurement',
  }),
  // machine finished, nobody looked -> awaiting inspection, never a win
  makeJob({ id: 'j3', printerId: 'p1', verdict: { state: 'pass', policyVersion: 'v1' }, quality: 'pending' }),
  // executed with no verdict checkpoint -> unjudged, cannot be scored
  makeJob({ id: 'j4', printerId: 'p1', quality: 'good' }),
  // blocked and never ran, on a printer with no model bound
  makeJob({ id: 'j5', printerId: 'p2', status: 'failed', verdict: { state: 'blocked', policyVersion: 'v1' } }),
  makeJob({ id: 'j6', printerId: 'p1', verdict: { state: 'pass', policyVersion: 'v1' }, quality: 'good' }),
  makeJob({ id: 'j7', printerId: 'p1', verdict: { state: 'pass', policyVersion: 'v1' }, quality: 'good' }),
];

const printers = [
  { id: 'p1', name: 'X1C-01', modelId: 'bambu_x1c' },
  { id: 'p2', name: 'Unbound-02', modelId: null },
] as never;

const empty = buildYieldView([], []);
eq(empty.jobCount, 0, 'empty jobCount');
eq(empty.decidableText, '0 / 0', 'empty decidable');
eq(empty.leakRateText, '—', 'empty leak rate');
eq(empty.machines.length, 0, 'empty machines');
eq(empty.pending.length, 0, 'empty pending');

const view = buildYieldView(jobs, printers);

eq(view.harvest.awaitingInspection, 1, 'awaitingInspection counts j3 only');
eq(view.harvest.unjudged, 1, 'unjudged counts j4');
eq(view.harvest.unboundMachines, 1, 'unbound machines counted');
eq(view.pending.length, 1, 'pending queue length');
eq(view.pending[0]?.id, 'j3', 'pending queue holds the uninspected part only');
eq(view.pending[0]?.printerName, 'X1C-01', 'pending row resolves printer name');

eq(view.board.counts['true-pass'], 3, 'true-pass count');
eq(view.board.counts['false-pass'], 1, 'false-pass count');
// A blocked verdict that still ran and failed is an override that failed, not a
// clean interception: the domain refuses to book it as a good block.
eq(view.board.counts['override-failed'], 1, 'blocked + aborted lands in override-failed');
eq(view.board.counts['unverified-block'], 0, 'no clean interception in this batch');
eq(view.harvest.overrides, 1, 'override debt surfaced for the shift board');
eq(view.board.decidable, 5, 'denominator is verdict+outcome pairs only');
eq(view.board.leakRate, 0.25, 'leak rate over four pass-verdict samples');
eq(view.leakRateText, '25.0%', 'leak rate formatting');
eq(view.falseBlockRateText, '—', 'block side has too few samples to quote a rate');
// j2 carries a cause; j5 was blocked, still booked as an aborted run with no
// cause on record — reported, and kept visibly separate from a ruined part.
eq(view.board.unresolvedScraps, 1, 'the aborted run has no cause on record');
eq(view.unresolvedAborted, 1, 'unresolved aborted run counted apart');
eq(view.unresolvedDefect, 0, 'no unresolved defect in this batch');

// j3 (finished, uninspected) and j4 (no verdict) must not appear in any outcome tally
const outcomeSum = view.outcomes.reduce((sum, row) => sum + row.count, 0);
eq(outcomeSum, 5, 'j3 uninspected and j4 unjudged stay out of every outcome tally');

eq(view.causeRows.length, 1, 'single attributed cause');
eq(view.causeRows[0]?.cause, 'machine', 'cause is machine');
eq(view.causeRows[0]?.count, 1, 'cause count');
eq(view.causeRows[0]?.methodLabel, '零件实测', 'strongest evidence label');

eq(view.machines.length, 1, 'only models with a dossier get a claim');
eq(view.machines[0]?.modelId, 'bambu_x1c', 'claim bound to the machine model');
ok(view.machines[0]!.axes.length > 0, 'claim exposes axes');
ok(view.line.includes('awaiting inspection'), 'top line states the inspection debt');

// An unresolved scrap must stay visibly unresolved rather than picking a cause.
const unresolved = buildYieldView(
  [makeJob({ id: 'u1', printerId: 'p1', verdict: { state: 'pass', policyVersion: 'v1' }, quality: 'defect' })],
  printers,
);
eq(unresolved.board.unresolvedScraps, 1, 'scrap without cause stays unresolved');
eq(unresolved.unresolvedDefect, 1, 'unresolved defect split out');
eq(unresolved.unresolvedAborted, 0, 'no aborted run here');
eq(unresolved.attribution.attributed, false, 'attribution not claimed complete');

console.log(`OK ${checks} assertions`);
