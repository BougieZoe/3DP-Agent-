/**
 * Yield ledger — the collection layer that makes attribution possible.
 *
 * The shop has always had jobs; what it never had was the pairing of "what the
 * rules said" with "what the part turned out to be". Without that pair there is
 * no way to say the verdicts are any good, and no observations to feed back into
 * calibration. This file builds the pair, and refuses three tempting shortcuts:
 *
 *  1. A completed job is not a good part. Until someone inspects it, the job is
 *     `awaitingInspection`, not a win. Counting completions as successes is how a
 *     scoreboard reaches 98% while scrap walks out the door.
 *
 *  2. A job with no recorded verdict cannot be scored. It is counted as
 *     `unjudged` and reported — an unmeasured rule set stays visibly unmeasured.
 *
 *  3. A printer with no `modelId` still produces records, filed under
 *     `unbound-machine`. Losing the history to a missing foreign key would be a
 *     second mistake on top of the first.
 */

import {
  type AttributionReport,
  type FailureCause,
  type VerdictState,
  type YieldMeasurement,
  type YieldRecord,
  type YieldScoreboard,
  type YieldScope,
  attributeScraps,
  describeScoreboard,
  scoreYield,
} from './yieldAttribution';
import type { CalibrationMethod } from './fieldCalibration';

/** Mirrors the job states the floor actually reports. */
export type FloorJobStatus =
  | 'queued'
  | 'preparing'
  | 'printing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Inspection verdict on the printed part. `pending` is a real, common state. */
export type PartQuality = 'good' | 'defect' | 'pending';

/** The verdict checkpoint written before the job ran. */
export interface JobVerdictSnapshot {
  state: VerdictState;
  policyVersion: string;
}

/**
 * The minimum a job must expose to be scored. Structural, so the client's
 * `PrintJob` satisfies it without the shared layer depending on the client.
 */
export interface FloorJobSnapshot {
  id: string;
  printerId: string;
  status: FloorJobStatus;
  startedAt: string;
  actualEndAt?: string;
  verdict?: JobVerdictSnapshot;
  quality?: PartQuality;
  scrapCauses?: FailureCause[];
  attributionMethod?: CalibrationMethod;
  measurements?: YieldMeasurement[];
}

export interface FloorPrinterSnapshot {
  id: string;
  /** Foreign key into the machine spec layer. null/undefined = legacy row. */
  modelId?: string | null;
}

export const UNBOUND_MACHINE = 'unbound-machine';

export interface YieldHarvest {
  records: YieldRecord[];
  /** Finished parts nobody has judged yet. Never counted as wins. */
  awaitingInspection: number;
  /** Finished jobs with no verdict checkpoint, so no comparison is possible. */
  unjudged: number;
  /** Still on the machine. */
  open: number;
  /** Records filed against a printer with no spec binding. */
  unboundMachines: number;
  /** Jobs the verdict refused that ran anyway. The only cheap falsification we get. */
  overrides: number;
}

const OPEN_STATES: ReadonlySet<FloorJobStatus> = new Set([
  'queued',
  'preparing',
  'printing',
  'paused',
]);

export function harvestYield(
  jobs: FloorJobSnapshot[],
  printers: FloorPrinterSnapshot[],
): YieldHarvest {
  const modelOf = new Map(printers.map((p) => [p.id, p.modelId ?? null]));

  const records: YieldRecord[] = [];
  let awaitingInspection = 0;
  let unjudged = 0;
  let open = 0;
  let unboundMachines = 0;
  let overrides = 0;

  for (const job of jobs) {
    if (OPEN_STATES.has(job.status)) {
      open += 1;
      continue;
    }

    const executed = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';

    // A cancellation before the first layer is not an outcome, it is a change of
    // plan. Without a start signal we cannot tell them apart, so it stays out.
    const outcome = toOutcome(job);
    if (outcome === null) {
      if (executed) awaitingInspection += 1;
      continue;
    }

    if (!job.verdict) {
      unjudged += 1;
      continue;
    }
    if (job.verdict.state === 'blocked' && outcome !== 'not-attempted') {
      overrides += 1;
    }

    const modelId = modelOf.get(job.printerId) ?? null;
    if (modelId === null) unboundMachines += 1;

    records.push({
      id: job.id,
      modelId: modelId ?? UNBOUND_MACHINE,
      unitId: job.printerId,
      at: job.actualEndAt ?? job.startedAt,
      verdict: job.verdict.state,
      policyVersion: job.verdict.policyVersion,
      outcome,
      causes: outcome === 'printed-ok' ? [] : (job.scrapCauses ?? []),
      method: job.attributionMethod ?? 'operator-note',
      measurements: job.measurements,
    });
  }

  return { records, awaitingInspection, unjudged, open, unboundMachines, overrides };
}

/**
 * Translate a finished job into an outcome — or decline to.
 *
 * Returns null when the job finished but the part has not been judged:
 * "completed" describes the machine, not the part.
 */
function toOutcome(job: FloorJobSnapshot): YieldRecord['outcome'] | null {
  if (job.status === 'failed' || job.status === 'cancelled') return 'aborted';
  if (job.status !== 'completed') return null;
  if (job.quality === 'good') return 'printed-ok';
  if (job.quality === 'defect') return 'printed-defect';
  return null;
}

export function floorScoreboard(
  jobs: FloorJobSnapshot[],
  printers: FloorPrinterSnapshot[],
  scope: YieldScope = {},
): { board: YieldScoreboard; harvest: YieldHarvest } {
  const harvest = harvestYield(jobs, printers);
  return { board: scoreYield(harvest.records, scope), harvest };
}

export function floorAttribution(
  jobs: FloorJobSnapshot[],
  printers: FloorPrinterSnapshot[],
  scope: YieldScope = {},
): AttributionReport {
  return attributeScraps(harvestYield(jobs, printers).records, scope);
}

/**
 * One line for the shift board. Data debt is stated in the same breath as the
 * rates, so a clean leak rate over an uninspected pile cannot be mistaken for
 * a good week.
 */
export function describeFloor(
  jobs: FloorJobSnapshot[],
  printers: FloorPrinterSnapshot[],
  scope: YieldScope = {},
): string {
  const { board, harvest } = floorScoreboard(jobs, printers, scope);
  const debts: string[] = [];
  if (harvest.awaitingInspection > 0) debts.push(`${harvest.awaitingInspection} awaiting inspection`);
  if (harvest.unjudged > 0) debts.push(`${harvest.unjudged} unjudged`);
  if (harvest.overrides > 0) debts.push(`${harvest.overrides} overrides`);
  if (harvest.unboundMachines > 0) debts.push(`${harvest.unboundMachines} unbound machine(s)`);
  const tail = debts.length > 0 ? ` | ${debts.join(', ')}` : '';
  return `${describeScoreboard(board)}${tail}`;
}
