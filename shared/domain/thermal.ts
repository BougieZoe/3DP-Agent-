/**
 * Thermal requirements per material family, and the machine-side thermal
 * capability check.
 *
 * The shopfloor lesson this file encodes: for high-temperature polymers the
 * binding constraint is almost never the nozzle — it is the chamber. A 400 °C
 * hotend on an open frame cannot print PEEK, and no amount of slicer tuning
 * changes that. So the check lives in the domain layer, next to the machine
 * specs, rather than inside the slicer.
 *
 * Grades are honest: PEEK/PEI/PPSU figures are aggregated from multiple
 * public vendor specs (two-source), not measured by us. Anything we have not
 * corroborated stays `unverified` rather than being filled in with a plausible
 * number.
 */

import {
  type AxisBound,
  type CoverageVerdict,
  type EvidenceGrade,
  bound,
  describe,
  unverified,
} from './evidence';

export type MaterialFamily =
  | 'PEEK'
  | 'PEKK'
  | 'PEI'
  | 'PPSU'
  | 'PPS'
  | 'PA-CF'
  | 'PA'
  | 'ABS'
  | 'ASA'
  | 'PLA'
  | 'TPU';

export interface ThermalRequirement {
  material: MaterialFamily;
  /** Hotend setpoint window. */
  nozzle: AxisBound;
  /** Chamber air temperature the part actually needs. */
  chamber: AxisBound;
  /** Bed surface temperature. */
  bed: AxisBound;
  /**
   * True when a passive enclosure is not enough — the material needs a heated
   * chamber with active control (PEEK, PEI, PPSU, PPS).
   */
  requiresActiveChamber: boolean;
  /** Semi-crystalline materials shrink anisotropically; drives warp risk. */
  crystalline: boolean;
  grade: EvidenceGrade;
  notes: string;
}

const HIGH_TEMP =
  'aggregated from >=2 public high-temperature platform specs (chamber-heated series) plus resin-datasheet processing guides';

/**
 * Material table. Deliberately keeps PEEK/PEI/PPSU in one cluster: they share
 * the same structural requirement (chamber >= 160-200 °C) and therefore the
 * same class of machine. Splitting them into separate machine classes would
 * over-fit the catalogue.
 */
