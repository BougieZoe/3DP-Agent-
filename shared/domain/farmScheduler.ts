/**
 * Farm Scheduling
 *
 * Turns a set of queued jobs plus a fleet snapshot into a time-phased plan:
 * which printer runs what, in which order, starting when.
 *
 * Design stance (same as the rest of `shared/domain`):
 *   - Hard constraints are facts, not preferences. A part that is physically
 *     too large, or needs a material the machine cannot run, is never scheduled
 *     onto that machine to keep the queue moving.
 *   - Unknown is not permission. A machine whose build volume was never
 *     recorded cannot be proven to fit anything, so it is not guessed into the
 *     plan; the job is reported as unassignable together with the missing fact.
 *   - Every rejected job leaves a reason behind. A scheduler that silently drops
 *     work is indistinguishable from one that lost it.
 *   - The result is deterministic: identical input yields an identical plan, so
 *     a diff between two runs is a real change and not hash-order noise.
 *
 * What this module deliberately does not do: it does not start prints, does not
 * write storage, and does not touch job status. It produces a plan; adopting the
 * plan is the caller's business.
 */

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

/** Printer states the scheduler understands. Mirrors `PrinterStatus` in printFarm. */
export type SchedulerPrinterStatus =
  | 'idle'
  | 'printing'
  | 'paused'
  | 'completed'
  | 'maintenance'
  | 'error'
  | 'offline';

export interface SchedulerPrinter {
  id: string;
  name: string;
  status: SchedulerPrinterStatus;
  /** Processes the machine can run, e.g. 'fdm'. Compare is case-insensitive. */
  technologies: string[];
  /** Materials actually loaded / cleared to run. Case-insensitive compare. */
  materials: string[];
  /**
   * Usable build volume in mm. `null` = never recorded. Not the same as "small":
   * an unrecorded volume blocks scheduling instead of defaulting to a number.
   */
  buildVolumeMm: { x: number; y: number; z: number } | null;
  /** Layer height window in mm. `null` = not reported; see `layerHeightMm` on jobs. */
  layerRangeMm?: { min: number; max: number } | null;
  /** Historical success rate, 0–100. Used only as a tie-breaker, never as a gate. */
  successRatePct?: number;
  /**
   * The job currently on the bed. `endsAt` is what the machine said; when it is
   * unknown the machine has no known free window and cannot be planned against.
   */
  current?: { jobId: string; material: string | null; endsAt: string | null } | null;
  /** Earliest time new work may start (maintenance end, operator ETA, recovery). */
  availableAt?: string | null;
}

export interface SchedulerJob {
  id: string;
  name: string;
  material: string;
  /** Defaults to 'fdm'. */
  technology?: string;
  /**
   * Part footprint in mm. `null` = unknown, and an unknown footprint cannot be
   * proven to fit any machine, so such a job is reported rather than placed.
   */
  footprintMm: { x: number; y: number; z: number } | null;
  /** Estimated run time. Must be > 0 to be plannable. */
  durationMinutes: number;
  /** Higher runs first. Default 0. */
  priority?: number;
  /** If the plan lands later than this, the job is still planned but flagged late. */
  dueAt?: string | null;
  /** Requested layer height; checked only when the machine reports a range. */
  layerHeightMm?: number | null;
}

export interface ScheduleOptions {
  /** Reference time for the plan. Required — "now" is never read from the clock. */
  now: string;
  /**
   * Safety margin subtracted from every build-volume axis (clamps, purge strip,
   * brim). Default 0, so the caller must ask for conservatism explicitly.
   */
  marginMm?: number;
  /**
   * Minutes burned switching a machine from one material to another (purge,
   * spool swap, first-layer re-check). Default 15.
   */
  changeoverMinutes?: number;
}

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

/**
 * Why a job could not be placed. These are additive: one job may be blocked for
 * several reasons across the fleet, and all of them are reported.
 */
export type ScheduleRejection =
  | 'unknown-footprint'
  | 'invalid-duration'
  | 'no-printers'
  | 'build-volume-unknown'
  | 'too-large'
  | 'material-unsupported'
  | 'technology-unsupported'
  | 'layer-height-unsupported'
  | 'no-ready-window';

export interface ScheduledAssignment {
  jobId: string;
  jobName: string;
  printerId: string;
  printerName: string;
  /** 1-based position in that printer's run order. */
  sequence: number;
  material: string;
  /** True when this job follows a different material on the same machine. */
  materialChange: boolean;
  changeoverMinutes: number;
  plannedStartAt: string;
  plannedEndAt: string;
  /** Minutes past `dueAt`. 0 when on time, absent due date never counts as late. */
  lateMinutes: number;
  durationMinutes: number;
  /** Part volume / usable build volume, 0–1. Higher = tighter fit on that machine. */
  fitRatio: number;
}

