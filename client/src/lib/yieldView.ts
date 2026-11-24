/**
 * View assembly for the floor yield panel.
 *
 * Kept free of React so it can be exercised directly (tsx) in this environment,
 * where vitest's rollup native binding is unusable. Everything here is a pure
 * projection of the domain modules: no rates are invented, no missing cause is
 * filled in, and "finished" is never allowed to read as "good".
 */
import type { PrintJob, Printer } from '@/lib/printFarm';
import type { CalibrationMethod } from '@shared/domain/fieldCalibration';
import type { ContentLang } from '@shared/i18n/content';
import type { EvidenceGrade } from '@shared/domain/evidence';
import { getMachineModel } from '@shared/domain/machine';
import {
  type YieldLabels,
  type YieldSentences,
  yieldLabels,
  yieldSentences,
} from './yieldLabels';
import {
  type AttributionReport,
  type FailureCause,
  type OutcomeClass,
  type YieldScoreboard,
  type YieldVersionExclusion,
  calibrationFromYield,
} from '@shared/domain/yieldAttribution';
import {
  type FloorJobSnapshot,
  type FloorPrinterSnapshot,
  type YieldHarvest,
  UNBOUND_MACHINE,
  describeFloor,
  floorAttribution,
  floorScoreboard,
} from '@shared/domain/yieldLedger';
import { type CapabilityClaim, type AxisClaim, capabilityClaim } from '@shared/domain/fieldOverlay';
import { VERDICT_POLICY_VERSION } from '@shared/domain/verdictPolicy';

// Labels moved to ./yieldLabels.ts, which carries every supported language.
// They used to be Chinese-only constants here — that is why the panel stayed
// Chinese no matter which language the user picked.

/** The one class that means the policy was wrong in the expensive direction. */
export const LEAK_CLASS: OutcomeClass = 'false-pass';

export const OUTCOME_ORDER: OutcomeClass[] = [
  'true-pass',
  'false-pass',
  'unverified-block',
  'false-block',
  'override-failed',
  'unexercised',
  'inconclusive-outcome',
];

export interface OutcomeCountView {
  key: OutcomeClass;
  label: string;
  count: number;
  leak: boolean;
}

export interface CauseRowView {
  cause: FailureCause;
  label: string;
  count: number;
  sharePct: number | null;
  methodLabel: string | null;
}

export interface AxisRowView {
  axis: string;
  label: string;
  unit: string;
  ceilingText: string;
  applicabilityLabel: string;
  gradeLabel: string;
  source: string;
  samplesText: string;
  contradictionText: string | null;
}

export interface MachineView {
  modelId: string;
  name: string;
  gradeLabel: string;
  publishable: boolean;
  fullyFieldCalibrated: boolean;
  axes: AxisRowView[];
  notes: string[];
}

export interface PendingJobView {
  id: string;
  name: string;
  printerName: string;
  finishedAt: string;
  verdictText: string;
  status: string;
}

export interface YieldView {
  line: string;
  board: YieldScoreboard;
  harvest: YieldHarvest;
  outcomes: OutcomeCountView[];
  attribution: AttributionReport;
  causeRows: CauseRowView[];
  machines: MachineView[];
  pending: PendingJobView[];
  jobCount: number;
  /** Unattributed scraps split by what actually happened, so an interception
   *  that never reached the machine is not read as a ruined part. */
  unresolvedDefect: number;
  unresolvedAborted: number;
  decidableText: string;
  leakRateText: string;
  falseBlockRateText: string;
  /** The policy version the scoreboard is pinned to. */
  policyVersion: string;
  /** "另有 N 条属旧策略未计入" — null when nothing was excluded. */
  excludedByVersionText: string | null;
}

export function toFloorJobs(jobs: PrintJob[]): FloorJobSnapshot[] {
  return jobs.map((job) => ({
    id: job.id,
    printerId: job.printerId,
    status: job.status,
    startedAt: job.startedAt,
    actualEndAt: job.actualEndAt,
    verdict: job.verdict,
    quality: job.quality,
    scrapCauses: job.scrapCauses,
    attributionMethod: job.attributionMethod,
    measurements: job.measurements,
  }));
}

export function toFloorPrinters(printers: Printer[]): FloorPrinterSnapshot[] {
  return printers.map((printer) => ({ id: printer.id, modelId: printer.modelId ?? null }));
}