export const THERMAL_REQUIREMENTS: Record<MaterialFamily, ThermalRequirement> = {
  PEEK: {
    material: 'PEEK',
    nozzle: bound({
      unit: '°C',
      min: 360,
      max: 450,
      grade: 'two-source',
      source: `${HIGH_TEMP}; PEEK melts ~343 °C so the setpoint sits well above it`,
    }),
    chamber: bound({
      unit: '°C',
      min: 200,
      max: 300,
      grade: 'two-source',
      source: `${HIGH_TEMP}; below ~200 °C chamber the part warps and crystallinity is unpredictable`,
    }),
    bed: bound({
      unit: '°C',
      min: 120,
      max: 160,
      grade: 'two-source',
      source: `${HIGH_TEMP}; bed must stay above the glass transition to hold first-layer geometry`,
    }),
    requiresActiveChamber: true,
    crystalline: true,
    grade: 'two-source',
    notes: 'The chamber is the gate, not the hotend. An open-frame 400 °C machine still cannot run PEEK.',
  },
  PEKK: {
    material: 'PEKK',
    nozzle: bound({
      unit: '°C',
      min: 340,
      max: 400,
      grade: 'two-source',
      source: `${HIGH_TEMP}; PEKK processes cooler than PEEK at comparable service temperature`,
    }),
    chamber: bound({
      unit: '°C',
      min: 150,
      max: 250,
      grade: 'two-source',
      source: HIGH_TEMP,
    }),
    bed: bound({
      unit: '°C',
      min: 120,
      max: 160,
      grade: 'vendor-sheet',
      source: 'vendor datasheet processing guide',
    }),
    requiresActiveChamber: true,
    crystalline: true,
    grade: 'two-source',
    notes: 'Slightly wider process window than PEEK; same machine class.',
  },
  PEI: {
    material: 'PEI',
    nozzle: bound({
      unit: '°C',
      min: 350,
      max: 400,
      grade: 'two-source',
      source: `${HIGH_TEMP}; PEI (ULTEM-class) needs a hotend above 350 °C to keep viscosity workable`,
    }),
    chamber: bound({
      unit: '°C',
      min: 190,
      max: 230,
      grade: 'two-source',
      source: `${HIGH_TEMP}; layer bonding collapses below ~190 °C chamber`,
    }),
    bed: bound({
      unit: '°C',
      min: 140,
      max: 160,
      grade: 'two-source',
      source: HIGH_TEMP,
    }),
    requiresActiveChamber: true,
    crystalline: false,
    grade: 'two-source',
    notes: 'Amorphous, so lower warp risk than PEEK, but the chamber gate is just as hard.',
  },
  PPSU: {
    material: 'PPSU',
    nozzle: bound({
      unit: '°C',
      min: 350,
      max: 400,
      grade: 'two-source',
      source: HIGH_TEMP,
    }),
    chamber: bound({
      unit: '°C',
      min: 160,
      max: 200,
      grade: 'two-source',
      source: HIGH_TEMP,
    }),
    bed: bound({
      unit: '°C',
      min: 120,
      max: 160,
      grade: 'vendor-sheet',
      source: 'vendor datasheet processing guide',
    }),
    requiresActiveChamber: true,
    crystalline: false,
    grade: 'two-source',
    notes: 'Sterilizable-grade polymer; still a heated-chamber material.',
  },
  PPS: {
    material: 'PPS',
    nozzle: bound({
      unit: '°C',
      min: 320,
      max: 360,
      grade: 'two-source',
      source: HIGH_TEMP,
    }),
    chamber: bound({
      unit: '°C',
      min: 120,
      max: 160,
      grade: 'vendor-sheet',
      source: 'vendor datasheet processing guide',
    }),
    bed: bound({
      unit: '°C',
      min: 100,
      max: 140,
      grade: 'vendor-sheet',
      source: 'vendor datasheet processing guide',
    }),
    requiresActiveChamber: true,
    crystalline: true,
    grade: 'two-source',
    notes: 'Lowest bar in the high-temperature cluster; sometimes runs in a hot passive enclosure.',
  },
  'PA-CF': {
    material: 'PA-CF',
    nozzle: bound({
      unit: '°C',
      min: 270,
      max: 300,
      grade: 'two-source',
      source: 'engineering-grade filament specs across >=2 vendors',
    }),
    chamber: bound({
      unit: '°C',
      min: 50,
      max: 80,
      grade: 'vendor-sheet',
      source: 'vendor datasheet; passive enclosure usually suffices at small part sizes',
    }),
    bed: bound({
      unit: '°C',
      min: 90,
      max: 110,
      grade: 'two-source',
      source: 'engineering-grade filament specs across >=2 vendors',
    }),
    requiresActiveChamber: false,
    crystalline: true,
    grade: 'two-source',
    notes: 'Warp-driven, not temperature-gated: enclosure helps, but this is a geometry problem.',
  },
  PA: {
    material: 'PA',
    nozzle: bound({
      unit: '°C',
      min: 250,
      max: 280,
      grade: 'two-source',
      source: 'standard filament specs across >=2 vendors',
    }),
    chamber: bound({
      unit: '°C',
      min: 40,
      max: 60,
      grade: 'vendor-sheet',
      source: 'vendor datasheet',
    }),
    bed: bound({
      unit: '°C',
      min: 70,
      max: 90,
      grade: 'two-source',
      source: 'standard filament specs across >=2 vendors',
    }),
    requiresActiveChamber: false,
    crystalline: true,
    grade: 'two-source',
    notes: 'Moisture is the real enemy here, not chamber temperature.',
  },
  ABS: {
    material: 'ABS',
    nozzle: bound({
      unit: '°C',
      min: 230,
      max: 260,
      grade: 'two-source',
      source: 'standard filament specs across >=2 vendors',
    }),
    chamber: bound({
      unit: '°C',
      min: 40,
      max: 60,
      grade: 'vendor-sheet',
      source: 'vendor datasheet; generic enclosure guidance',
    }),
    bed: bound({
      unit: '°C',
      min: 90,
      max: 110,
      grade: 'two-source',
      source: 'standard filament specs across >=2 vendors',
    }),
    requiresActiveChamber: false,
    crystalline: false,
    grade: 'two-source',
    notes: 'The classic "needs an enclosure" material; still far below the high-temperature cluster.',
  },
  ASA: {
    material: 'ASA',
    nozzle: bound({
      unit: '°C',
      min: 240,
      max: 270,
      grade: 'two-source',
      source: 'standard filament specs across >=2 vendors',
    }),
    chamber: bound({
      unit: '°C',
      min: 40,
      max: 70,
      grade: 'vendor-sheet',
      source: 'vendor datasheet; generic enclosure guidance',
    }),
    bed: bound({
      unit: '°C',
      min: 90,
      max: 110,
      grade: 'two-source',
      source: 'standard filament specs across >=2 vendors',
    }),
    requiresActiveChamber: false,
    crystalline: false,
    grade: 'two-source',
    notes: 'UV-stable ABS substitute.',
  },
  PLA: {
    material: 'PLA',
    nozzle: bound({
      unit: '°C',
      min: 190,
      max: 220,
      grade: 'two-source',
      source: 'standard filament specs across >=2 vendors',
    }),
    chamber: bound({
      unit: '°C',
      min: 15,
      max: 40,
      grade: 'two-source',
      source: 'ambient operation is the documented default for PLA; no chamber required',
    }),
    bed: bound({
      unit: '°C',
      min: 45,
      max: 60,
      grade: 'two-source',
      source: 'standard filament specs across >=2 vendors',
    }),
    requiresActiveChamber: false,
    crystalline: false,
    grade: 'two-source',
    notes: 'Baseline; every machine covers it, so it is useful as a negative control in tests.',
  },
  TPU: {
    material: 'TPU',
    nozzle: bound({
      unit: '°C',
      min: 210,
      max: 240,
      grade: 'two-source',
      source: 'standard filament specs across >=2 vendors',
    }),
    chamber: unverified('°C', 'no corroborated chamber requirement for flexible filaments'),
    bed: bound({
      unit: '°C',
      min: 30,
      max: 60,
      grade: 'two-source',
      source: 'standard filament specs across >=2 vendors',
    }),
    requiresActiveChamber: false,
    crystalline: false,
    grade: 'vendor-sheet',
    notes: 'Chamber temperature is irrelevant; the constraint is feed path and speed.',
  },
};

