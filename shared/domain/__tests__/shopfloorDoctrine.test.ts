/**
 * Shopfloor doctrine — the six upgrades encoded as executable invariants.
 *
 * These are not unit tests for happy paths. Each `it()` states a rule the
 * product is not allowed to break, so a regression shows up as a failing
 * assertion rather than as a wrong quote sent to a customer.
 *
 *  1. every number carries an evidence grade
 *  2. material fit is judged on the thermal axis, chamber first
 *  3. a printer row resolves into the spec layer, or is honestly unbound
 *  4. `unverified` never silently becomes yes or no
 *  5. field calibration only ever narrows, and only with cross-unit evidence
 *  6. capacity is reported in units software can actually move
 */

import { describe, expect, it } from 'vitest';

import { bound, covers, describe as describeBound, narrow, unverified } from '../evidence';
import {
  PROCESS_ENVELOPES,
  assessModelMaterial,
  envelopeAxes,
  getMachineThermalCapability,
} from '../machine';
import { THERMAL_REQUIREMENTS, assessThermal, describeThermal } from '../thermal';
import {
  aggregateCalibration,
  capacityReport,
  publishBound,
  tryNarrow,
  type CalibrationObservation,
} from '../fieldCalibration';

// ── 1. Every number carries an evidence grade ───────────────────────────────

describe('1 — evidence is not optional', () => {
  it('rejects a bound with no source', () => {
    expect(() => bound({ unit: '°C', max: 300, grade: 'vendor-sheet', source: '' })).toThrow(
      /source is mandatory/,
    );
  });

  it('rejects a field-calibrated bound with no samples', () => {
    expect(() =>
      bound({ unit: '°C', max: 300, grade: 'field-calibrated', source: 'floor log' }),
    ).toThrow(/sampleCount/);
  });

  it('prints the grade alongside the value, so a report cannot hide it', () => {
    const b = bound({ unit: '°C', max: 120, grade: 'vendor-sheet', source: 'vendor bed spec' });
    expect(describeBound(b)).toMatch(/≤120°C \[vendor-sheet\]/);
  });

  it('keeps dimension checks at ceiling-vs-ceiling', () => {
    const needed = bound({ unit: 'mm', max: 200, grade: 'vendor-sheet', source: 'part size' });
    const big = bound({ unit: 'mm', max: 250, grade: 'two-source', source: 'two vendor specs' });
    const small = bound({ unit: 'mm', max: 150, grade: 'two-source', source: 'two vendor specs' });
    expect(covers(needed, big)).toBe('covered');
    expect(covers(needed, small)).toBe('short');
  });
});

// ── 2. Material fit is a thermal question, chamber first ────────────────────

describe('2 — thermal gate names the blocking axis', () => {
  it('blocks PEEK on a 60 °C-chamber desktop machine and says by how much', () => {
    const verdict = assessModelMaterial('bambu_x1c', 'PEEK');
    expect(verdict.printable).toBe(false);
    expect(verdict.blockedBy).toContain('chamber-temp');
    expect(verdict.blockedBy).toContain('nozzle-temp');
    // chamber floor 200, machine ceiling 60 -> short by 140
    expect(verdict.reason).toMatch(/short by 140 °C/);
    expect(verdict.headroomC.chamber).toBe(-140);
  });

  it('passes PLA on the same machine — the gate is material-specific, not machine-bashing', () => {
    const verdict = assessModelMaterial('bambu_x1c', 'PLA');
    expect(verdict.printable).toBe(true);
    expect(verdict.blockedBy).toHaveLength(0);
    expect(verdict.bindingAxis).toBe('chamber');
  });

  it('requires an actively heated chamber for the high-temperature cluster', () => {
    for (const m of ['PEEK', 'PEKK', 'PEI', 'PPSU', 'PPS'] as const) {
      expect(THERMAL_REQUIREMENTS[m].requiresActiveChamber).toBe(true);
    }
    for (const m of ['ABS', 'ASA', 'PLA', 'TPU'] as const) {
      expect(THERMAL_REQUIREMENTS[m].requiresActiveChamber).toBe(false);
    }
  });

  it('flags a passive-only enclosure even when a chamber number exists', () => {
    const verdict = assessThermal({
      material: 'PEEK',
      machine: {
        nozzleMaxC: bound({ unit: '°C', max: 450, grade: 'two-source', source: 'test rig' }),
        chamberMaxC: bound({ unit: '°C', max: 250, grade: 'two-source', source: 'test rig' }),
        bedMaxC: bound({ unit: '°C', max: 160, grade: 'two-source', source: 'test rig' }),
        activeChamber: false,
      },
    });
    expect(verdict.printable).toBe(false);
    expect(verdict.blockedBy).toContain('passive-chamber');
  });
});

