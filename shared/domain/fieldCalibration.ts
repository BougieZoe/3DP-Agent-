/**
 * Field calibration — closing the loop between what a spec sheet claims and
 * what the machines on our own floor actually do.
 *
 * Two rules are enforced in code here, because both are easy to violate by
 * accident and expensive to violate in production:
 *
 *  1. A single machine's readings may not rewrite a model-level envelope. One
 *     offset unit is a deviation; three units agreeing is a spec correction.
 *     `aggregate()` exposes `unitsContributing` for exactly this judgement.
 *
 *  2. Calibration only ever narrows. An observation that falls outside the
 *     prior bound is a contradiction to resolve, not a new range to adopt.
 *     `tryNarrow()` returns the conflict instead of throwing so a batch import
 *     can report every conflict at once.
 *
 * This is the layer that turns "the vendor says 300 °C" into "our three units
 * hold 287–294 °C over 41 jobs".
 */

import {
  type AxisBound,
  type AxisUnit,
  bound,
  isQuantified,
  narrow,
} from './evidence';

export type CalibrationAxis =
  | 'nozzle-temp'
  | 'chamber-temp'
  | 'bed-temp'
  | 'build-x'
  | 'build-y'
  | 'build-z'
  | 'flow'
  | 'speed';

export type CalibrationMethod =
  /** External thermocouple / thermal camera, the strongest evidence. */
  | 'thermocouple'
  /** Measured on the produced part (CMM, calipers). */
  | 'part-measurement'
  /** Parsed from slicer / firmware logs. */
  | 'slicer-log'
  /** Operator typed it in. Weakest; still worth recording, never worth trusting alone. */
  | 'operator-note';

export interface CalibrationObservation {
  id: string;
  /** Must be a MACHINE_MODELS id — observations about unknown models are unroutable. */
  modelId: string;
  /** Which physical unit produced the reading. Cross-unit agreement is the signal. */
  unitId: string;
  axis: CalibrationAxis;
  unit: AxisUnit;
  value: number;
  /** ISO timestamp of the measurement. */
  at: string;
  method: CalibrationMethod;
  /**
   * False when the reading is known-bad (thermocouple fell off, part scrapped
   * for unrelated reasons). Kept rather than deleted so the record stays honest.
   */
  accepted: boolean;
}

export interface CalibrationAggregate {
  modelId: string;
  axis: CalibrationAxis;
  unit: AxisUnit;
  samples: number;
  acceptedSamples: number;
  /** Distinct physical machines that contributed. < 2 means "not a model truth yet". */
  unitsContributing: number;
  min: number | null;
  max: number | null;
  p50: number | null;
  /** 95th percentile — the number to design the envelope against. */
  p95: number | null;
  /** p95 − p50. Large spread means units disagree; investigate before narrowing. */
  dispersion: number | null;
  /** Evidence grade this aggregate would earn on its own. */
  grade: 'field-calibrated' | 'vendor-sheet' | 'unverified';
  /** Human-readable reason it is not yet field-calibrated, when it is not. */
  blockedBy: string | null;
}

const METHOD_WEIGHT: Record<CalibrationMethod, number> = {
  thermocouple: 3,
  'part-measurement': 2,
  'slicer-log': 1,
  'operator-note': 0,
};

export function aggregateCalibration(
  observations: CalibrationObservation[],
  query: { modelId: string; axis: CalibrationAxis },
): CalibrationAggregate {
  const rows = observations.filter(
    (o) => o.modelId === query.modelId && o.axis === query.axis && o.accepted,
  );
  const units = new Set(rows.map((o) => o.unitId));
  const values = rows.map((o) => o.value).sort((a, b) => a - b);
  const unit = rows[0]?.unit ?? observations.find((o) => o.axis === query.axis)?.unit ?? '°C';

  const unitsContributing = units.size;
  const strongMethod = rows.some((o) => METHOD_WEIGHT[o.method] >= 2);

  let grade: CalibrationAggregate['grade'] = 'unverified';
  let blockedBy: string | null = null;

  if (values.length === 0) {
    blockedBy = 'no accepted observations for this model/axis';
  } else if (unitsContributing < 2) {
    blockedBy = `only ${unitsContributing} unit contributed — a single machine is a deviation, not a model truth`;
  } else if (!strongMethod) {
    blockedBy = 'only operator notes / slicer logs; needs at least one thermocouple or part measurement';
  } else if (values.length < 3) {
    blockedBy = `only ${values.length} accepted samples; need >= 3 before publishing a bound`;
  } else {
    grade = 'field-calibrated';
  }

  return {
    modelId: query.modelId,
    axis: query.axis,
    unit,
    samples: observations.filter((o) => o.modelId === query.modelId && o.axis === query.axis).length,
    acceptedSamples: values.length,
    unitsContributing,
    min: values.length ? values[0] : null,
    max: values.length ? values[values.length - 1] : null,
    p50: values.length ? percentile(values, 0.5) : null,
    p95: values.length ? percentile(values, 0.95) : null,
    dispersion:
      values.length && percentile(values, 0.95) !== null && percentile(values, 0.5) !== null
        ? round1(percentile(values, 0.95)! - percentile(values, 0.5)!)
        : null,
    grade,
    blockedBy,
  };
}

