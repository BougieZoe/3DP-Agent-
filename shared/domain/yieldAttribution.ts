/**
 * Yield attribution — the scoreboard the verdict layer never had.
 *
 * A verdict that is never checked against reality is an opinion. This file
 * closes that gap: every issued verdict gets paired with what actually happened
 * on the floor, so the product can answer "how often were we wrong" instead of
 * only "what did the rules say".
 *
 * Three rules are enforced here, each one because the naive version flatters us:
 *
 *  1. A job that was blocked and never attempted proves nothing. Counting it as
 *     a correct rejection is how a rule set scores 100% while learning nothing.
 *
 *  2. `false-pass` (said printable, part scrapped) and `false-block` (said
 *     blocked, part printed fine) are reported as separate rates, never averaged
 *     into a single accuracy number. They cost different money and they are
 *     fixed by different work.
 *
 *  3. Records from different policy versions never share a denominator. Change
 *     the thresholds and the historical hit rate stops describing the rule set
 *     you are shipping today.
 *
 * `unknown` is a legitimate cause. What is not legitimate is a scrap with no
 * recorded cause at all: it is counted in `unresolved`, out loud, every time.
 */

import {
  type CalibrationAggregate,
  type CalibrationAxis,
  type CalibrationMethod,
  type CalibrationObservation,
  aggregateCalibration,
} from './fieldCalibration';
import type { AxisUnit } from './evidence';

/** The three-state verdict issued by the policy layer before a job runs. */
export type VerdictState = 'pass' | 'blocked' | 'inconclusive';

/** What actually happened on the floor. */
export type JobOutcome = 'printed-ok' | 'printed-defect' | 'aborted' | 'not-attempted';

/** Where the scrap came from. Multi-cause is normal; `unknown` is honest. */
export type FailureCause =
  | 'material'
  | 'machine'
  | 'params'
  | 'model'
  | 'operator'
  | 'post-process'
  | 'design'
  | 'unknown';

export interface YieldMeasurement {
  axis: CalibrationAxis;
  unit: AxisUnit;
  value: number;
  /** Overrides the default acceptance rule (see `calibrationFromYield`). */
  accepted?: boolean;
}

export interface YieldRecord {
  id: string;
  modelId: string;
  unitId: string;
  /** ISO timestamp of the outcome, not of the verdict. */
  at: string;
  verdict: VerdictState;
  /**
   * Policy version that produced `verdict`. Mandatory: without it a hit rate
   * cannot be attributed to the rule set that is actually shipping.
   */
  policyVersion: string;
  outcome: JobOutcome;
  /** Empty only when nothing broke. A defect with no cause is `unresolved`. */
  causes: FailureCause[];
  /** How the cause was established. Reuses the calibration evidence scale. */
  method: CalibrationMethod;
  /** Optional measured values this job produced, fed back into calibration. */
  measurements?: YieldMeasurement[];
  note?: string;
}

/**
 * How one verdict/outcome pair is scored.
 *
 * - `true-pass`        said printable, printed fine
 * - `false-pass`       said printable, scrapped — the leak
 * - `unverified-block` said blocked, never attempted — proves nothing either way
 * - `false-block`      said blocked, printed fine anyway — the over-kill
 * - `override-failed`  said blocked, someone ran it anyway, it failed — the
 *                      refusal was right, and it is the only cheap evidence we get
 * - `unexercised`      inconclusive, never attempted — still an open question
 * - `inconclusive-outcome` inconclusive, but a part exists — the rules abstained
 *                      while the floor answered; useful for tightening, never
 *                      for scoring
 */
export type OutcomeClass =
  | 'true-pass'
  | 'false-pass'
  | 'unverified-block'
  | 'false-block'
  | 'override-failed'
  | 'unexercised'
  | 'inconclusive-outcome';

export function classify(record: YieldRecord): OutcomeClass {
  const failed = record.outcome === 'printed-defect' || record.outcome === 'aborted';
  if (record.verdict === 'pass') {
    return record.outcome === 'printed-ok' ? 'true-pass' : 'false-pass';
  }
  if (record.verdict === 'blocked') {
    if (record.outcome === 'not-attempted') return 'unverified-block';
    if (record.outcome === 'printed-ok') return 'false-block';
    return 'override-failed';
  }
  return record.outcome === 'not-attempted' ? 'unexercised' : 'inconclusive-outcome';
}

export interface YieldScope {
  modelId?: string;
  unitId?: string;
  /**
   * Pin the scoreboard to one policy version. Omit it and mixed records are
   * detected and refused rather than silently averaged. When it is set,
   * records from other versions are excluded **and counted** (see
   * `excludedByVersion`) — the exclusion is visible, not a quiet filter.
   */
  policyVersion?: string;
}