export type ThermalBlock =
  | 'nozzle-temp'
  | 'chamber-temp'
  | 'passive-chamber'
  | 'bed-temp'
  | 'unknown-material'
  | 'unknown-machine';

export type ThermalVerdictValue = true | false | 'unknown';

export interface MachineThermalCapability {
  /** Max hotend setpoint, or null when the spec is not established. */
  nozzleMaxC: AxisBound;
  /** Max chamber air temperature. null bound when the machine has no chamber. */
  chamberMaxC: AxisBound;
  bedMaxC: AxisBound;
  /** Whether the chamber is actively heated (not just an enclosure). */
  activeChamber: boolean;
}

export interface ThermalVerdict {
  material: MaterialFamily | string;
  /** true = printable, false = provably blocked, 'unknown' = we lack a number. */
  printable: ThermalVerdictValue;
  /** Every axis that provably falls short. Empty when printable is true. */
  blockedBy: ThermalBlock[];
  /** Capability minus requirement, per axis. Positive = headroom. */
  headroomC: { nozzle: number | null; chamber: number | null; bed: number | null };
  /** The single tightest axis — the one to invest in. null when all pass. */
  bindingAxis: 'nozzle' | 'chamber' | 'bed' | null;
  grade: EvidenceGrade;
  reason: string;
}

export function isMaterialFamily(id: string): id is MaterialFamily {
  return Object.prototype.hasOwnProperty.call(THERMAL_REQUIREMENTS, id);
}

