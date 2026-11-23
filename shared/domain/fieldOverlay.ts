/**
 * Field overlay — the capability table we are willing to *publish*, built by
 * folding the floor's own measurements back into the vendor sheet.
 *
 * Three rules, and all three exist because the opposite behaviour is what makes
 * a capability sheet worthless:
 *
 *  1. A field reading may narrow a vendor ceiling. It may never raise one. When
 *     readings land above the vendor number, that is a contradiction to resolve
 *     (`contradiction`), not a discovery to advertise — a "we got 340 °C out of a
 *     300 °C hotend" line is far more often a dead thermocouple than a hero unit.
 *
 *  2. A field reading **may** establish a ceiling where the vendor published
 *     none. That is the whole point for pellet machines, whose melt-zone spec is
 *     not in any document we have; without this, half the floor stays permanently
 *     'unknown'. It is graded `field-calibrated`, never `vendor-sheet` — we do not
 *     retroactively invent vendor backing.
 *
 *  3. The overall grade is the weakest contributing axis, not the average. One
 *     calibrated nozzle does not make a calibrated machine.
 */

import {
  type AxisBound,
  type AxisUnit,
  type EvidenceGrade,
  bound,
  isQuantified,
} from './evidence';
import {
  type CalibrationAggregate,
  type CalibrationAxis,
  type CalibrationObservation,
  aggregateCalibration,
  canOverrideSpec,
  publishBound,
} from './calibration';
import { getMachineThermalCapability } from './machine';
import { type MachineThermalCapability, type ThermalVerdict, assessThermal } from './thermal';

/** The three thermal axes a capability sheet actually claims. */
const THERMAL_AXES: Array<{
  axis: CalibrationAxis;
  label: string;
  field: 'nozzleMaxC' | 'chamberMaxC' | 'bedMaxC';
}> = [
  { axis: 'nozzle-temp', label: 'nozzle', field: 'nozzleMaxC' },
  { axis: 'chamber-temp', label: 'chamber', field: 'chamberMaxC' },
  { axis: 'bed-temp', label: 'bed', field: 'bedMaxC' },
];

/**
 * Why an axis has no number:
 *  - `stated`  — there is a number, and it carries a grade.
 *  - `absent`  — the machine has no such axis at all (open frame, SLA). Not a gap.
 *  - `unknown` — the axis exists but nobody knows its ceiling. A gap.
 */
export type AxisApplicability = 'stated' | 'absent' | 'unknown';

export interface AxisClaim {
  axis: CalibrationAxis;
  label: string;
  unit: AxisUnit;
  /** The ceiling we publish. null when nothing is known. */
  ceiling: number | null;
  grade: EvidenceGrade;
  source: string;
  /** Readings behind a field-calibrated ceiling. */
  sampleCount: number | null;
  /** Distinct machines that contributed — the basis for calling it a model truth. */
  unitsContributing: number;
  applicability: AxisApplicability;
  /** Field data exists but cannot be published yet: why, verbatim. */
  blockedBy: string | null;
  /** Field readings above the vendor ceiling. Resolve before publishing anything. */
  contradiction: { vendorCeiling: number; observedMax: number } | null;
}

export interface CapabilityClaim {
  modelId: string;
  axes: AxisClaim[];
  /** Weakest contributing axis. `absent` axes are excluded — they are not gaps. */
  grade: EvidenceGrade;
  /** True when at least one axis carries a publishable number. */
  publishable: boolean;
  /** True when every stated axis is backed by field calibration. */
  fullyFieldCalibrated: boolean;
  /** Things a human has to resolve before this sheet goes to a customer. */
  notes: string[];
}

const GRADE_RANK: Record<EvidenceGrade, number> = {
  unverified: 0,
  'vendor-sheet': 1,
  'two-source': 2,
  'field-calibrated': 3,
};

function ceilingOf(b: AxisBound): number | null {
  return b.max ?? b.min;
}

function applicabilityOf(b: AxisBound, axis: CalibrationAxis, activeChamber: boolean): AxisApplicability {
  if (isQuantified(b)) return 'stated';
  // An open-frame machine has no chamber. That is a category difference, not an
  // evidence gap, and lumping the two together drags every open-frame model down
  // to 'unverified' for lacking something it never had.
  if (axis === 'chamber-temp' && !activeChamber) return 'absent';
  return 'unknown';
}

function claimAxis(params: {
  axis: CalibrationAxis;
  label: string;
  unit: AxisUnit;
  vendor: AxisBound;
  activeChamber: boolean;
  agg: CalibrationAggregate | null;
}): AxisClaim {
  const { axis, label, vendor, activeChamber, agg } = params;
  const vendorCeiling = ceilingOf(vendor);

  const claim: AxisClaim = {
    axis,
    label,
    unit: vendor.unit,
    ceiling: vendorCeiling,
    grade: vendor.grade,
    source: vendor.source,
    sampleCount: vendor.sampleCount,
    unitsContributing: 0,
    applicability: applicabilityOf(vendor, axis, activeChamber),
    blockedBy: null,
    contradiction: null,
  };

  if (agg === null) {
    claim.blockedBy = 'no field readings for this axis yet';
    return claim;
  }

  claim.unitsContributing = agg.unitsContributing;

  if (!canOverrideSpec(agg)) {
    claim.blockedBy =
      agg.blockedBy ??
      `field aggregate not publishable yet (${agg.acceptedSamples} of ${agg.samples} readings accepted, ${agg.unitsContributing} unit(s))`;
    return claim;
  }

  const published = publishBound(agg);
  const fieldCeiling = published === null ? null : ceilingOf(published);
  if (published === null || fieldCeiling === null) {
    claim.blockedBy = 'field aggregate produced no publishable bound';
    return claim;
  }

  if (vendorCeiling !== null && fieldCeiling > vendorCeiling) {
    // Readings above spec. Do not publish the higher number and do not throw the
    // readings away — flag the conflict and keep the vendor ceiling standing.
    claim.contradiction = { vendorCeiling, observedMax: agg.max ?? fieldCeiling };
    claim.blockedBy = `field readings reach ${agg.max ?? fieldCeiling} ${agg.unit}, above the vendor ceiling of ${vendorCeiling} ${agg.unit} — resolve the unit before publishing`;
    return claim;
  }

  claim.ceiling = fieldCeiling;
  claim.grade = 'field-calibrated';
  claim.source = published.source;
  claim.sampleCount = published.sampleCount;
  claim.unitsContributing = agg.unitsContributing;
  claim.applicability = 'stated';
  claim.blockedBy = null;
  return claim;
}

