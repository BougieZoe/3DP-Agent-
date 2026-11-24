import { describe, it, expect } from 'vitest';
import {
  describeTelemetry,
  isTelemetryComplete,
  mapFleetPayload,
  mapMoonraker,
  mapOctoPrint,
} from '../fleetTelemetry';

const AT = '2026-11-24T10:00:00.000Z';

/** A fully populated OctoPrint pair of responses (GET /api/printer + /api/job). */
function octoPrintPrinting() {
  return {
    printer: {
      state: {
        text: 'Printing',
        flags: { operational: true, printing: true, paused: false, error: false, ready: false },
      },
      temperature: { tool0: { actual: 215.4, target: 215 }, bed: { actual: 60.1, target: 60 } },
    },
    job: {
      job: { file: { name: 'benchy.gcode' }, filament: { tool0: { length: 2310.5 } } },
      progress: { completion: 42.53, printTimeLeft: 725 },
      state: 'Printing',
    },
  };
}

describe('mapOctoPrint', () => {
  it('maps a printing job with progress, temperatures, filament and eta', () => {
    const t = mapOctoPrint(octoPrintPrinting(), AT);

    expect(t.provider).toBe('octoprint');
    expect(t.state).toBe('printing');
    expect(t.rawState).toBe('Printing');
    expect(t.jobName).toBe('benchy.gcode');
    expect(t.progressPct).toBe(42.5);
    expect(t.nozzle).toEqual({ actualC: 215.4, targetC: 215 });
    expect(t.bed).toEqual({ actualC: 60.1, targetC: 60 });
    expect(t.filamentUsedMm).toBe(2310.5);
    expect(t.etaSeconds).toBe(725);
    expect(t.errorText).toBeNull();
    expect(t.notes).toEqual([]);
    expect(t.observedAt).toBe(AT);
  });

  it('leaves unreported temperature as null instead of 0', () => {
    const payload = octoPrintPrinting();
    // Wipe the nozzle reading the way a disconnected toolhead would report it.
    (payload.printer.temperature as Record<string, unknown>).tool0 = {};
    const t = mapOctoPrint(payload, AT);

    expect(t.nozzle.actualC).toBeNull();
    expect(t.nozzle.targetC).toBeNull();
    // Bed still reported, so the snapshot stays partially usable.
    expect(t.bed.actualC).toBe(60.1);
    expect(t.notes).toContain('nozzle temperature not reported');
    // A missing reading must never be mistaken for a cold-but-known nozzle.
    expect(t.nozzle.actualC).not.toBe(0);
  });

  it('treats a string error flag as a fault and keeps the message', () => {
    const payload = octoPrintPrinting();
    payload.printer.state = {
      text: 'Error:Printer halted. kill() called!',
      flags: { operational: false, printing: false, error: 'Printer halted. kill() called!' },
    };
    const t = mapOctoPrint(payload, AT);

    expect(t.state).toBe('error');
    expect(t.errorText).toBe('Printer halted. kill() called!');
  });

  it('rejects out-of-range progress rather than clamping it', () => {
    const payload = octoPrintPrinting();
    payload.job.progress.completion = 150;
    const t = mapOctoPrint(payload, AT);

    expect(t.progressPct).toBeNull();
    expect(t.notes).toContain('progress not reported');
  });

  it('keeps an unrecognized state as unknown with the raw string preserved', () => {
    const payload = octoPrintPrinting();
    payload.printer.state = { text: 'Sending file', flags: {} };
    const t = mapOctoPrint(payload, AT);

    expect(t.state).toBe('unknown');
    // Unknown must stay distinguishable from a genuine idle machine.
    expect(t.rawState).toBe('Sending file');
    expect(isTelemetryComplete(t)).toBe(false);
  });

  it('survives a missing job payload and says so', () => {
    const payload = octoPrintPrinting();
    const t = mapOctoPrint({ printer: payload.printer }, AT);

    expect(t.state).toBe('printing');
    expect(t.jobName).toBeNull();
    expect(t.progressPct).toBeNull();
    expect(t.notes).toContain('job payload missing');
  });
});

describe('mapMoonraker', () => {
  function moonraker(overrides: Record<string, unknown> = {}) {
    return {
      result: {
        status: {
          print_stats: { state: 'printing', filename: 'bracket.gcode', filament_used: 812.4, message: '' },
          extruder: { temperature: 240.2, target: 240 },
          heater_bed: { temperature: 100.5, target: 100 },
          virtual_sdcard: { progress: 0.4251 },
          ...overrides,
        },
      },
    };
  }

  it('maps a printing job and scales ratio progress to percent', () => {
    const t = mapMoonraker(moonraker(), AT);

    expect(t.provider).toBe('moonraker');
    expect(t.state).toBe('printing');
    expect(t.progressPct).toBe(42.5);
    expect(t.nozzle.actualC).toBe(240.2);
    expect(t.bed.actualC).toBe(100.5);
    expect(t.filamentUsedMm).toBe(812.4);
    expect(t.jobName).toBe('bracket.gcode');
  });

  it('never invents an ETA from elapsed-only data', () => {
    const t = mapMoonraker(moonraker(), AT);

    expect(t.etaSeconds).toBeNull();
    expect(t.notes.some((n) => n.includes('remaining time not reported'))).toBe(true);
  });

  it('maps complete and error states', () => {
    const done = mapMoonraker(moonraker({ print_stats: { state: 'complete', filename: 'a.gcode' } }), AT);
    expect(done.state).toBe('completed');

    const failed = mapMoonraker(
      moonraker({ print_stats: { state: 'error', filename: 'a.gcode', message: 'MCU shutdown' } }),
      AT,
    );
    expect(failed.state).toBe('error');
    expect(failed.errorText).toBe('MCU shutdown');
  });

  it('flags a cancelled job without pretending the machine is completed', () => {
    const t = mapMoonraker(moonraker({ print_stats: { state: 'cancelled', filename: 'a.gcode' } }), AT);

    expect(t.state).toBe('idle');
    expect(t.rawState).toBe('cancelled');
    expect(t.notes).toContain('last job was cancelled');
  });

  it('returns unknown when the status object is missing', () => {
    const t = mapMoonraker({ result: {} }, AT);

    expect(t.state).toBe('unknown');
    expect(t.progressPct).toBeNull();
    expect(t.notes.some((n) => n.includes('status object missing'))).toBe(true);
  });
});

describe('mapFleetPayload dispatch', () => {
  it('routes each provider to its own dialect', () => {
    expect(mapFleetPayload('octoprint', octoPrintPrinting(), AT).provider).toBe('octoprint');
    expect(mapFleetPayload('moonraker', { result: { status: {} } }, AT).provider).toBe('moonraker');
  });
});

describe('describeTelemetry', () => {
  it('renders a one-line shop-floor summary', () => {
    const line = describeTelemetry(mapOctoPrint(octoPrintPrinting(), AT));

    expect(line).toContain('printing 42.5%');
    expect(line).toContain('nozzle 215.4/215°C');
    expect(line).toContain('bed 60.1/60°C');
    expect(line).toContain('ETA 12m');
    expect(line).toContain('benchy.gcode');
  });

  it('shows the raw state when the state is unknown', () => {
    const t = mapOctoPrint(
      { printer: { state: { text: 'Sending file', flags: {} } } },
      AT,
    );
    expect(describeTelemetry(t)).toContain('unknown (Sending file)');
  });
});