/** Records left out of a pinned scoreboard because their policy version differs. */
export interface YieldVersionExclusion {
  count: number;
  /** Versions the excluded records were judged under, sorted. Empty when count is 0. */
  versions: string[];
  /**
   * Excluded records carrying no version at all (older verdicts, or an engine
   * that forgot to stamp). Counted apart from `versions`: "stamped with an old
   * policy" and "never stamped" are different faults and must not print as one.
   */
  unstamped: number;
}

export interface YieldScoreboard {
  total: number;
  counts: Record<OutcomeClass, number>;
  /** Samples where a definite verdict met an executed job. The only denominator. */
  decidable: number;
  /**
   * false-pass / (true-pass + false-pass). How often "printable" was wrong.
   * null until there are >= 3 samples — a rate over two jobs is a rumour.
   */
  leakRate: number | null;
  /** false-block / (false-block + override-failed). How often "blocked" was wrong. */
  falseBlockRate: number | null;
  /** Scraps with no usable cause recorded. Reported, never hidden. */
  unresolvedScraps: number;
  /** Why the rates are null, when they are. */
  blockedBy: string | null;
  /**
   * Records dropped because the caller pinned a different policy version.
   * Reported, never silent: an empty denominator and a clean record book look
   * identical unless the excluded count is on the page.
   */
  excludedByVersion: YieldVersionExclusion;
  /** false-pass ids, newest first — the first thing anyone should read. */
  leaks: string[];
}

export function scoreYield(records: YieldRecord[], scope: YieldScope = {}): YieldScoreboard {
  const inScope = records.filter(
    (r) =>
      (scope.modelId === undefined || r.modelId === scope.modelId) &&
      (scope.unitId === undefined || r.unitId === scope.unitId),
  );

  // A pinned version filters — but the filtered-out records are counted first.
  // Without the count, "0 leaks" and "0 data" print the same.
  const dropped =
    scope.policyVersion === undefined ? [] : inScope.filter((r) => r.policyVersion !== scope.policyVersion);
  const scoped =
    scope.policyVersion === undefined ? inScope : inScope.filter((r) => r.policyVersion === scope.policyVersion);
  const stamped = dropped.filter((r) => typeof r.policyVersion === 'string' && r.policyVersion.length > 0);
  const excludedByVersion: YieldVersionExclusion = {
    count: dropped.length,
    versions: [...new Set(stamped.map((r) => r.policyVersion))].sort(),
    unstamped: dropped.length - stamped.length,
  };

  const counts: Record<OutcomeClass, number> = {
    'true-pass': 0,
    'false-pass': 0,
    'unverified-block': 0,
    'false-block': 0,
    'override-failed': 0,
    unexercised: 0,
    'inconclusive-outcome': 0,
  };
  for (const r of scoped) counts[classify(r)] += 1;

  const decidable = counts['true-pass'] + counts['false-pass'] + counts['false-block'] + counts['override-failed'];

  let blockedBy: string | null = null;
  // Only stamped records name a policy. An unstamped record has no version to
  // report, so it must not inflate the count nor print an empty "…, )" entry.
  const versions = new Set(
    scoped.map((r) => r.policyVersion).filter((v): v is string => typeof v === 'string' && v.length > 0),
  );
  if (scope.policyVersion !== undefined) {
    // Caller pinned a version; nothing to referee.
  } else if (versions.size > 1) {
    blockedBy = `records span ${versions.size} policy versions (${[...versions].sort().join(', ')}) — pin one before quoting a rate`;
  }

  const passSide = counts['true-pass'] + counts['false-pass'];
  const blockSide = counts['false-block'] + counts['override-failed'];

  let leakRate: number | null = null;
  let falseBlockRate: number | null = null;
  if (blockedBy === null) {
    if (passSide >= 3) leakRate = round3(counts['false-pass'] / passSide);
    else blockedBy = `only ${passSide} executed pass-verdict job(s); need >= 3 before quoting a leak rate`;
  }
  if (blockedBy === null && blockSide >= 3) {
    falseBlockRate = round3(counts['false-block'] / blockSide);
  }

  const leaks = scoped
    .filter((r) => classify(r) === 'false-pass')
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map((r) => r.id);

  return {
    total: scoped.length,
    counts,
    decidable,
    leakRate,
    falseBlockRate,
    unresolvedScraps: unresolved(scoped).length,
    blockedBy,
    excludedByVersion,
    leaks,
  };
}

// ---------------------------------------------------------------------------
// Attribution — why the scrap happened, and whether we can prove it
// ---------------------------------------------------------------------------

export interface CauseTally {
  cause: FailureCause;
  count: number;
  /** count / scraps. One scrap may carry several causes, so these need not sum to 1. */
  share: number | null;
  /** Strongest evidence method behind this tally, by calibration weight. */
  strongestMethod: CalibrationMethod | null;
}

