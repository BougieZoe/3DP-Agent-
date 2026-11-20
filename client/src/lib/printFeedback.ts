/**
 * Print-outcome telemetry — the seed of the confidence-gate data flywheel.
 *
 * When a user reports how a generated model actually printed, we pair that
 * outcome with the model's predicted confidence/verdict. Over time this
 * calibrates the rule-based confidence gate against real-world results
 * (the "did it print" blind spot). Stored locally for now; a hosted
 * analytics endpoint can replace localStorage later.
 *
 * One store: the versioned calibration entries below. The old unversioned
 * `3dp.printFeedback` list is migrated in and deleted. Generic bug/feature
 * feedback lives in `feedback.ts` — it is product feedback, not a print result.
 * Record-bound outcomes should call recordAnalysisOutcome instead of opening
 * another store; it tags the entry with source 'analysis-record'.
 */

import { stableHash } from './decisionRecord';
import type { AnalysisRecord, OutcomeStatus } from './analysisRecord';

export type PrintOutcome = 'ok' | 'issue' | 'fail';

export interface PrintStats {
  count: number;
  okRate: number | null;
  byVerdict: { pass: { total: number; ok: number }; warn: { total: number; ok: number }; fail: { total: number; ok: number } };
}

/** Aggregate every recorded print outcome — e.g. "12 prints, 75% OK". */
export function getPrintStats(): PrintStats {
  const entries = readCalibration();
  const bucket = (verdict: string) => {
    const list = entries.filter((e) => e.verdict === verdict);
    const ok = list.filter((e) => e.outcome === 'ok').length;
    return { total: list.length, ok };
  };
  return {
    count: entries.length,
    okRate: entries.length ? entries.filter((e) => e.outcome === 'ok').length / entries.length : null,
    byVerdict: { pass: bucket('PASS'), warn: bucket('WARN'), fail: bucket('FAIL') },
  };
}

// ── Versioned calibration (v2) ───────────────────────────────────────────────
//
// Legacy entries could only answer "did my verdicts hold up?". They could not
// answer "hold up under WHICH rules?". A threshold tweak silently mixed old
// and new verdicts in the same bucket. The v2 API keys every outcome by the
// exact rule set, threshold config and analysis input that produced it.
// Nothing here changes a threshold automatically — it only reports evidence.

export type CalibrationSource = 'cad-confidence' | 'report-gate' | 'analysis-record' | 'legacy';

export interface CalibrationContext {
  fileHash: string;
  rulesVersion: number;
  thresholdsHash: string;
  inputHash: string;
  /** Which score writer produced the verdict. Keeps independent gates apart. */
  source?: CalibrationSource;
  material?: string;
  machine?: string;
  slicerProfile?: string;
}

export interface CalibrationEntry extends CalibrationContext {
  /** Caller-supplied id for one physical print. Only this triggers dedupe. */
  printId?: string;
  confidence: number;
  verdict: string;
  outcome: PrintOutcome;
  timestamp: number;
}

const CALIBRATION_KEY = '3dp.printCalibration.v1';
const MAX_CALIBRATION_ENTRIES = 1000;
const MIN_BUCKET_SAMPLES = 5;
const MIN_TOTAL_SAMPLES = 10;

export type ConfidenceBand = 'low' | 'mid' | 'high';

export interface CalibrationBucket {
  band: ConfidenceBand;
  count: number;
  okCount: number;
  /** null until enough samples exist — never coerced to 0 or 1. */
  rate: number | null;
  state: 'unknown' | 'measured';
}

export interface CalibrationReport {
  schema: 'calibration/1';
  key: string;
  total: number;
  overallRate: number | null;
  state: 'unknown' | 'measured';
  buckets: CalibrationBucket[];
  /** Review hint only. The caller decides whether to change any threshold. */
  suggestion: string | null;
}

function contextOf(e: CalibrationEntry): CalibrationContext {
  return {
    fileHash: e.fileHash,
    rulesVersion: e.rulesVersion,
    thresholdsHash: e.thresholdsHash,
    inputHash: e.inputHash,
    source: e.source,
    material: e.material,
    machine: e.machine,
    slicerProfile: e.slicerProfile,
  };
}

export function calibrationKey(ctx: CalibrationContext): string {
  return stableHash(ctx);
}

function bandOf(confidence: number): ConfidenceBand {
  if (confidence < 0.4) return 'low';
  if (confidence < 0.7) return 'mid';
  return 'high';
}

const LEGACY_STORAGE_KEY = '3dp.printFeedback';
const LEGACY_CONTEXT: CalibrationContext = {
  fileHash: 'legacy-mesh-studio',
  rulesVersion: 0,
  thresholdsHash: 'unknown',
  inputHash: 'unknown',
  source: 'legacy',
};