function pct(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

function axisRow(claim: AxisClaim, labels: YieldLabels, t: YieldSentences): AxisRowView {
  const ceil = claim.ceiling;
  return {
    axis: claim.axis,
    label: claim.label,
    unit: claim.unit,
    ceilingText: ceil === null ? '—' : `${ceil} ${claim.unit}`,
    applicabilityLabel: labels.applicability[claim.applicability],
    gradeLabel: labels.grade[claim.grade],
    source: claim.source,
    samplesText:
      claim.sampleCount === null
        ? t.samplesOne(claim.unitsContributing)
        : t.samplesMany(claim.sampleCount, claim.unitsContributing),
    contradictionText:
      claim.contradiction === null
        ? null
        : t.contradiction(claim.contradiction.observedMax, claim.contradiction.vendorCeiling),
  };
}

function machineView(
  modelId: string,
  observations: ReturnType<typeof calibrationFromYield>,
  labels: YieldLabels,
  t: YieldSentences,
): MachineView | null {
  // A model with no dossier has nothing honest to say; skip it rather than
  // conjure a claim out of a bare id.
  if (!getMachineModel(modelId)) return null;
  let claim: CapabilityClaim;
  try {
    claim = capabilityClaim(modelId, observations);
  } catch {
    return null;
  }
  return {
    modelId,
    name: getMachineModel(modelId)?.name ?? modelId,
    gradeLabel: labels.grade[claim.grade],
    publishable: claim.publishable,
    fullyFieldCalibrated: claim.fullyFieldCalibrated,
    axes: claim.axes.map((axis) => axisRow(axis, labels, t)),
    notes: claim.notes,
  };
}

export function buildYieldView(
  jobs: PrintJob[],
  printers: Printer[],
  lang: ContentLang = 'en',
): YieldView {
  const labels = yieldLabels(lang);
  const t = yieldSentences(lang);
  const floorJobs = toFloorJobs(jobs);
  const floorPrinters = toFloorPrinters(printers);
  // Pin to the policy we actually ship. Mixing versions is refused rather than
  // averaged; whichever records fall outside the pin are counted and shown.
  const { board, harvest } = floorScoreboard(floorJobs, floorPrinters, {
    policyVersion: VERDICT_POLICY_VERSION,
  });
  const attribution = floorAttribution(floorJobs, floorPrinters);
  const observations = calibrationFromYield(harvest.records);

  const printerNames = new Map(printers.map((p) => [p.id, p.name]));
  const pending: PendingJobView[] = jobs
    .filter((job) => job.status === 'completed' && (job.quality ?? 'pending') === 'pending')
    .map((job) => ({
      id: job.id,
      name: job.name,
      printerName: printerNames.get(job.printerId) ?? job.printerId,
      finishedAt: job.actualEndAt ?? job.startedAt,
      verdictText: job.verdict
        ? t.verdict(job.verdict.state, job.verdict.policyVersion)
        : t.noVerdict,
      status: job.status,
    }));

  const unresolvedRecords = harvest.records.filter(
    (record) =>
      (record.outcome === 'printed-defect' || record.outcome === 'aborted') &&
      (record.causes.length === 0 || record.causes.every((cause) => cause === 'unknown')),
  );
  const unresolvedDefect = unresolvedRecords.filter((record) => record.outcome === 'printed-defect').length;
  const unresolvedAborted = unresolvedRecords.filter((record) => record.outcome === 'aborted').length;

  const modelIds = Array.from(new Set(harvest.records.map((record) => record.modelId))).filter(
    (modelId) => modelId !== UNBOUND_MACHINE,
  );
  const machines = modelIds
    .map((modelId) => machineView(modelId, observations, labels, t))
    .filter((view): view is MachineView => view !== null);

  return {
    line: describeFloor(floorJobs, floorPrinters),
    board,
    harvest,
    outcomes: OUTCOME_ORDER.map((key) => ({
      key,
      label: labels.outcome[key],
      count: board.counts[key] ?? 0,
      leak: key === LEAK_CLASS,
    })),
    attribution,
    causeRows: attribution.causes.map((tally) => ({
      cause: tally.cause,
      label: labels.cause[tally.cause],
      count: tally.count,
      sharePct: tally.share === null ? null : Math.round(tally.share * 100),
      methodLabel: tally.strongestMethod === null ? null : labels.method[tally.strongestMethod],
    })),
    machines,
    pending,
    jobCount: jobs.length,
    unresolvedDefect,
    unresolvedAborted,
    decidableText: `${board.decidable} / ${board.total}`,
    leakRateText: pct(board.leakRate),
    falseBlockRateText: pct(board.falseBlockRate),
    policyVersion: VERDICT_POLICY_VERSION,
    excludedByVersionText: excludedNote(board.excludedByVersion, t),
  };
}

/**
 * "另有 N 条…未计入" — the sentence that keeps an empty denominator from
 * reading as a clean record book.
 *
 * Old policy and no policy are counted separately: one is a migration fact, the
 * other is a stamping hole, and a single blended number would hide the second.
 */
function excludedNote(ex: YieldVersionExclusion, t: YieldSentences): string | null {
  if (ex.count === 0) return null;
  const stamped = ex.count - ex.unstamped;
  const parts: string[] = [];
  if (stamped > 0) parts.push(t.exclusionStamped(stamped, ex.versions.join(' · ')));
  if (ex.unstamped > 0) parts.push(t.exclusionUnstamped(ex.unstamped));
  return t.exclusionPrefix(parts.join(t.separator));
}
