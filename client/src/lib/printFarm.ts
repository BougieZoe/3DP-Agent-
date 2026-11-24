/**
 * Print Farm Management
 *
 * Multi-printer management and monitoring:
 * - Printer registry and status
 * - Job queue management
 * - Batch operations
 * - Resource tracking
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { MachineModel, MachineThermalCapability } from '@shared/domain/machine';
import type {
  FleetProviderId,
  PrinterTelemetry,
  TelemetryState,
} from '@shared/domain/fleetTelemetry';
import {
  assessModelMaterial,
  getMachineModel,
  getMachineThermalCapability,
} from '@shared/domain/machine';
import type { ThermalVerdict } from '@shared/domain/thermal';
import type { CalibrationMethod } from '@shared/domain/fieldCalibration';
import { type FailureCause, type YieldMeasurement, attributeScraps } from '@shared/domain/yieldAttribution';
import {
  type FarmSchedule,
  type SchedulerJob,
  type SchedulerPrinter,
  scheduleFarm,
} from '@shared/domain/farmScheduler';
import {
  type FloorPrinterSnapshot,
  type JobVerdictSnapshot,
  type PartQuality,
  describeFloor,
  floorScoreboard,
} from '@shared/domain/yieldLedger';

export interface Printer {
  id: string;
  name: string;
  model: string;
  /**
   * Foreign key into MACHINE_MODELS (shared/domain/machine) — the spec layer.
   * This is the whole point of the column: a printer row used to be free text
   * (`model: 'X1C'`), which made it impossible to answer "what is this machine's
   * thermal ceiling" without a human reading a PDF. null = legacy row that has
   * not been bound to a spec; lookups then degrade to `unverified`, never to a
   * guessed number.
   */
  modelId?: string | null;
  manufacturer: string;
  status: PrinterStatus;
  capabilities: PrinterCapabilities;
  currentJob: PrintJob | null;
  stats: PrinterStats;
  lastSeen: string;
  ipAddress?: string;
  apiEndpoint?: string;
  /**
   * When a machine under maintenance is expected back. Without it the scheduler
   * treats the machine as having no known free window instead of assuming it is
   * available at the next plan boundary.
   */
  maintenanceUntil?: string | null;
}

export type PrinterStatus =
  | 'idle'
  | 'printing'
  | 'paused'
  | 'error'
  | 'offline'
  | 'maintenance'
  | 'completed';

export interface PrinterCapabilities {
  technologies: string[];
  materials: string[];
  maxBuildVolume: { x: number; y: number; z: number };
  minLayerHeight: number;
  maxLayerHeight: number;
  heatedBed: boolean;
  enclosure: boolean;
  multiColor: boolean;
}

export interface PrinterStats {
  totalPrints: number;
  successRate: number;
  totalPrintTimeHours: number;
  totalMaterialUsedGrams: number;
  lastMaintenance?: string;
  errorCount: number;
}

/**
 * The facts a job needs in order to be time-phased.
 *
 * Kept separate from the execution fields on purpose: a job can be queued with
 * nothing but a name and a material (that is how a person adds work), and such a
 * job is then reported as unplannable instead of being given invented numbers.
 */
export interface PrintSpec {
  /** Part footprint in mm. null = never measured, which blocks scheduling. */
  footprintMm: { x: number; y: number; z: number } | null;
  /** Estimated run time in minutes; must be > 0 to reserve a slot. */
  durationMinutes: number;
  technology?: string;
  layerHeightMm?: number | null;
  dueAt?: string | null;
  priority?: number;
}

export interface PrintJob {
  id: string;
  printerId: string;
  name: string;
  fileName: string;
  status: JobStatus;
  progress: number;
  startedAt: string;
  estimatedEndAt: string;
  actualEndAt?: string;
  material: string;
  materialUsedGrams: number;
  layers: { current: number; total: number };
  temperatures: { nozzle: number; bed: number };
  errors: JobError[];
  /**
   * Verdict checkpoint written before the job ran. Optional because legacy rows
   * predate it — but a job without it can never be scored, which is exactly what
   * `yieldLedger` reports as `unjudged`.
   */
  verdict?: JobVerdictSnapshot;
  /**
   * Inspection result of the part. Absent / 'pending' means "the machine
   * finished, nobody looked yet" — deliberately not the same as good.
   */
  quality?: PartQuality;
  /** Why the part was scrapped or the run aborted. Empty stays empty: unresolved, on purpose. */
  scrapCauses?: FailureCause[];
  /** How the scrap cause was established; feeds the evidence grade, not the story. */
  attributionMethod?: CalibrationMethod;
  /** Measured values this job produced, for the field-calibration loop. */
  measurements?: YieldMeasurement[];
  /**
   * Scheduling facts (footprint, duration, due date). Absent means the job cannot
   * be time-phased yet; it stays queued and is reported, never guessed into a slot.
   */
  spec?: PrintSpec;
}

