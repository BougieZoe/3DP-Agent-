/**
 * View assembly for the floor yield panel.
 *
 * Kept free of React so it can be exercised directly (tsx) in this environment,
 * where vitest's rollup native binding is unusable. Everything here is a pure
 * projection of the domain modules: no rates are invented, no missing cause is
 * filled in, and "finished" is never allowed to read as "good".
 */
import type { PrintJob, Printer } from '@/lib/printFarm';
import type { CalibrationMethod } from '@shared/domain/calibration';
import type { EvidenceGrade } from '@shared/domain/evidence';
import { getMachineModel } from '@shared/domain/machine';
import {
  type AttributionReport,
  type FailureCause,
  type OutcomeClass,
  type YieldScoreboard,
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

export const OUTCOME_LABELS: Record<OutcomeClass, string> = {
  'true-pass': '判定通过且合格',
  'false-pass': '判定通过却报废',
  'unverified-block': '被拦截未上机',
  'false-block': '拦截但本可成功',
  'override-failed': '强行放行后报废',
  unexercised: '无判定记录',
  'inconclusive-outcome': '判定不确定',
};

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

export const CAUSE_LABELS: Record<FailureCause, string> = {
  material: '材料',
  machine: '机器',
  params: '工艺参数',
  model: '模型',
  operator: '操作',
  'post-process': '后处理',
  design: '设计',
  unknown: '未查明',
};

export const METHOD_LABELS: Record<CalibrationMethod, string> = {
  thermocouple: '热电偶实测',
  'part-measurement': '零件实测',
  'slicer-log': '切片日志',
  'operator-note': '操作员记录',
};

export const GRADE_LABELS: Record<EvidenceGrade, string> = {
  unverified: '未验证',
  'vendor-sheet': '厂商标称',
  'two-source': '双来源',
  'field-calibrated': '现场标定',
};

export const APPLICABILITY_LABELS: Record<AxisClaim['applicability'], string> = {
  stated: '已标称',
  absent: '无此能力',
  unknown: '未知',
};

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

function axisRow(claim: AxisClaim): AxisRowView {
  const ceil = claim.ceiling;
  return {
    axis: claim.axis,
    label: claim.label,
    unit: claim.unit,
    ceilingText: ceil === null ? '—' : `${ceil} ${claim.unit}`,
    applicabilityLabel: APPLICABILITY_LABELS[claim.applicability],
    gradeLabel: GRADE_LABELS[claim.grade],
    source: claim.source,
    samplesText:
      claim.sampleCount === null
        ? `样本 ${claim.unitsContributing} 台`
        : `样本 ${claim.sampleCount} · ${claim.unitsContributing} 台`,
    contradictionText:
      claim.contradiction === null
        ? null
        : `现场读数 ${claim.contradiction.observedMax} 已超厂商上限 ${claim.contradiction.vendorCeiling}`,
  };
}

function machineView(modelId: string, observations: ReturnType<typeof calibrationFromYield>): MachineView | null {
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
    gradeLabel: GRADE_LABELS[claim.grade],
    publishable: claim.publishable,
    fullyFieldCalibrated: claim.fullyFieldCalibrated,
    axes: claim.axes.map(axisRow),
    notes: claim.notes,
  };
}

export function buildYieldView(jobs: PrintJob[], printers: Printer[]): YieldView {
  const floorJobs = toFloorJobs(jobs);
  const floorPrinters = toFloorPrinters(printers);
  const { board, harvest } = floorScoreboard(floorJobs, floorPrinters);
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
      verdictText: job.verdict ? `判定 ${job.verdict.state} · 策略 ${job.verdict.policyVersion}` : '无判定记录',
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
    .map((modelId) => machineView(modelId, observations))
    .filter((view): view is MachineView => view !== null);

  return {
    line: describeFloor(floorJobs, floorPrinters),
    board,
    harvest,
    outcomes: OUTCOME_ORDER.map((key) => ({
      key,
      label: OUTCOME_LABELS[key],
      count: board.counts[key] ?? 0,
      leak: key === LEAK_CLASS,
    })),
    attribution,
    causeRows: attribution.causes.map((tally) => ({
      cause: tally.cause,
      label: CAUSE_LABELS[tally.cause],
      count: tally.count,
      sharePct: tally.share === null ? null : Math.round(tally.share * 100),
      methodLabel: tally.strongestMethod === null ? null : METHOD_LABELS[tally.strongestMethod],
    })),
    machines,
    pending,
    jobCount: jobs.length,
    unresolvedDefect,
    unresolvedAborted,
    decidableText: `${board.decidable} / ${board.total}`,
    leakRateText: pct(board.leakRate),
    falseBlockRateText: pct(board.falseBlockRate),
  };
}