export type NarrowOutcome =
  | { ok: true; bound: AxisBound }
  | { ok: false; reason: string; prior: AxisBound; observed: { min: number; max: number } };

/**
 * Apply an aggregate to a prior bound. Never throws — callers batch-report.
 *
 * Note the deliberate asymmetry: a failed narrowing leaves the prior bound
 * untouched. There is no code path that widens an envelope from field data.
 */
export function tryNarrow(prior: AxisBound, agg: CalibrationAggregate): NarrowOutcome {
  if (agg.grade !== 'field-calibrated') {
    return {
      ok: false,
      reason: agg.blockedBy ?? 'aggregate is not field-calibrated',
      prior,
      observed: { min: agg.min ?? NaN, max: agg.max ?? NaN },
    };
  }
  if (agg.min === null || agg.max === null) {
    return { ok: false, reason: 'aggregate has no numeric range', prior, observed: { min: NaN, max: NaN } };
  }
  try {
    return {
      ok: true,
      bound: narrow(prior, {
        min: agg.min,
        max: agg.max,
        sampleCount: agg.acceptedSamples,
        source: `field calibration: ${agg.acceptedSamples} samples across ${agg.unitsContributing} units, p50 ${agg.p50}${agg.unit}`,
      }),
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      prior,
      observed: { min: agg.min, max: agg.max },
    };
  }
}

// ---------------------------------------------------------------------------
// Capacity — the axis that software alone can move
// ---------------------------------------------------------------------------

export interface CapacityObservation {
  modelId: string;
  unitId: string;
  /** Hours the machine was nominally available in the window. */
  plannedHours: number;
  /** Hours actually spent producing good parts. */
  productiveHours: number;
  goodParts: number;
  totalParts: number;
  at: string;
}

export interface CapacityReport {
  modelId: string;
  units: number;
  plannedHours: number;
  productiveHours: number;
  /** productive / planned. The share of paid-for machine time that sells nothing. */
  utilisation: number | null;
  /** goodParts / totalParts. */
  yieldRate: number | null;
  partsPerPlannedHour: number | null;
  /** What the fleet would produce if utilisation and yield both hit 1.0. */
  theoreticalParts: number | null;
  /** The gap software can attack without touching a single bolt. */
  softwareAddressableParts: number | null;
}

export function capacityReport(rows: CapacityObservation[], modelId: string): CapacityReport {
  const scoped = rows.filter((r) => r.modelId === modelId);
  const plannedHours = sum(scoped.map((r) => r.plannedHours));
  const productiveHours = sum(scoped.map((r) => r.productiveHours));
  const goodParts = sum(scoped.map((r) => r.goodParts));
  const totalParts = sum(scoped.map((r) => r.totalParts));
  const units = new Set(scoped.map((r) => r.unitId)).size;

  const yieldRate = totalParts > 0 ? goodParts / totalParts : null;
  const partsPerPlannedHour = plannedHours > 0 ? goodParts / plannedHours : null;
  // Extrapolate the *productive-hour* rate across the whole planned window. This
  // is the honest ceiling: it assumes the machine already proves it can sustain
  // that rate, and only reclaims hours that currently sell nothing.
  const goodPerProductiveHour = productiveHours > 0 ? goodParts / productiveHours : null;
  const theoreticalParts =
    goodPerProductiveHour !== null ? round1(goodPerProductiveHour * plannedHours) : null;

  return {
    modelId,
    units,
    plannedHours: round1(plannedHours),
    productiveHours: round1(productiveHours),
    utilisation: plannedHours > 0 ? round3(productiveHours / plannedHours) : null,
    yieldRate: yieldRate === null ? null : round3(yieldRate),
    partsPerPlannedHour: partsPerPlannedHour === null ? null : round3(partsPerPlannedHour),
    theoreticalParts,
    softwareAddressableParts:
      theoreticalParts !== null && goodParts > 0 ? round1(theoreticalParts - goodParts) : null,
  };
}

// ---------------------------------------------------------------------------

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return round1(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Convenience: is this aggregate allowed to overwrite the spec layer? */
export function canOverrideSpec(agg: CalibrationAggregate): boolean {
  return agg.grade === 'field-calibrated' && isQuantified({
    unit: agg.unit,
    min: agg.min,
    max: agg.max,
    grade: agg.grade,
    source: 'aggregate',
    sampleCount: agg.acceptedSamples,
  });
}

/** Build the bound an aggregate would publish, for previewing a spec change. */
export function publishBound(agg: CalibrationAggregate): AxisBound | null {
  if (!canOverrideSpec(agg) || agg.min === null || agg.max === null) return null;
  return bound({
    unit: agg.unit,
    min: agg.min,
    max: agg.max,
    grade: 'field-calibrated',
    source: `field calibration over ${agg.acceptedSamples} samples / ${agg.unitsContributing} units`,
    sampleCount: agg.acceptedSamples,
  });
}