/**
 * Build the publishable capability sheet for a model from raw observations.
 *
 * Read-only: nothing here mutates `MACHINE_THERMAL`, so the vendor baseline stays
 * intact and every published number can be traced back to the readings behind it.
 */
export function capabilityClaim(modelId: string, observations: CalibrationObservation[]): CapabilityClaim {
  const machine = getMachineThermalCapability(modelId);

  const axes = THERMAL_AXES.map(def => {
    const agg = aggregateCalibration(observations, { modelId, axis: def.axis });
    return claimAxis({
      axis: def.axis,
      label: def.label,
      unit: machine[def.field].unit,
      vendor: machine[def.field],
      activeChamber: machine.activeChamber,
      agg: agg.samples === 0 ? null : agg,
    });
  });

  const contributing = axes.filter(a => a.applicability !== 'absent');
  const grade: EvidenceGrade =
    contributing.length === 0
      ? 'unverified'
      : contributing.reduce<EvidenceGrade>(
          (weakest, a) => (GRADE_RANK[a.grade] < GRADE_RANK[weakest] ? a.grade : weakest),
          'field-calibrated',
        );

  const notes: string[] = [];
  for (const a of axes) {
    if (a.contradiction) {
      notes.push(
        `${a.label}: readings up to ${a.contradiction.observedMax} ${a.unit} sit above the ${a.contradiction.vendorCeiling} ${a.unit} vendor ceiling — check the unit, do not publish the higher number`,
      );
    }
    if (a.applicability === 'absent') {
      notes.push(`${a.label}: not applicable to this model — excluded from the overall grade`);
    }
    if (a.applicability === 'unknown' && a.blockedBy === null) {
      notes.push(`${a.label}: no ceiling known and no readings yet — stays 'unknown' until the floor measures one`);
    }
  }

  return {
    modelId,
    axes,
    grade,
    publishable: axes.some(a => a.applicability === 'stated' && a.ceiling !== null),
    fullyFieldCalibrated: contributing.length > 0 && contributing.every(a => a.applicability === 'stated' && a.grade === 'field-calibrated'),
    notes,
  };
}

/**
 * The vendor capability object with field numbers folded in — the shape the
 * verdict engine consumes. Use this instead of `getMachineThermalCapability`
 * whenever readings are available, otherwise a job is judged against a sheet
 * that the floor has already disproved.
 */
export function overlaidCapability(
  modelId: string,
  observations: CalibrationObservation[],
): MachineThermalCapability {
  const vendor = getMachineThermalCapability(modelId);
  const claim = capabilityClaim(modelId, observations);

  const rebuild = (original: AxisBound, axis: CalibrationAxis): AxisBound => {
    const c = claim.axes.find(a => a.axis === axis);
    if (c === undefined || c.ceiling === null || c.grade === 'unverified') return original;
    const unchanged = c.ceiling === ceilingOf(original) && c.grade === original.grade;
    if (unchanged) return original;
    return bound({
      unit: c.unit,
      max: c.ceiling,
      grade: c.grade,
      source: c.source,
      sampleCount: c.sampleCount ?? undefined,
    });
  };

  return {
    nozzleMaxC: rebuild(vendor.nozzleMaxC, 'nozzle-temp'),
    chamberMaxC: rebuild(vendor.chamberMaxC, 'chamber-temp'),
    bedMaxC: rebuild(vendor.bedMaxC, 'bed-temp'),
    activeChamber: vendor.activeChamber,
  };
}

/** Judge a material against the field-corrected capability, not the sheet. */
export function assessWithField(params: {
  modelId: string;
  material: string;
  observations: CalibrationObservation[];
}): ThermalVerdict {
  return assessThermal({
    material: params.material,
    machine: overlaidCapability(params.modelId, params.observations),
  });
}

/** One line for the capability sheet / the sales call. */
export function describeClaim(claim: CapabilityClaim): string {
  const parts = claim.axes.map(a => {
    if (a.applicability === 'absent') return `${a.label} n/a`;
    if (a.ceiling === null) return `${a.label} unknown`;
    const basis =
      a.grade === 'field-calibrated' && a.sampleCount !== null
        ? `, ${a.unitsContributing} unit(s) / ${a.sampleCount} readings`
        : '';
    return `${a.label} ${a.ceiling} ${a.unit} (${a.grade}${basis})`;
  });
  const head = `${claim.modelId}: ${parts.join(' | ')} — overall ${claim.grade}`;
  return claim.notes.length === 0 ? head : `${head}. ${claim.notes.join('; ')}`;
}