function readCalibrationRaw(): CalibrationEntry[] {
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY);
    const parsed = raw ? (JSON.parse(raw) as CalibrationEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Move the old unversioned entries into the versioned store once. They keep a
 * sentinel context (rulesVersion 0) so they can never be mistaken for evidence
 * about a real rule set.
 */
function migrateLegacyPrintFeedback(): void {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    const legacy = Array.isArray(parsed) ? parsed : [];
    const migrated: CalibrationEntry[] = [];
    for (const item of legacy) {
      if (typeof item !== 'object' || item === null) continue;
      const e = item as Record<string, unknown>;
      const outcome = e.outcome;
      const verdict = e.verdict;
      const rawConfidence = Number(e.confidence);
      if (outcome !== 'ok' && outcome !== 'issue' && outcome !== 'fail') continue;
      if (typeof verdict !== 'string' || !Number.isFinite(rawConfidence)) continue;
      migrated.push({
        ...LEGACY_CONTEXT,
        confidence: rawConfidence > 1 ? rawConfidence / 100 : rawConfidence,
        verdict,
        outcome,
        timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now(),
      });
    }
    if (migrated.length > 0 && !writeCalibration([...readCalibrationRaw(), ...migrated])) {
      return;
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* storage unavailable — leave the legacy list untouched */
  }
}

function readCalibration(): CalibrationEntry[] {
  migrateLegacyPrintFeedback();
  return readCalibrationRaw();
}

function writeCalibration(entries: CalibrationEntry[]): boolean {
  try {
    localStorage.setItem(
      CALIBRATION_KEY,
      JSON.stringify(entries.slice(-MAX_CALIBRATION_ENTRIES)),
    );
    return true;
  } catch {
    /* storage unavailable — calibration is best-effort */
    return false;
  }
}

/**
 * Record one real print outcome. Repeated uploads stay distinct data points
 * unless the caller supplies the same `printId` twice (a corrected report).
 */
export function recordCalibrationOutcome(
  entry: Omit<CalibrationEntry, 'timestamp'>,
): CalibrationEntry {
  const full: CalibrationEntry = { ...entry, timestamp: Date.now() };
  const entries = readCalibration().filter(
    (e) => !(entry.printId && e.printId === entry.printId),
  );
  entries.push(full);
  writeCalibration(entries);
  return full;
}

const OUTCOME_BY_STATUS: Partial<Record<OutcomeStatus, PrintOutcome>> = {
  success: 'ok',
  partial: 'issue',
  failure: 'fail',
};

const VERDICT_BY_LIGHT: Record<string, string> = {
  green: 'PASS',
  yellow: 'WARN',
  red: 'FAIL',
};

function removeCalibrationPrint(printId: string): void {
  writeCalibration(readCalibration().filter((e) => e.printId !== printId));
}

/**
 * Bridge one canonical AnalysisRecord outcome into the calibration index.
 *
 * The record id is the print id, so editing the same report replaces its entry
 * instead of adding a duplicate. Setting the status back to not_tested/unknown
 * removes the entry rather than leaving a stale success. Returns null when no
 * calibration point was written.
 */
export function recordAnalysisOutcome(record: AnalysisRecord): CalibrationEntry | null {
  const outcome = OUTCOME_BY_STATUS[record.outcome.status];
  if (!outcome) {
    removeCalibrationPrint(record.id);
    return null;
  }

  const confidence =
    record.overallConfidence > 1 ? record.overallConfidence / 100 : record.overallConfidence;

  return recordCalibrationOutcome({
    fileHash: record.model.fileHash,
    rulesVersion: record.analyzer.rulesVersion,
    thresholdsHash: record.analyzer.thresholdsHash ?? 'unknown',
    inputHash:
      record.analyzer.inputHash ??
      stableHash({ fileHash: record.model.fileHash, geometry: record.geometry }),
    source: 'analysis-record',
    material: record.context.material ?? undefined,
    machine: record.context.printerId ?? undefined,
    slicerProfile: record.context.process ?? undefined,
    printId: record.id,
    confidence,
    verdict: VERDICT_BY_LIGHT[record.score.light] ?? 'UNKNOWN',
    outcome,
  });
}

/** Aggregate outcomes for one exact rule-set context, with unknown preserved. */
export function getCalibrationReport(ctx: CalibrationContext): CalibrationReport {
  const key = calibrationKey(ctx);
  const entries = readCalibration().filter(
    (e) => calibrationKey(contextOf(e)) === key,
  );

  const buckets: CalibrationBucket[] = (['low', 'mid', 'high'] as const).map((band) => {
    const list = entries.filter((e) => bandOf(e.confidence) === band);
    const okCount = list.filter((e) => e.outcome === 'ok').length;
    const measurable = list.length >= MIN_BUCKET_SAMPLES;
    return {
      band,
      count: list.length,
      okCount,
      rate: measurable ? okCount / list.length : null,
      state: measurable ? 'measured' : 'unknown',
    };
  });

  const measurable = entries.length >= MIN_TOTAL_SAMPLES;
  const okCount = entries.filter((e) => e.outcome === 'ok').length;
  const overallRate = measurable ? okCount / entries.length : null;

  let suggestion: string | null = null;
  if (overallRate !== null) {
    if (overallRate < 0.7) {
      suggestion = 'Reported success is below 70% for this rule set — review thresholds before trusting PASS verdicts.';
    } else if (overallRate > 0.9) {
      suggestion = 'Reported success is above 90% for this rule set — thresholds may be conservative.';
    }
  }

  return {
    schema: 'calibration/1',
    key,
    total: entries.length,
    overallRate,
    state: measurable ? 'measured' : 'unknown',
    buckets,
    suggestion,
  };
}

/** Remove calibration data for one exact rule-set context. */
export function clearCalibration(ctx: CalibrationContext): void {
  const key = calibrationKey(ctx);
  writeCalibration(
    readCalibration().filter((e) => calibrationKey(contextOf(e)) !== key),
  );
}