export function getThermalRequirement(material: string): ThermalRequirement | null {
  return isMaterialFamily(material) ? THERMAL_REQUIREMENTS[material] : null;
}

/**
 * Thermal requirements are FLOORS, not capacities. PEEK needs the nozzle to
 * *reach* 360 °C — the bottom of its window — not 450 °C. Comparing ceiling to
 * ceiling here would demand the top of the window and reject machines that are
 * perfectly capable, so the comparison is deliberately floor-vs-ceiling.
 *
 * (Dimension checks keep the ceiling-vs-ceiling semantics in evidence.covers:
 * a part needs a build volume at least as big as itself.)
 */
function reqFloor(b: AxisBound): number | null {
  return b.min ?? b.max;
}

function machineCeiling(b: AxisBound): number | null {
  return b.max ?? b.min;
}

function coverageOf(req: AxisBound, cap: AxisBound): CoverageVerdict {
  if (!isActionableBound(req) || !isActionableBound(cap)) return 'unknown';
  const floor = reqFloor(req);
  const ceil = machineCeiling(cap);
  if (floor === null || ceil === null) return 'unknown';
  return ceil >= floor ? 'covered' : 'short';
}

function headroomOf(req: AxisBound, cap: AxisBound): number | null {
  if (!isActionableBound(req) || !isActionableBound(cap)) return null;
  const floor = reqFloor(req);
  const ceil = machineCeiling(cap);
  if (floor === null || ceil === null) return null;
  return round1(ceil - floor);
}

/**
 * Core check. Answers "can this machine actually run this material", with the
 * blocking axis named, instead of a boolean that hides the reason.
 */
export function assessThermal(params: {
  material: string;
  machine: MachineThermalCapability;
}): ThermalVerdict {
  const { material, machine } = params;
  const req = getThermalRequirement(material);

  if (req === null) {
    return {
      material,
      printable: 'unknown',
      blockedBy: ['unknown-material'],
      headroomC: { nozzle: null, chamber: null, bed: null },
      bindingAxis: null,
      grade: 'unverified',
      reason: `no thermal requirement recorded for "${material}" — add it to THERMAL_REQUIREMENTS before judging`,
    };
  }

  const nozzleCoverage = coverageOf(req.nozzle, machine.nozzleMaxC);
  const chamberCoverage = coverageOf(req.chamber, machine.chamberMaxC);
  const bedCoverage = coverageOf(req.bed, machine.bedMaxC);

  const nozzleHead = headroomOf(req.nozzle, machine.nozzleMaxC);
  const chamberHead = headroomOf(req.chamber, machine.chamberMaxC);
  const bedHead = headroomOf(req.bed, machine.bedMaxC);

  const blockedBy: ThermalBlock[] = [];
  if (nozzleCoverage === 'short') blockedBy.push('nozzle-temp');
  if (chamberCoverage === 'short') blockedBy.push('chamber-temp');
  if (bedCoverage === 'short') blockedBy.push('bed-temp');
  if (req.requiresActiveChamber && !machine.activeChamber) blockedBy.push('passive-chamber');

  const unknownSide =
    nozzleCoverage === 'unknown' || chamberCoverage === 'unknown' || bedCoverage === 'unknown';

  const headroomC = { nozzle: nozzleHead, chamber: chamberHead, bed: bedHead };
  const bindingAxis = pickBindingAxis(headroomC);
  const grade = worstGrade([req.grade, machine.nozzleMaxC.grade, machine.chamberMaxC.grade, machine.bedMaxC.grade]);

  let printable: ThermalVerdictValue;
  if (blockedBy.length > 0) {
    printable = false;
  } else if (unknownSide) {
    printable = 'unknown';
  } else {
    printable = true;
  }

  return {
    material: req.material,
    printable,
    blockedBy: dedupe(blockedBy),
    headroomC,
    bindingAxis,
    grade,
    reason: buildReason(req, machine, { blockedBy, headroomC, printable, unknownSide }),
  };
}