export type JobStatus =
  | 'queued'
  | 'preparing'
  | 'printing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobError {
  timestamp: string;
  message: string;
  severity: 'warning' | 'error' | 'critical';
}

export interface PrintFarmStats {
  totalPrinters: number;
  activePrinters: number;
  queuedJobs: number;
  completedToday: number;
  failedToday: number;
  materialUsageGrams: number;
  printTimeHours: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const PRINTER_STORAGE_KEY = '3dp_agent_printers';
const JOB_STORAGE_KEY = '3dp_agent_jobs';

/**
 * Get all registered printers
 */
export function getPrinters(): Printer[] {
  try {
    const data = localStorage.getItem(PRINTER_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Save printers to storage
 */
export function savePrinters(printers: Printer[]): void {
  localStorage.setItem(PRINTER_STORAGE_KEY, JSON.stringify(printers));
}

/**
 * Add a new printer
 */
export function addPrinter(printer: Omit<Printer, 'id' | 'stats' | 'lastSeen'>): Printer {
  const printers = getPrinters();
  const newPrinter: Printer = {
    ...printer,
    id: `printer_${Date.now().toString(36)}`,
    stats: {
      totalPrints: 0,
      successRate: 100,
      totalPrintTimeHours: 0,
      totalMaterialUsedGrams: 0,
      errorCount: 0,
    },
    lastSeen: new Date().toISOString(),
  };
  printers.push(newPrinter);
  savePrinters(printers);
  return newPrinter;
}

/**
 * Update printer status
 */
export function updatePrinterStatus(
  printerId: string,
  status: PrinterStatus,
  currentJob?: PrintJob | null
): void {
  const printers = getPrinters();
  const printer = printers.find(p => p.id === printerId);
  if (printer) {
    printer.status = status;
    printer.currentJob = currentJob ?? printer.currentJob;
    printer.lastSeen = new Date().toISOString();
    savePrinters(printers);
  }
}

/**
 * Remove a printer
 */
export function removePrinter(printerId: string): void {
  const printers = getPrinters().filter(p => p.id !== printerId);
  savePrinters(printers);
}

// ---------------------------------------------------------------------------
// Job Queue
// ---------------------------------------------------------------------------

/**
 * Get all print jobs
 */
export function getPrintJobs(): PrintJob[] {
  try {
    const data = localStorage.getItem(JOB_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Save print jobs
 */
export function savePrintJobs(jobs: PrintJob[]): void {
  localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify(jobs));
}

/**
 * Add a job to the queue
 */
export function queueJob(job: Omit<PrintJob, 'id' | 'startedAt' | 'progress' | 'errors'>): PrintJob {
  const jobs = getPrintJobs();
  const newJob: PrintJob = {
    ...job,
    id: `job_${Date.now().toString(36)}`,
    startedAt: new Date().toISOString(),
    progress: 0,
    errors: [],
  };
  jobs.push(newJob);
  savePrintJobs(jobs);
  return newJob;
}

/**
 * Update job progress
 */
export function updateJobProgress(
  jobId: string,
  progress: number,
  layers: { current: number; total: number },
  temperatures: { nozzle: number; bed: number }
): void {
  const jobs = getPrintJobs();
  const job = jobs.find(j => j.id === jobId);
  if (job) {
    job.progress = progress;
    job.layers = layers;
    job.temperatures = temperatures;
    savePrintJobs(jobs);
  }
}

/**
 * Complete a job.
 *
 * `success` describes the run — the machine finished or it did not. It says
 * nothing about the part. Inspection results arrive later and are recorded via
 * `markJobQuality`; a completed job with no quality stays `pending` and is
 * counted as awaiting inspection, never as a good part.
 */
export function completeJob(
  jobId: string,
  success: boolean,
  result?: {
    quality?: PartQuality;
    causes?: FailureCause[];
    method?: CalibrationMethod;
    measurements?: YieldMeasurement[];
  },
): void {
  const jobs = getPrintJobs();
  const job = jobs.find(j => j.id === jobId);
  if (job) {
    job.status = success ? 'completed' : 'failed';
    job.progress = 100;
    job.actualEndAt = new Date().toISOString();
    if (result?.quality !== undefined) job.quality = result.quality;
    if (result?.causes !== undefined) job.scrapCauses = result.causes;
    if (result?.method !== undefined) job.attributionMethod = result.method;
    if (result?.measurements !== undefined) job.measurements = result.measurements;
    savePrintJobs(jobs);

    // Update printer stats
    const printers = getPrinters();
    const printer = printers.find(p => p.id === job.printerId);
    if (printer) {
      printer.stats.totalPrints++;
      if (!success) printer.stats.errorCount++;
      printer.stats.successRate = (printer.stats.totalPrints - printer.stats.errorCount) / printer.stats.totalPrints * 100;
      printer.currentJob = null;
      printer.status = 'idle';
      savePrinters(printers);
    }
  }
}

/**
 * Attach the pre-flight verdict to a job.
 *
 * Must be called before the job runs. A verdict written after the outcome is a
 * verdict that already knew the answer, and it would poison every rate computed
 * from the ledger.
 */
export function recordJobVerdict(jobId: string, verdict: JobVerdictSnapshot): void {
  const jobs = getPrintJobs();
  const job = jobs.find(j => j.id === jobId);
  if (job) {
    job.verdict = verdict;
    savePrintJobs(jobs);
  }
}

/**
 * Record the inspection result — the step that turns a finished job into
 * scorable evidence. Until this is called the job remains `pending` and is
 * reported as awaiting inspection.
 */
export function markJobQuality(
  jobId: string,
  quality: PartQuality,
  opts?: {
    causes?: FailureCause[];
    method?: CalibrationMethod;
    measurements?: YieldMeasurement[];
  },
): void {
  const jobs = getPrintJobs();
  const job = jobs.find(j => j.id === jobId);
  if (job) {
    job.quality = quality;
    if (opts?.causes !== undefined) job.scrapCauses = opts.causes;
    if (opts?.method !== undefined) job.attributionMethod = opts.method;
    if (opts?.measurements !== undefined) job.measurements = opts.measurements;
    savePrintJobs(jobs);
  }
}

/**
 * Cancel a job
 */
export function cancelJob(jobId: string): void {
  const jobs = getPrintJobs();
  const job = jobs.find(j => j.id === jobId);
  if (job) {
    job.status = 'cancelled';
    job.actualEndAt = new Date().toISOString();
    savePrintJobs(jobs);

    // Free up printer
    const printers = getPrinters();
    const printer = printers.find(p => p.id === job.printerId);
    if (printer) {
      printer.currentJob = null;
      printer.status = 'idle';
      savePrinters(printers);
    }
  }
}

// ---------------------------------------------------------------------------
// Farm Statistics
// ---------------------------------------------------------------------------

/**
 * Get farm-wide statistics
 */
export function getFarmStats(): PrintFarmStats {
  const printers = getPrinters();
  const jobs = getPrintJobs();
  const today = new Date().toISOString().split('T')[0];

  const todayJobs = jobs.filter(j => j.startedAt.startsWith(today));

  return {
    totalPrinters: printers.length,
    activePrinters: printers.filter(p => p.status === 'printing').length,
    queuedJobs: jobs.filter(j => j.status === 'queued').length,
    completedToday: todayJobs.filter(j => j.status === 'completed').length,
    failedToday: todayJobs.filter(j => j.status === 'failed').length,
    materialUsageGrams: todayJobs.reduce((sum, j) => sum + j.materialUsedGrams, 0),
    printTimeHours: todayJobs.reduce((sum, j) => {
      if (j.actualEndAt) {
        const start = new Date(j.startedAt).getTime();
        const end = new Date(j.actualEndAt).getTime();
        return sum + (end - start) / 3600000;
      }
      return sum;
    }, 0),
  };
}

/**
 * Get printer utilization over time
 */
export function getPrinterUtilization(
  printerId: string,
  days: number = 7
): { date: string; hours: number }[] {
  const jobs = getPrintJobs();
  const printerJobs = jobs.filter(j => j.printerId === printerId && j.actualEndAt);

  const utilization: Record<string, number> = {};

  for (let d = 0; d < days; d++) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().split('T')[0];
    utilization[dateStr] = 0;
  }

  for (const job of printerJobs) {
    const dateStr = job.startedAt.split('T')[0];
    if (utilization[dateStr] !== undefined) {
      const start = new Date(job.startedAt).getTime();
      const end = new Date(job.actualEndAt!).getTime();
      utilization[dateStr] += (end - start) / 3600000;
    }
  }

  return Object.entries(utilization)
    .map(([date, hours]) => ({ date, hours }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Batch Operations
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scheduling (delegated to shared/domain/farmScheduler)
// ---------------------------------------------------------------------------

/**
 * Usable build volume, or null when it was never recorded.
 *
 * A zero/absent box means "nobody filled this in", not "this machine prints
 * nothing", and the scheduler must see the difference: the first blocks the job
 * with a stated reason, the second would wrongly rule the machine out forever.
 */
function knownBuildVolume(printer: Printer): { x: number; y: number; z: number } | null {
  const volume = printer.capabilities?.maxBuildVolume;
  if (!volume) return null;
  if (!(volume.x > 0) || !(volume.y > 0) || !(volume.z > 0)) return null;
  return { x: volume.x, y: volume.y, z: volume.z };
}

function knownLayerRange(printer: Printer): { min: number; max: number } | null {
  const min = printer.capabilities?.minLayerHeight;
  const max = printer.capabilities?.maxLayerHeight;
  if (!(min > 0) || !(max >= min)) return null;
  return { min, max };
}

/** Project a stored fleet row into the planner's input shape. */
export function toSchedulerPrinter(printer: Printer): SchedulerPrinter {
  return {
    id: printer.id,
    name: printer.name,
    status: printer.status,
    technologies: printer.capabilities?.technologies ?? [],
    materials: printer.capabilities?.materials ?? [],
    buildVolumeMm: knownBuildVolume(printer),
    layerRangeMm: knownLayerRange(printer),
    successRatePct: printer.stats?.successRate ?? 0,
    current: printer.currentJob
      ? {
          jobId: printer.currentJob.id,
          material: printer.currentJob.material ?? null,
          endsAt: printer.currentJob.estimatedEndAt ?? null,
        }
      : null,
    availableAt: printer.maintenanceUntil ?? null,
  };
}

/**
 * Project a queued job into the planner's input shape.
 *
 * A job without `spec` yields a zero duration on purpose: the planner then reports
 * it as `invalid-duration` instead of putting a guessed slot in the timeline.
 */
export function toSchedulerJob(job: PrintJob): SchedulerJob {
  const spec = job.spec;
  return {
    id: job.id,
    name: job.name,
    material: job.material,
    technology: spec?.technology,
    footprintMm: spec?.footprintMm ?? null,
    durationMinutes: spec?.durationMinutes ?? 0,
    priority: spec?.priority,
    dueAt: spec?.dueAt ?? null,
    layerHeightMm: spec?.layerHeightMm ?? null,
  };
}

export interface PlanFarmQueueOptions {
  /** Plan reference time. Defaults to the wall clock — pass a fixed value in tests. */
  now?: string;
  marginMm?: number;
  changeoverMinutes?: number;
}

/**
 * Plan every `queued` job across the registered fleet.
 *
 * Read-only by design: a plan is a proposal, so nothing is written here. The
 * dashboard can render this and let a human commit to it.
 */
export function planFarmQueue(options: PlanFarmQueueOptions = {}): FarmSchedule {
  const now = options.now ?? new Date().toISOString();
  const printers = getPrinters().map(toSchedulerPrinter);
  const jobs = getPrintJobs()
    .filter((job) => job.status === 'queued')
    .map(toSchedulerJob);

  return scheduleFarm(jobs, printers, {
    now,
    marginMm: options.marginMm,
    changeoverMinutes: options.changeoverMinutes,
  });
}

export interface AdoptScheduleResult {
  /** Jobs that received a printer and a planned end time from the plan. */
  planned: number;
  /** Jobs actually claimed onto hardware because their window had opened. */
  started: number;
}

/**
 * Write a plan back onto the queue.
 *
 * Recording the plan (printerId + estimatedEndAt) and claiming a machine are kept
 * apart: bookkeeping is safe to do for a plan that starts tomorrow, flipping a
 * printer to `printing` is not.
 */
export function adoptFarmSchedule(
  plan: FarmSchedule,
  options: { start?: boolean; now?: string } = {},
): AdoptScheduleResult {
  const start = options.start ?? false;
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  const printers = getPrinters();
  const jobs = getPrintJobs();
  let planned = 0;
  let started = 0;

  for (const assignment of plan.assignments) {
    const job = jobs.find((j) => j.id === assignment.jobId);
    if (!job) continue;

    job.printerId = assignment.printerId;
    job.estimatedEndAt = assignment.plannedEndAt;
    planned++;

    if (!start) continue;
    const startMs = Date.parse(assignment.plannedStartAt);
    if (Number.isNaN(startMs) || startMs > nowMs) continue;

    const printer = printers.find((p) => p.id === assignment.printerId);
    if (!printer) continue;
    // One machine, one job. The plan is serial per machine, but a stale row may
    // still be holding a finished print, so never overwrite a live currentJob.
    if (printer.currentJob && printer.status === 'printing') continue;

    job.status = 'preparing';
    job.startedAt = new Date(startMs).toISOString();
    printer.currentJob = job;
    printer.status = 'printing';
    printer.lastSeen = new Date(nowMs).toISOString();
    started++;
  }

  savePrintJobs(jobs);
  // Persist the array that was actually mutated. The previous path re-read storage
  // here and silently discarded the printer status it had just changed.
  savePrinters(printers);

  return { planned, started };
}

/**
 * Dispatch whatever can start right now.
 *
 * Retained as the single-call entry point, but the decision comes from the
 * planner: no hard-coded 200 mm envelope and no assumption that every machine is
 * some generic FDM box.
 */
export function autoAssignJobs(now: string = new Date().toISOString()): number {
  const plan = planFarmQueue({ now });
  return adoptFarmSchedule(plan, { start: true, now }).started;
}

/**
 * Best machine for one hypothetical part.
 *
 * Kept for callers that only need the pick; the answer now comes from the planner
 * (footprint, material, technology, existing load) rather than a fixed 200 mm box.
 */
export function findBestPrinter(
  requirements: {
    technology: string;
    material: string;
    buildVolumeRequired: { x: number; y: number; z: number };
  }
): Printer | null {
  const printers = getPrinters();
  if (printers.length === 0) return null;

  const probe: SchedulerJob = {
    id: '__probe__',
    name: '__probe__',
    material: requirements.material,
    technology: requirements.technology,
    footprintMm: requirements.buildVolumeRequired,
    durationMinutes: 1,
  };

  const plan = scheduleFarm([probe], printers.map(toSchedulerPrinter), {
    now: new Date().toISOString(),
  });

  const picked = plan.assignments[0];
  if (!picked) return null;
  return printers.find((p) => p.id === picked.printerId) ?? null;
}


// ---------------------------------------------------------------------------
// Spec binding — printer rows resolve into the machine spec layer
// ---------------------------------------------------------------------------

/** Resolve a printer's spec. Returns undefined for legacy rows (modelId null). */
export function resolvePrinterModel(printer: Printer): MachineModel | undefined {
  if (!printer.modelId) return undefined;
  return getMachineModel(printer.modelId);
}

/** Thermal ceilings for this printer, via its modelId. Unbound rows are all-unknown. */
export function printerThermalCapability(printer: Printer): MachineThermalCapability {
  if (!printer.modelId) return getMachineThermalCapability('__unbound__');
  return getMachineThermalCapability(printer.modelId);
}

/**
 * "Can this floor machine actually run this material, and if not, which axis
 * blocks it?" Answered from the spec layer, not from whoever is on shift.
 */
export function printerCanRunMaterial(printer: Printer, material: string): ThermalVerdict {
  if (!printer.modelId) {
    return {
      material,
      printable: 'unknown',
      blockedBy: ['unknown-machine'],
      headroomC: { nozzle: null, chamber: null, bed: null },
      bindingAxis: null,
      grade: 'unverified',
      reason: `printer ${printer.id} has no modelId; bind it to MACHINE_MODELS before judging material fit`,
    };
  }
  return assessModelMaterial(printer.modelId, material);
}

export interface MaterialFitReport {
  material: string;
  usable: Printer[];
  blocked: Array<{ printer: Printer; verdict: ThermalVerdict }>;
  unjudged: Array<{ printer: Printer; verdict: ThermalVerdict }>;
}

/**
 * Fleet-level triage for a material. Deliberately keeps `unjudged` separate from
 * `blocked`: a missing spec is a data debt to pay, not a machine to write off.
 */
export function printersForMaterial(printers: Printer[], material: string): MaterialFitReport {
  const usable: Printer[] = [];
  const blocked: Array<{ printer: Printer; verdict: ThermalVerdict }> = [];
  const unjudged: Array<{ printer: Printer; verdict: ThermalVerdict }> = [];
  for (const printer of printers) {
    const verdict = printerCanRunMaterial(printer, material);
    if (verdict.printable === true) usable.push(printer);
    else if (verdict.printable === false) blocked.push({ printer, verdict });
    else unjudged.push({ printer, verdict });
  }
  return { material, usable, blocked, unjudged };
}

// ---------------------------------------------------------------------------
// Fleet telemetry write-back (real device source)
// ---------------------------------------------------------------------------

/**
 * Telemetry state to PrinterStatus. `unknown` maps to null on purpose: when the
 * controller does not say what it is doing, the printer keeps whatever status it
 * already had instead of being relabelled with a guess.
 */
const TELEMETRY_STATUS: Record<TelemetryState, PrinterStatus | null> = {
  idle: 'idle',
  printing: 'printing',
  paused: 'paused',
  completed: 'completed',
  error: 'error',
  offline: 'offline',
  unknown: null,
};

export interface TelemetryMatch {
  printerId: string;
  printerName: string;
  previousStatus: PrinterStatus;
  nextStatus: PrinterStatus;
  changed: boolean;
}

export interface ApplyTelemetryResult {
  provider: FleetProviderId;
  printerKey: string;
  observedAt: string;
  matches: TelemetryMatch[];
  /** True when nothing in the fleet list matched. Nothing is auto-created. */
  unmatched: boolean;
  notes: string[];
}

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  if (raw.length === 0) return null;
  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`).host;
  } catch {
    return raw;
  }
}

/**
 * Write one normalized telemetry snapshot back onto the matching local printer.
 *
 * Scope is deliberately narrow: it may change `status`, `currentJob.progress`
 * and `lastSeen` — nothing else. It never touches `stats`, never creates a job
 * record, and never invents a printer, because yield attribution and cost data
 * must keep coming from the job pipeline rather than from a poll. A poll that is
 * briefly wrong must not be able to move a success rate.
 *
 * Matching prefers an exact endpoint host (ipAddress / apiEndpoint) and falls
 * back to printer name. Anything ambiguous is reported as unmatched, never
 * resolved by silently picking the first candidate.
 */
export function applyTelemetry(telemetry: PrinterTelemetry): ApplyTelemetryResult {
  const printers = getPrinters();
  const key = telemetry.printerKey.trim().toLowerCase();

  const byEndpoint = printers.filter(
    (p) => hostOf(p.apiEndpoint) === key || hostOf(p.ipAddress) === key,
  );
  const candidates =
    byEndpoint.length > 0
      ? byEndpoint
      : printers.filter((p) => p.name.trim().toLowerCase() === key);

  const nextStatus = TELEMETRY_STATUS[telemetry.state];
  const matches: TelemetryMatch[] = [];

  for (const printer of candidates) {
    const previousStatus = printer.status;
    let changed = false;

    if (nextStatus !== null && printer.status !== nextStatus) {
      printer.status = nextStatus;
      changed = true;
    }

    if (
      (telemetry.state === 'printing' || telemetry.state === 'paused') &&
      printer.currentJob &&
      telemetry.progressPct !== null &&
      printer.currentJob.progress !== telemetry.progressPct
    ) {
      printer.currentJob = { ...printer.currentJob, progress: telemetry.progressPct };
      changed = true;
    }

    printer.lastSeen = telemetry.observedAt;

    matches.push({
      printerId: printer.id,
      printerName: printer.name,
      previousStatus,
      nextStatus: printer.status,
      changed,
    });
  }

  if (matches.length > 0) savePrinters(printers);

  const notes = [...telemetry.notes];
  if (matches.length === 0) {
    notes.push(`no printer in the fleet list matches "${telemetry.printerKey}"`);
  }

  return {
    provider: telemetry.provider,
    printerKey: telemetry.printerKey,
    observedAt: telemetry.observedAt,
    matches,
    unmatched: matches.length === 0,
    notes,
  };
}