// ── 3. A printer row resolves into the spec layer, or is honestly unbound ───

describe('3 — machines resolve to specs, not to free text', () => {
  it('returns a thermal capability for a known model', () => {
    const cap = getMachineThermalCapability('bambu_x1c');
    expect(cap.activeChamber).toBe(true);
    expect(cap.chamberMaxC.max).toBe(60);
  });

  it('degrades an unknown model to all-unverified instead of guessing', () => {
    const cap = getMachineThermalCapability('some_customer_kit_printer');
    expect(cap.chamberMaxC.grade).toBe('unverified');
    expect(cap.nozzleMaxC.grade).toBe('unverified');
    const verdict = assessModelMaterial('some_customer_kit_printer', 'PLA');
    expect(verdict.printable).toBe('unknown');
  });
});

// ── 4. `unverified` is a first-class citizen ────────────────────────────────

describe('4 — unverified never silently becomes yes or no', () => {
  it('refuses to bless PEEK on the pellet machine just because it is a big hot machine', () => {
    const verdict = assessModelMaterial('fgf_1800_pro', 'PEEK');
    expect(verdict.printable).toBe('unknown');
    expect(verdict.grade).toBe('unverified');
    expect(verdict.reason).toMatch(/unverified rather than guessed/);
  });

  it('reports an unknown material instead of assuming printable', () => {
    const verdict = assessModelMaterial('bambu_x1c', 'UNOBTAINIUM');
    expect(verdict.printable).toBe('unknown');
    expect(verdict.blockedBy).toContain('unknown-material');
  });

  it('leaves envelopeless processes honestly empty rather than inventing a volume', () => {
    const axes = envelopeAxes(PROCESS_ENVELOPES.SLS);
    expect(axes).toHaveLength(3);
    expect(axes.every((a) => a.grade === 'unverified')).toBe(true);
    expect(axes.every((a) => a.min === null && a.max === null)).toBe(true);
  });

  it('grades a carried-over envelope down to unverified', () => {
    // SLM carries a volume from a generic table with no representative model.
    const axes = envelopeAxes(PROCESS_ENVELOPES.SLM);
    expect(axes[0].grade).toBe('unverified');
    // FDM is backed by a verified representative model, so it keeps a real grade.
    const fdm = envelopeAxes(PROCESS_ENVELOPES.FDM);
    expect(fdm[0].grade).toBe('two-source');
    expect(fdm[0].max).toBe(256);
  });

  it('reports unknown when one side of a comparison is missing', () => {
    const req = bound({ unit: '°C', min: 200, max: 300, grade: 'two-source', source: 'spec' });
    const cap = unverified('°C', 'nobody measured it');
    expect(covers(req, cap)).toBe('unknown');
  });
});

// ── 5. Calibration only narrows, and only on cross-unit evidence ────────────

const obs = (
  unitId: string,
  value: number,
  extra: Partial<CalibrationObservation> = {},
): CalibrationObservation => ({
  id: `${unitId}-${value}`,
  modelId: 'bambu_x1c',
  unitId,
  axis: 'chamber-temp',
  unit: '°C',
  value,
  at: '2026-11-20T08:00:00Z',
  method: 'thermocouple',
  accepted: true,
  ...extra,
});

