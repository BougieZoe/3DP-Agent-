/**
 * Field overlay invariants — the published capability sheet is a customer-facing
 * claim, so each rule here is about what we refuse to publish:
 * a raised ceiling, an upgraded grade without evidence, or a gap papered over.
 */

import { describe, expect, it } from 'vitest';

import {
  type CalibrationAxis,
  type CalibrationObservation,
  type AxisUnit,
} from '../fieldCalibration';
import { assessModelMaterial } from '../machine';
import { assessWithField, capabilityClaim, describeClaim, overlaidCapability } from '../fieldOverlay';

/** Three physical units, six readings each — enough to call it a model truth. */
function readings(
  modelId: string,
  axis: CalibrationAxis,
  unit: AxisUnit,
  perUnit: number[][],
): CalibrationObservation[] {
  const out: CalibrationObservation[] = [];
  perUnit.forEach((vals, ui) => {
    vals.forEach((value, i) => {
      out.push({
        id: `${modelId}-${axis}-u${ui}-${i}`,
        modelId,
        unitId: `printer_${ui}`,
        axis,
        unit,
        value,
        at: `2026-11-${String(10 + i).padStart(2, '0')}T09:00:00Z`,
        method: 'thermocouple',
        accepted: true,
      });
    });
  });
  return out;
}

const six = (base: number, step = 1): number[] => Array.from({ length: 6 }, (_, i) => base + i * step);

describe('1 — no readings, no change', () => {
  it('keeps the vendor ceiling and says why nothing moved', () => {
    const nozzle = capabilityClaim('bambu_x1c', []).axes.find(a => a.axis === 'nozzle-temp');
    expect(nozzle?.ceiling).toBe(300);
    expect(nozzle?.grade).toBe('vendor-sheet');
    expect(nozzle?.blockedBy).toBe('no field readings for this axis yet');
  });
});

describe('2 — readings may narrow a vendor ceiling', () => {
  const obs = readings('bambu_x1c', 'nozzle-temp', '°C', [six(285), six(287), six(288)]);

  it('publishes the floor number, graded field-calibrated', () => {
    const nozzle = capabilityClaim('bambu_x1c', obs).axes.find(a => a.axis === 'nozzle-temp');
    expect(nozzle?.ceiling).toBe(293);
    expect(nozzle?.grade).toBe('field-calibrated');
    expect(nozzle?.unitsContributing).toBe(3);
  });

  it('does not let one calibrated axis upgrade the machine', () => {
    const claim = capabilityClaim('bambu_x1c', obs);
    expect(claim.fullyFieldCalibrated).toBe(false);
    expect(claim.grade).toBe('vendor-sheet');
  });
});

describe('3 — readings above spec are a contradiction, not a discovery', () => {
  const obs = readings('bambu_x1c', 'nozzle-temp', '°C', [six(320), six(330), six(340)]);
  const claim = capabilityClaim('bambu_x1c', obs);
  const nozzle = claim.axes.find(a => a.axis === 'nozzle-temp');

  it('keeps the vendor ceiling standing', () => {
    expect(nozzle?.ceiling).toBe(300);
    expect(nozzle?.grade).toBe('vendor-sheet');
  });

  it('records the conflict with the observed maximum', () => {
    expect(nozzle?.contradiction).toEqual({ vendorCeiling: 300, observedMax: 345 });
    expect(claim.notes.join(' ')).toMatch(/do not publish the higher number/);
  });
});

describe('4 — readings may establish a ceiling the vendor never published', () => {
  const obs = readings('fgf_1800_pro', 'nozzle-temp', '°C', [six(400, 5), six(410, 5), six(415, 5)]);

  it('turns an unknown pellet melt zone into a sourced number', () => {
    const nozzle = capabilityClaim('fgf_1800_pro', obs).axes.find(a => a.axis === 'nozzle-temp');
    expect(nozzle?.ceiling).toBe(440);
    expect(nozzle?.grade).toBe('field-calibrated');
    expect(nozzle?.applicability).toBe('stated');
  });

  it('still reports the machine as unverified overall', () => {
    const claim = capabilityClaim('fgf_1800_pro', obs);
    expect(claim.grade).toBe('unverified');
    expect(claim.publishable).toBe(true);
  });
});

describe('5 — an absent axis is not a gap', () => {
  it('excludes the open-frame chamber from the overall grade', () => {
    const claim = capabilityClaim('prusa_mk4', []);
    expect(claim.axes.find(a => a.axis === 'chamber-temp')?.applicability).toBe('absent');
    expect(claim.grade).toBe('vendor-sheet');
  });
});

describe('6 — the verdict engine consumes the field numbers', () => {
  it('gains nozzle headroom only after the floor measures it', () => {
    const obs = readings('fgf_1800_pro', 'nozzle-temp', '°C', [six(400, 5), six(410, 5), six(415, 5)]);
    expect(assessModelMaterial('fgf_1800_pro', 'PEEK').headroomC.nozzle).toBeNull();
    const after = assessWithField({ modelId: 'fgf_1800_pro', material: 'PEEK', observations: obs });
    expect(after.headroomC.nozzle).toBe(80);
    // Chamber unmeasured: the answer stays 'unknown' instead of flipping to a pass.
    expect(after.printable).toBe('unknown');
  });

  it('leaves untouched axes on the vendor sheet', () => {
    const obs = readings('bambu_x1c', 'nozzle-temp', '°C', [six(285), six(287), six(288)]);
    const overlaid = overlaidCapability('bambu_x1c', obs);
    expect(overlaid.nozzleMaxC.grade).toBe('field-calibrated');
    expect(overlaid.bedMaxC.grade).toBe('vendor-sheet');
    expect(overlaid.bedMaxC.max).toBe(120);
  });
});

describe('7 — the sheet reads honestly', () => {
  it('names the grade and the sample basis', () => {
    const obs = readings('bambu_x1c', 'nozzle-temp', '°C', [six(285), six(287), six(288)]);
    const line = describeClaim(capabilityClaim('bambu_x1c', obs));
    expect(line).toMatch(/field-calibrated, 3 unit\(s\) \/ 18 readings/);
    expect(line).toMatch(/overall vendor-sheet/);
  });

  it('makes a contradiction impossible to miss', () => {
    const obs = readings('bambu_x1c', 'nozzle-temp', '°C', [six(320), six(330), six(340)]);
    expect(describeClaim(capabilityClaim('bambu_x1c', obs))).toMatch(/above the 300 °C vendor ceiling/);
  });
});