export interface BlockedByPrinter {
  printerId: string;
  printerName: string;
  reasons: ScheduleRejection[];
}

export interface ScheduledUnassigned {
  jobId: string;
  jobName: string;
  reasons: ScheduleRejection[];
  /** Per-machine diagnosis, so the fix is obvious (fill a spec, load a material). */
  blockedBy: BlockedByPrinter[];
}

export interface PrinterTimeline {
  printerId: string;
  printerName: string;
  /** Initial free moment, i.e. when this machine could first take work. */
  readyAt: string | null;
  jobIds: string[];
  /** Materials in run order, for reading changeover cost at a glance. */
  materialSequence: string[];
  busyMinutes: number;
  endsAt: string | null;
}

export interface FarmSchedule {
  now: string;
  assignments: ScheduledAssignment[];
  unassigned: ScheduledUnassigned[];
  timelines: PrinterTimeline[];
  /** Latest planned end across the fleet. null when nothing was placed. */
  makespanAt: string | null;
  /** Jobs that were placed but land after their due date. */
  lateJobIds: string[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const DEFAULT_CHANGEOVER_MINUTES = 15;
const DEFAULT_TECHNOLOGY = 'fdm';

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Volume product of a triple; returns 0 when any axis is non-positive. */
function volumeOf(size: { x: number; y: number; z: number }): number {
  return size.x * size.y * size.z;
}

/**
 * When can this machine take its next job?
 *
 * Returns null when the answer is genuinely unknown — an errored printer with no
 * recovery ETA, or a running one with no reported finish. Those machines are
 * left out of the plan instead of being assumed free, because assuming free is
 * how double-booked machines happen.
 */
function readyAtMs(printer: SchedulerPrinter, nowMs: number): number | null {
  const explicit = parseTime(printer.availableAt);

  switch (printer.status) {
    case 'idle':
    case 'completed':
      return explicit !== null ? Math.max(explicit, nowMs) : nowMs;
    case 'printing':
    case 'paused': {
      const ends = parseTime(printer.current?.endsAt);
      if (ends !== null) return Math.max(ends, nowMs);
      // A paused machine has no meaningful ETA; fall back to an explicit one only.
      return printer.status === 'paused' && explicit !== null ? Math.max(explicit, nowMs) : null;
    }
    case 'maintenance':
    case 'error':
    case 'offline':
      // Only plannable once someone states when it comes back.
      return explicit !== null ? Math.max(explicit, nowMs) : null;
    default:
      return null;
  }
}

/** Material currently loaded, used to price a changeover. */
function loadedMaterial(printer: SchedulerPrinter): string | null {
  const fromCurrent = printer.current?.material;
  return fromCurrent ? norm(fromCurrent) : null;
}

/**
 * Hard-constraint check for one job against one machine.
 * An empty array means "physically possible"; anything else names the blockers.
 */
function rejectionsFor(
  job: SchedulerJob,
  printer: SchedulerPrinter,
  marginMm: number,
): ScheduleRejection[] {
  const reasons: ScheduleRejection[] = [];

  if (job.footprintMm === null) {
    reasons.push('unknown-footprint');
    return reasons; // Nothing else can be judged without a size.
  }

  const technology = norm(job.technology ?? DEFAULT_TECHNOLOGY);
  if (!printer.technologies.map(norm).includes(technology)) {
    reasons.push('technology-unsupported');
  }

  if (!printer.materials.map(norm).includes(norm(job.material))) {
    reasons.push('material-unsupported');
  }

  if (printer.buildVolumeMm === null) {
    // Unknown volume is a data debt, reported as such rather than passed over.
    reasons.push('build-volume-unknown');
  } else {
    const usable = {
      x: printer.buildVolumeMm.x - marginMm,
      y: printer.buildVolumeMm.y - marginMm,
      z: printer.buildVolumeMm.z - marginMm,
    };
    if (
      usable.x <= 0 ||
      usable.y <= 0 ||
      usable.z <= 0 ||
      job.footprintMm.x > usable.x ||
      job.footprintMm.y > usable.y ||
      job.footprintMm.z > usable.z
    ) {
      reasons.push('too-large');
    }
  }

  if (
    job.layerHeightMm !== null &&
    job.layerHeightMm !== undefined &&
    printer.layerRangeMm
  ) {
    if (job.layerHeightMm < printer.layerRangeMm.min || job.layerHeightMm > printer.layerRangeMm.max) {
      reasons.push('layer-height-unsupported');
    }
  }

  return reasons;
}

/** Tighter fits first: a small part should not eat the only large-format machine. */
function fitRatioFor(job: SchedulerJob, printer: SchedulerPrinter): number {
  if (job.footprintMm === null || printer.buildVolumeMm === null) return 0;
  const machineVolume = volumeOf(printer.buildVolumeMm);
  if (machineVolume <= 0) return 0;
  const ratio = volumeOf(job.footprintMm) / machineVolume;
  return ratio > 1 ? 1 : ratio < 0 ? 0 : ratio;
}

/**
 * Queue order. Largest-first is the classic bin-packing order: it keeps the few
 * big slots available instead of letting small parts fragment them. Priority and
 * due date outrank size because a customer commitment beats packing efficiency.
 */
function compareJobs(a: SchedulerJob, b: SchedulerJob): number {
  const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0);
  if (priorityDelta !== 0) return priorityDelta;

  const aDue = parseTime(a.dueAt);
  const bDue = parseTime(b.dueAt);
  if (aDue !== null && bDue !== null && aDue !== bDue) return aDue - bDue;
  if (aDue !== null && bDue === null) return -1;
  if (aDue === null && bDue !== null) return 1;

  const aSize = a.footprintMm ? volumeOf(a.footprintMm) : 0;
  const bSize = b.footprintMm ? volumeOf(b.footprintMm) : 0;
  if (aSize !== bSize) return bSize - aSize;

  return a.id.localeCompare(b.id);
}

interface Candidate {
  printer: SchedulerPrinter;
  startAt: number;
  endAt: number;
  changeoverMinutes: number;
  materialChange: boolean;
  fitRatio: number;
}

/**
 * Pick the machine that finishes this job soonest. Changeover time is already
 * folded into `startAt`, so "swap a spool and start now" genuinely competes with
 * "wait three hours for the machine already holding the right material".
 *
 * Ties break toward the fewest material changes, then the tightest fit (protect
 * large machines), then the better track record, then id — the id tie-break is
 * what keeps two identical runs byte-identical.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.endAt !== b.endAt) return a.endAt - b.endAt;
  if (a.materialChange !== b.materialChange) return a.materialChange ? 1 : -1;
  if (a.fitRatio !== b.fitRatio) return b.fitRatio - a.fitRatio;
  const aRate = a.printer.successRatePct ?? 0;
  const bRate = b.printer.successRatePct ?? 0;
  if (aRate !== bRate) return bRate - aRate;
  return a.printer.id.localeCompare(b.printer.id);
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * Build a plan for `jobs` across `printers`.
 *
 * Machines run one job at a time, so each machine is modelled as a cursor that
 * advances by changeover + duration. Jobs that no machine can physically run are
 * returned in `unassigned` with per-machine reasons; jobs that fit but miss their
 * due date are still planned and flagged in `lateJobIds`.
 */
export function scheduleFarm(
  jobs: SchedulerJob[],
  printers: SchedulerPrinter[],
  options: ScheduleOptions,
): FarmSchedule {
  const nowMs = parseTime(options.now);
  if (nowMs === null) throw new Error(`scheduleFarm: invalid now "${options.now}"`);

  const marginMm = options.marginMm ?? 0;
  const changeoverMinutes = options.changeoverMinutes ?? DEFAULT_CHANGEOVER_MINUTES;
  const notes: string[] = [];

  const assignments: ScheduledAssignment[] = [];
  const unassigned: ScheduledUnassigned[] = [];
  const lateJobIds: string[] = [];

  // Per-machine cursor state.
  const state = new Map<
    string,
    { cursor: number | null; lastMaterial: string | null; sequence: number; jobIds: string[] }
  >();
  for (const printer of printers) {
    state.set(printer.id, {
      cursor: readyAtMs(printer, nowMs),
      lastMaterial: loadedMaterial(printer),
      sequence: 0,
      jobIds: [],
    });
  }

  if (printers.length === 0) {
    for (const job of jobs) {
      unassigned.push({
        jobId: job.id,
        jobName: job.name,
        reasons: ['no-printers'],
        blockedBy: [],
      });
    }
    return {
      now: toIso(nowMs),
      assignments,
      unassigned,
      timelines: [],
      makespanAt: null,
      lateJobIds,
      notes: ['no printers registered; nothing can be scheduled'],
    };
  }

  for (const job of [...jobs].sort(compareJobs)) {
    // A job with no duration is not schedulable at all: it would occupy a slot of
    // zero length, which quietly tells the plan a machine is free again at once.
    if (!Number.isFinite(job.durationMinutes) || job.durationMinutes <= 0) {
      unassigned.push({
        jobId: job.id,
        jobName: job.name,
        reasons: ['invalid-duration'],
        blockedBy: [],
      });
      continue;
    }

    const blockedBy: BlockedByPrinter[] = [];
    const candidates: Candidate[] = [];
    const allReasons = new Set<ScheduleRejection>();

    for (const printer of printers) {
      const reasons = rejectionsFor(job, printer, marginMm);
      if (reasons.length > 0) {
        reasons.forEach((r) => allReasons.add(r));
        blockedBy.push({ printerId: printer.id, printerName: printer.name, reasons });
        continue;
      }

      const machine = state.get(printer.id)!;
      if (machine.cursor === null) {
        // Physically fine, but no known free moment.
        allReasons.add('no-ready-window');
        blockedBy.push({ printerId: printer.id, printerName: printer.name, reasons: ['no-ready-window'] });
        continue;
      }

      const loaded = machine.lastMaterial;
      const materialChange = loaded !== null && loaded !== norm(job.material);
      const changeover = materialChange ? changeoverMinutes : 0;
      const startAt = machine.cursor + changeover * MINUTE_MS;

      candidates.push({
        printer,
        startAt,
        endAt: startAt + job.durationMinutes * MINUTE_MS,
        changeoverMinutes: changeover,
        materialChange,
        fitRatio: fitRatioFor(job, printer),
      });
    }

    if (candidates.length === 0) {
      unassigned.push({
        jobId: job.id,
        jobName: job.name,
        reasons: [...allReasons].sort(),
        blockedBy,
      });
      continue;
    }

    const best = candidates.sort(compareCandidates)[0];
    const machine = state.get(best.printer.id)!;

    machine.cursor = best.endAt;
    machine.lastMaterial = norm(job.material);
    machine.sequence += 1;
    machine.jobIds.push(job.id);

    const dueMs = parseTime(job.dueAt);
    const lateMinutes =
      dueMs !== null && best.endAt > dueMs ? Math.round((best.endAt - dueMs) / MINUTE_MS) : 0;
    if (lateMinutes > 0) lateJobIds.push(job.id);

    assignments.push({
      jobId: job.id,
      jobName: job.name,
      printerId: best.printer.id,
      printerName: best.printer.name,
      sequence: machine.sequence,
      material: job.material,
      materialChange: best.materialChange,
      changeoverMinutes: best.changeoverMinutes,
      plannedStartAt: toIso(best.startAt),
      plannedEndAt: toIso(best.endAt),
      lateMinutes,
      durationMinutes: job.durationMinutes,
      fitRatio: Number(best.fitRatio.toFixed(4)),
    });
  }

  // Timelines are rebuilt from the assignments so they can never disagree.
  const timelines: PrinterTimeline[] = printers.map((printer) => {
    const machine = state.get(printer.id)!;
    const own = assignments.filter((a) => a.printerId === printer.id);
    return {
      printerId: printer.id,
      printerName: printer.name,
      readyAt: machine.cursor === null ? null : toIso(readyAtMs(printer, nowMs) ?? nowMs),
      jobIds: machine.jobIds,
      materialSequence: own.map((a) => a.material),
      busyMinutes: own.reduce((sum, a) => sum + a.durationMinutes + a.changeoverMinutes, 0),
      endsAt: own.length > 0 ? own[own.length - 1].plannedEndAt : null,
    };
  });

  const makespanMs = assignments.reduce<number | null>((latest, a) => {
    const end = parseTime(a.plannedEndAt)!;
    return latest === null || end > latest ? end : latest;
  }, null);

  if (unassigned.length > 0) {
    notes.push(`${unassigned.length} job(s) could not be placed; see their reasons`);
  }
  if (lateJobIds.length > 0) {
    notes.push(`${lateJobIds.length} job(s) planned after their due date`);
  }
  const unknownVolume = printers.filter((p) => p.buildVolumeMm === null);
  if (unknownVolume.length > 0) {
    notes.push(
      `${unknownVolume.length} printer(s) have no build volume on record and were not scheduled`,
    );
  }

  return {
    now: toIso(nowMs),
    assignments,
    unassigned,
    timelines,
    makespanAt: makespanMs === null ? null : toIso(makespanMs),
    lateJobIds,
    notes,
  };
}

/**
 * One-line summary, in the same shape as `describeFloor`: what the plan covers,
 * what it finishes, and what it owes.
 */
export function describeSchedule(plan: FarmSchedule): string {
  const placed = plan.assignments.length;
  const total = placed + plan.unassigned.length;
  const head =
    total === 0
      ? 'nothing to schedule'
      : `${placed}/${total} job(s) placed across ${plan.timelines.length} machine(s)`;

  const span =
    plan.makespanAt === null ? 'no makespan' : `makespan ${plan.makespanAt}`;

  const debts: string[] = [];
  if (plan.unassigned.length > 0) debts.push(`${plan.unassigned.length} unplaced`);
  if (plan.lateJobIds.length > 0) debts.push(`${plan.lateJobIds.length} late`);
  const tail = debts.length > 0 ? ` | ${debts.join(', ')}` : '';

  return `${head} | ${span}${tail}`;
}