describe('5 — field calibration cannot be faked into existence', () => {
  it('refuses to rewrite the model envelope from one machine', () => {
    const agg = aggregateCalibration([obs('unit-a', 55), obs('unit-a', 57), obs('unit-a', 56)], {
      modelId: 'bambu_x1c',
      axis: 'chamber-temp',
    });
    expect(agg.unitsContributing).toBe(1);
    expect(agg.grade).toBe('unverified');
    expect(agg.blockedBy).toMatch(/single machine is a deviation/);
    expect(tryNarrow(bound({ unit: '°C', max: 60, grade: 'vendor-sheet', source: 'spec' }), agg).ok).toBe(
      false,
    );
  });

  it('accepts cross-unit thermocouple data and publishes a narrower bound', () => {
    const agg = aggregateCalibration(
      [obs('unit-a', 55), obs('unit-b', 57), obs('unit-c', 56), obs('unit-a', 54)],
      { modelId: 'bambu_x1c', axis: 'chamber-temp' },
    );
    expect(agg.unitsContributing).toBe(3);
    expect(agg.grade).toBe('field-calibrated');
    const prior = bound({ unit: '°C', max: 60, grade: 'vendor-sheet', source: 'vendor spec' });
    const outcome = tryNarrow(prior, agg);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.bound.max).toBe(57);
      expect(outcome.bound.grade).toBe('field-calibrated');
      expect(outcome.bound.sampleCount).toBe(4);
    }
    expect(publishBound(agg)?.max).toBe(57);
  });

  it('ignores rejected readings — a dropped thermocouple is not data', () => {
    const agg = aggregateCalibration(
      [obs('unit-a', 55), obs('unit-b', 56), obs('unit-c', 54), obs('unit-d', 300, { accepted: false })],
      { modelId: 'bambu_x1c', axis: 'chamber-temp' },
    );
    expect(agg.acceptedSamples).toBe(3);
    expect(agg.max).toBe(56);
  });

  it('treats an out-of-prior observation as a contradiction, not a wider envelope', () => {
    const agg = aggregateCalibration(
      [obs('unit-a', 92), obs('unit-b', 95), obs('unit-c', 90)],
      { modelId: 'bambu_x1c', axis: 'chamber-temp' },
    );
    const prior = bound({ unit: '°C', max: 60, grade: 'vendor-sheet', source: 'vendor spec' });
    const outcome = tryNarrow(prior, agg);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toMatch(/escapes prior/);
      expect(outcome.prior.max).toBe(60); // untouched
    }
  });

  it('will not narrow from operator notes alone', () => {
    const agg = aggregateCalibration(
      [
        obs('unit-a', 55, { method: 'operator-note' }),
        obs('unit-b', 56, { method: 'slicer-log' }),
        obs('unit-c', 54, { method: 'operator-note' }),
      ],
      { modelId: 'bambu_x1c', axis: 'chamber-temp' },
    );
    expect(agg.grade).toBe('unverified');
    expect(agg.blockedBy).toMatch(/thermocouple or part measurement/);
  });

  it('never widens: narrow() itself rejects an escaping window', () => {
    const prior = bound({ unit: '°C', min: 50, max: 60, grade: 'two-source', source: 'spec' });
    expect(() =>
      narrow(prior, { min: 55, max: 70, sampleCount: 5, source: 'floor' }),
    ).toThrow(/escapes prior/);
  });
});

// ── 6. Capacity is reported where software can act ──────────────────────────

describe('6 — the capacity lever is stated in units software can move', () => {
  it('splits a fleet report into utilisation, yield, and reclaimable parts', () => {
    const report = capacityReport(
      [
        {
          modelId: 'bambu_x1c',
          unitId: 'unit-a',
          plannedHours: 100,
          productiveHours: 80,
          goodParts: 40,
          totalParts: 50,
          at: '2026-11-20T08:00:00Z',
        },
        {
          modelId: 'bambu_x1c',
          unitId: 'unit-b',
          plannedHours: 100,
          productiveHours: 60,
          goodParts: 21,
          totalParts: 30,
          at: '2026-11-20T08:00:00Z',
        },
      ],
      'bambu_x1c',
    );
    expect(report.units).toBe(2);
    expect(report.plannedHours).toBe(200);
    expect(report.productiveHours).toBe(140);
    expect(report.utilisation).toBe(0.7);
    // 61 good of 80 total
    expect(report.yieldRate).toBe(0.763);
    // 61 / 140 productive hours * 200 planned hours
    expect(report.theoreticalParts).toBe(87.1);
    expect(report.softwareAddressableParts).toBe(26.1);
  });

  it('returns null instead of zero when there is nothing to extrapolate from', () => {
    const report = capacityReport([], 'bambu_x1c');
    expect(report.utilisation).toBeNull();
    expect(report.theoreticalParts).toBeNull();
    expect(report.softwareAddressableParts).toBeNull();
  });
});

// ── human-readable output stays honest ─────────────────────────────────────

describe('report text', () => {
  it('states the verdict, the grade and the reason in one line', () => {
    const line = describeThermal(assessModelMaterial('bambu_x1c', 'PEEK'));
    expect(line).toMatch(/^PEEK BLOCKED/);
    expect(line).toContain('chamber');
  });
});