function pickBindingAxis(h: { nozzle: number | null; chamber: number | null; bed: number | null }) {
  const entries = (['nozzle', 'chamber', 'bed'] as const)
    .map((axis) => ({ axis, value: h[axis] }))
    .filter((e): e is { axis: 'nozzle' | 'chamber' | 'bed'; value: number } => e.value !== null);
  if (entries.length === 0) return null;
  entries.sort((a, b) => a.value - b.value);
  return entries[0].axis;
}

function buildReason(
  req: ThermalRequirement,
  machine: MachineThermalCapability,
  state: {
    blockedBy: ThermalBlock[];
    headroomC: { nozzle: number | null; chamber: number | null; bed: number | null };
    printable: ThermalVerdictValue;
    unknownSide: boolean;
  },
): string {
  if (state.printable === true) {
    const tight = pickBindingAxis(state.headroomC);
    const gap = tight ? state.headroomC[tight] : null;
    return `${req.material} printable; tightest axis is ${tight} with ${gap} °C headroom`;
  }
  if (state.printable === 'unknown') {
    const missing: string[] = [];
    if (!isActionableBound(machine.nozzleMaxC)) missing.push('nozzle ceiling');
    if (!isActionableBound(machine.chamberMaxC)) missing.push('chamber ceiling');
    if (!isActionableBound(machine.bedMaxC)) missing.push('bed ceiling');
    return `${req.material}: cannot judge — ${missing.join(', ')} unverified rather than guessed`;
  }
  const parts: string[] = [];
  if (state.blockedBy.includes('chamber-temp')) {
    const need = reqFloor(req.chamber);
    const haveNum = machineCeiling(machine.chamberMaxC);
    parts.push(
      `chamber ${haveNum === null ? 'unknown' : `${haveNum} °C`} is below the ${need} °C floor ${req.material} needs` +
        (haveNum !== null && need !== null ? ` (short by ${round1(need - haveNum)} °C)` : ''),
    );
  }
  if (state.blockedBy.includes('nozzle-temp')) {
    const haveNum = machineCeiling(machine.nozzleMaxC);
    const need = reqFloor(req.nozzle);
    parts.push(
      `hotend ${haveNum ?? 'unknown'} °C below the ${need} °C floor` +
        (haveNum !== null && need !== null ? ` (short by ${round1(need - haveNum)} °C)` : ''),
    );
  }
  if (state.blockedBy.includes('bed-temp')) {
    const haveNum = machineCeiling(machine.bedMaxC);
    const need = reqFloor(req.bed);
    parts.push(
      `bed ${haveNum ?? 'unknown'} °C below the ${need} °C floor` +
        (haveNum !== null && need !== null ? ` (short by ${round1(need - haveNum)} °C)` : ''),
    );
  }
  if (state.blockedBy.includes('passive-chamber')) {
    parts.push(`${req.material} requires an actively heated chamber; this machine only offers an enclosure`);
  }
  return `${req.material} blocked: ${parts.join('; ')}`;
}

function isActionableBound(b: AxisBound): boolean {
  return (b.min !== null || b.max !== null) && b.grade !== 'unverified';
}

function worstGrade(grades: EvidenceGrade[]): EvidenceGrade {
  const order: EvidenceGrade[] = ['unverified', 'vendor-sheet', 'two-source', 'field-calibrated'];
  let worst = grades[0] ?? 'unverified';
  for (const g of grades) {
    if (order.indexOf(g) < order.indexOf(worst)) worst = g;
  }
  return worst;
}

function dedupe<T>(items: T[]): T[] {
  return items.filter((v, i) => items.indexOf(v) === i);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Compact one-line summary for logs and the analyze response. */
export function describeThermal(verdict: ThermalVerdict): string {
  const state =
    verdict.printable === true ? 'PRINTABLE' : verdict.printable === false ? 'BLOCKED' : 'UNKNOWN';
  return `${verdict.material} ${state} (${verdict.grade}) ${verdict.reason}`;
}

/** Re-export so callers need only one import for report formatting. */
export { describe };
