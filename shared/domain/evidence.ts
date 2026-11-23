/**
 * Evidence primitives — every quantitative claim carries its own provenance.
 *
 * Doctrine: a number without a source and an evidence grade is a bug, not a
 * default. `unverified` is a first-class value here — it is never silently
 * promoted to a fact, and it never silently kills a decision either.
 *
 * Why this file exists: the shopfloor keeps losing arguments because a vendor
 * sheet number and a measured number look identical once they are both `250`.
 * Wrapping both in `AxisBound` makes the difference impossible to erase by
 * accident.
 */

export type EvidenceGrade =
  /** A single vendor claim. Real, but not independently reproduced. */
  | 'vendor-sheet'
  /** Two or more independent sources agree on the number. */
  | 'two-source'
  /** Measured on our own machines, with a sample count we can point at. */
  | 'field-calibrated'
  /** We do not know. Legitimate, common, and never allowed to gate silently. */
  | 'unverified';

export type AxisUnit = 'mm' | '°C' | 'mm/s' | 'kg/h';

export interface AxisBound {
  readonly unit: AxisUnit;
  /** Lower bound of what was observed or specified. null = not established. */
  readonly min: number | null;
  /** Upper bound. For a capability axis, this is the ceiling that matters. */
  readonly max: number | null;
  readonly grade: EvidenceGrade;
  /** Mandatory. An empty source is a bug; call sites must say where it came from. */
  readonly source: string;
  /** Required for field-calibrated bounds; null otherwise. */
  readonly sampleCount: number | null;
}

export interface BoundInput {
  unit: AxisUnit;
  min?: number | null;
  max?: number | null;
  grade: EvidenceGrade;
  source: string;
  sampleCount?: number | null;
}

/** Build a bound. Throws on the two states that would make it meaningless. */
export function bound(input: BoundInput): AxisBound {
  const { unit, grade, source } = input;
  const min = input.min ?? null;
  const max = input.max ?? null;
  if (!source || source.trim() === '') {
    throw new Error(`bound(${unit}): source is mandatory — an unsourced number is a bug`);
  }
  if (min === null && max === null) {
    throw new Error(`bound(${unit}): at least one of min/max must be present; use unverified() otherwise`);
  }
  if (min !== null && max !== null && min > max) {
    throw new Error(`bound(${unit}): min ${min} > max ${max}`);
  }
  if (grade === 'field-calibrated' && (input.sampleCount ?? 0) <= 0) {
    throw new Error(`bound(${unit}): field-calibrated requires sampleCount > 0`);
  }
  return {
    unit,
    min,
    max,
    grade,
    source,
    sampleCount: grade === 'field-calibrated' ? (input.sampleCount ?? null) : null,
  };
}

/**
 * An explicitly unknown bound. Carries the reason we do not know, so the report
 * can explain the gap instead of printing a plausible lie.
 */
export function unverified(unit: AxisUnit, why: string): AxisBound {
  return { unit, min: null, max: null, grade: 'unverified', source: why, sampleCount: null };
}

/** True when the bound has at least one real number attached. */
export function isQuantified(b: AxisBound): boolean {
  return b.min !== null || b.max !== null;
}

/** True when we may act on it as a known ceiling. */
export function isActionable(b: AxisBound): boolean {
  return isQuantified(b) && b.grade !== 'unverified';
}

export type CoverageVerdict =
  /** Capability provably meets the requirement. */
  | 'covered'
  /** Capability provably falls short. */
  | 'short'
  /** One side is unknown — we refuse to answer either way. */
  | 'unknown';

/**
 * Does `capability` meet or exceed `requirement` on this axis?
 *
 * `unknown` is deliberate: when the machine ceiling is unverified we must not
 * return `short`, because that would launder ignorance into a rejection.
 */
export function covers(requirement: AxisBound, capability: AxisBound): CoverageVerdict {
  if (!isActionable(requirement) || !isActionable(capability)) return 'unknown';
  const need = requirement.max ?? requirement.min;
  const have = capability.max ?? capability.min;
  if (need === null || have === null) return 'unknown';
  return have >= need ? 'covered' : 'short';
}

/** Signed headroom in axis units; null when either side is unknowable. */
export function headroom(requirement: AxisBound, capability: AxisBound): number | null {
  if (!isActionable(requirement) || !isActionable(capability)) return null;
  const need = requirement.max ?? requirement.min;
  const have = capability.max ?? capability.min;
  if (need === null || have === null) return null;
  return round1(have - need);
}

/**
 * Narrow a bound with field observations. Only ever tightens — a calibration
 * that would widen the range is rejected, because widening is what happens when
 * someone "fixes" a number instead of measuring it.
 *
 * The grade is upgraded to `field-calibrated` only when the observed window is
 * actually inside the prior bound; an observation outside the prior bound is a
 * contradiction that must surface as an error, not as a quiet new range.
 */
export function narrow(
  base: AxisBound,
  observed: { min: number; max: number; sampleCount: number; source: string },
): AxisBound {
  if (observed.sampleCount <= 0) {
    throw new Error('narrow(): sampleCount must be > 0 — unmeasured narrowing is just guessing');
  }
  if (observed.min > observed.max) {
    throw new Error(`narrow(): observed min ${observed.min} > max ${observed.max}`);
  }
  if (isQuantified(base)) {
    const baseMin = base.min ?? -Infinity;
    const baseMax = base.max ?? Infinity;
    if (observed.min < baseMin - 0.001 || observed.max > baseMax + 0.001) {
      throw new Error(
        `narrow(): observed [${observed.min}, ${observed.max}] escapes prior [${base.min}, ${base.max}] — resolve the contradiction instead of overwriting it`,
      );
    }
  }
  return {
    unit: base.unit,
    min: observed.min,
    max: observed.max,
    grade: 'field-calibrated',
    source: observed.source,
    sampleCount: observed.sampleCount,
  };
}

/** Human-readable one-liner used by reports and CLI output. */
export function describe(b: AxisBound): string {
  const range =
    b.min !== null && b.max !== null
      ? `${b.min}–${b.max}`
      : b.max !== null
        ? `≤${b.max}`
        : b.min !== null
          ? `≥${b.min}`
          : 'unknown';
  return `${range}${b.unit} [${b.grade}${b.sampleCount ? `, n=${b.sampleCount}` : ''}] ${b.source}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