export interface AttributionReport {
  modelId: string | null;
  /** Jobs that produced a bad part or an aborted run. */
  scraps: number;
  /** Scraps with no cause, or with nothing but `unknown`. */
  unresolved: number;
  causes: CauseTally[];
  /** True only when every scrap carries a non-unknown cause. */
  attributed: boolean;
}

const METHOD_WEIGHT: Record<CalibrationMethod, number> = {
  thermocouple: 3,
  'part-measurement': 2,
  'slicer-log': 1,
  'operator-note': 0,
};

export function attributeScraps(records: YieldRecord[], scope: YieldScope = {}): AttributionReport {
  const scoped = records.filter(
    (r) => scope.modelId === undefined || r.modelId === scope.modelId,
  );
  const scraps = scoped.filter(isScrap);

  const byCause = new Map<FailureCause, { count: number; strongest: CalibrationMethod | null }>();
  for (const r of scraps) {
    for (const cause of uniqueCauses(r.causes)) {
      const row = byCause.get(cause) ?? { count: 0, strongest: null };
      row.count += 1;
      if (row.strongest === null || METHOD_WEIGHT[r.method] > METHOD_WEIGHT[row.strongest]) {
        row.strongest = r.method;
      }
      byCause.set(cause, row);
    }
  }

  const causes: CauseTally[] = [...byCause.entries()]
    .map(([cause, row]) => ({
      cause,
      count: row.count,
      share: scraps.length > 0 ? round3(row.count / scraps.length) : null,
      strongestMethod: row.strongest,
    }))
    // Unknown last, everything else by weight of evidence — the reader is
    // looking for the cause they can act on.
    .sort((a, b) => (a.cause === 'unknown' ? 1 : b.cause === 'unknown' ? -1 : b.count - a.count));

  const unresolvedCount = unresolved(scraps).length;
  return {
    modelId: scope.modelId ?? null,
    scraps: scraps.length,
    unresolved: unresolvedCount,
    causes,
    attributed: scraps.length > 0 && unresolvedCount === 0,
  };
}

// ---------------------------------------------------------------------------
// Feedback — turning outcomes into calibration observations
// ---------------------------------------------------------------------------

/**
 * Project job measurements onto the calibration scale.
 *
 * Default acceptance: a job that produced a part yields a usable reading; an
 * aborted run does not, because the machine never reached the state being
 * measured. The record is kept (see `accepted: false`) so the gap stays visible.
 */
export function calibrationFromYield(records: YieldRecord[]): CalibrationObservation[] {
  const out: CalibrationObservation[] = [];
  for (const r of records) {
    for (const m of r.measurements ?? []) {
      out.push({
        id: `${r.id}#${m.axis}`,
        modelId: r.modelId,
        unitId: r.unitId,
        axis: m.axis,
        unit: m.unit,
        value: m.value,
        at: r.at,
        method: r.method,
        accepted: m.accepted ?? r.outcome !== 'aborted',
      });
    }
  }
  return out;
}

/**
 * Whether the outcomes earned the right to publish a field-calibrated bound.
 * The grading rules deliberately live in `calibration.ts` — one place decides
 * what counts as a truth, and this function only feeds it.
 */
export function promotionGate(
  records: YieldRecord[],
  query: { modelId: string; axis: CalibrationAxis },
): CalibrationAggregate {
  return aggregateCalibration(calibrationFromYield(records), query);
}

/** One-line summary for reports and CLI output. */
export function describeScoreboard(board: YieldScoreboard): string {
  const leak = board.leakRate === null ? 'leak n/a' : `leak ${(board.leakRate * 100).toFixed(1)}%`;
  const block =
    board.falseBlockRate === null
      ? 'false-block n/a'
      : `false-block ${(board.falseBlockRate * 100).toFixed(1)}%`;
  const why = board.blockedBy ? ` (${board.blockedBy})` : '';
  const ex = board.excludedByVersion;
  const stampedCount = ex.count - ex.unstamped;
  const excludedParts: string[] = [];
  if (stampedCount > 0) excludedParts.push(`${stampedCount} excluded on ${ex.versions.join(', ')}`);
  if (ex.unstamped > 0) excludedParts.push(`${ex.unstamped} excluded (no policy version)`);
  const excluded = excludedParts.length > 0 ? `, ${excludedParts.join(', ')}` : '';
  return `${board.decidable}/${board.total} decidable, ${leak}, ${block}, ${board.unresolvedScraps} unresolved${excluded}${why}`;
}

// ---------------------------------------------------------------------------

function isScrap(r: YieldRecord): boolean {
  return r.outcome === 'printed-defect' || r.outcome === 'aborted';
}

function unresolved(records: YieldRecord[]): YieldRecord[] {
  return records.filter((r) => {
    if (!isScrap(r)) return false;
    const causes = uniqueCauses(r.causes);
    return causes.length === 0 || (causes.length === 1 && causes[0] === 'unknown');
  });
}

function uniqueCauses(causes: FailureCause[]): FailureCause[] {
  return [...new Set(causes)];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
