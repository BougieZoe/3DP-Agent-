/**
 * Fleet telemetry — one normalized snapshot out of a real printer controller.
 *
 * Two upstream dialects are supported: OctoPrint (REST) and Moonraker (Klipper).
 * Both map into the same PrinterTelemetry so the shop floor can be fed by a real
 * device instead of the localStorage sandbox the farm view used before.
 *
 * Doctrine, unchanged from the rest of shared/domain: a value the controller did
 * not report becomes `null`, never 0; a state we cannot classify becomes
 * 'unknown' with the raw string preserved. On a shop floor, "idle" and "we have
 * no idea" must never render the same.
 */

export type FleetProviderId = 'octoprint' | 'moonraker';

export const FLEET_PROVIDER_IDS: readonly FleetProviderId[] = ['octoprint', 'moonraker'];

export type TelemetryState =
  | 'idle'
  | 'printing'
  | 'paused'
  | 'completed'
  | 'error'
  | 'offline'
  | 'unknown';

export interface TelemetryTemperature {
  actualC: number | null;
  targetC: number | null;
}

export interface PrinterTelemetry {
  provider: FleetProviderId;
  /** Provider-side identity: OctoPrint printer name, Moonraker hostname. */
  printerKey: string;
  state: TelemetryState;
  /** Upstream state string, verbatim, kept for triage. */
  rawState: string | null;
  jobName: string | null;
  /** 0-100. Null when upstream reports nothing usable. */
  progressPct: number | null;
  nozzle: TelemetryTemperature;
  bed: TelemetryTemperature;
  filamentUsedMm: number | null;
  etaSeconds: number | null;
  errorText: string | null;
  observedAt: string;
  /** What upstream did not report or what we deliberately discarded. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Upstream value already expressed on a 0-100 scale (OctoPrint). */
function pct(value: unknown): number | null {
  const n = num(value);
  if (n === null || n < 0 || n > 100) return null;
  return Math.round(n * 10) / 10;
}

/** Upstream value expressed as a 0-1 ratio (Moonraker). */
function ratioPct(value: unknown): number | null {
  const n = num(value);
  if (n === null || n < 0 || n > 1) return null;
  return Math.round(n * 1000) / 10;
}

function tempOf(value: unknown): TelemetryTemperature {
  const rec = asRecord(value);
  if (!rec) return { actualC: null, targetC: null };
  return { actualC: num(rec.actual), targetC: num(rec.target) };
}

function temperatureMissing(t: TelemetryTemperature): boolean {
  return t.actualC === null && t.targetC === null;
}

/**
 * Moonraker reports heater state as { temperature, target }, not OctoPrint's
 * { actual, target }. Reading it with the OctoPrint shape silently yields null
 * temperatures, so the two dialects get separate readers.
 */
function moonrakerTempOf(value: unknown): TelemetryTemperature {
  const rec = asRecord(value);
  if (!rec) return { actualC: null, targetC: null };
  return {
    actualC: num(rec.temperature) ?? num(rec.actual),
    targetC: num(rec.target),
  };
}

function emptyTelemetry(
  provider: FleetProviderId,
  printerKey: string,
  observedAt: string,
  notes: string[],
): PrinterTelemetry {
  return {
    provider,
    printerKey,
    state: 'unknown',
    rawState: null,
    jobName: null,
    progressPct: null,
    nozzle: { actualC: null, targetC: null },
    bed: { actualC: null, targetC: null },
    filamentUsedMm: null,
    etaSeconds: null,
    errorText: null,
    observedAt,
    notes,
  };
}

// ---------------------------------------------------------------------------
// OctoPrint
// ---------------------------------------------------------------------------

export interface OctoPrintPayload {
  /** Body of GET /api/printer */
  printer?: unknown;
  /** Body of GET /api/job */
  job?: unknown;
}

interface OctoPrintStateReading {
  state: TelemetryState;
  raw: string | null;
  error: string | null;
}

function readOctoPrintState(printer: Record<string, unknown> | null): OctoPrintStateReading {
  if (!printer) return { state: 'unknown', raw: null, error: null };

  const stateRec = asRecord(printer.state);
  const raw = str(stateRec?.text);
  const flags = asRecord(stateRec?.flags);
  const errorText = str(stateRec?.error);

  const flag = (key: string): boolean => flags?.[key] === true;

  // OctoPrint puts the failure message in flags.error (string) as well as
  // state.error; either one means the controller is in a fault.
  const errorFlag = flags?.error;
  const errorFromFlag =
    typeof errorFlag === 'string' && errorFlag.length > 0 ? errorFlag : null;

  if (flag('error') || flag('closedOrError') || errorFromFlag !== null || errorText !== null) {
    return { state: 'error', raw, error: errorText ?? errorFromFlag };
  }
  if (flag('paused') || flag('pausing')) return { state: 'paused', raw, error: null };
  if (flag('printing') || flag('starting') || flag('resuming') || flag('finishing')) {
    return { state: 'printing', raw, error: null };
  }
  if (flag('ready') || flag('operational') || flag('cancelling')) {
    return { state: 'idle', raw, error: null };
  }

  // No usable flags (older/plugin variants): fall back to the text label only
  // for exact known words, never by substring guessing.
  const lowered = raw?.toLowerCase() ?? '';
  if (lowered === 'printing') return { state: 'printing', raw, error: null };
  if (lowered === 'paused') return { state: 'paused', raw, error: null };
  if (lowered === 'operational' || lowered === 'ready' || lowered === 'idle') {
    return { state: 'idle', raw, error: null };
  }
  if (lowered === 'offline' || lowered === 'closed') return { state: 'offline', raw, error: null };

  return { state: 'unknown', raw, error: errorText };
}

export function mapOctoPrint(
  payload: OctoPrintPayload,
  observedAt: string,
  printerKey = 'octoprint',
): PrinterTelemetry {
  const notes: string[] = [];
  const printer = asRecord(payload.printer);
  const job = asRecord(payload.job);

  if (printer === null) notes.push('printer payload missing');
  if (job === null) notes.push('job payload missing');

  const reading = readOctoPrintState(printer);

  const temperatures = asRecord(printer?.temperature);
  const nozzle = tempOf(temperatures?.tool0);
  const bed = tempOf(temperatures?.bed);
  if (temperatureMissing(nozzle)) notes.push('nozzle temperature not reported');
  if (temperatureMissing(bed)) notes.push('bed temperature not reported');

  const jobRec = asRecord(job?.job);
  const fileRec = asRecord(jobRec?.file);
  const progressRec = asRecord(job?.progress);
  const filamentRec = asRecord(jobRec?.filament);
  const toolFilament = asRecord(filamentRec?.tool0);

  const progressPct = pct(progressRec?.completion);
  const etaSeconds = num(progressRec?.printTimeLeft);
  const jobName = str(fileRec?.name);
  const filamentUsedMm = num(toolFilament?.length);

  if (job !== null) {
    if (progressPct === null) notes.push('progress not reported');
    if (etaSeconds === null) notes.push('remaining time not reported');
    if (filamentUsedMm === null) notes.push('filament usage not reported');
  }

  return {
    provider: 'octoprint',
    printerKey,
    state: reading.state,
    rawState: reading.raw,
    jobName,
    progressPct,
    nozzle,
    bed,
    filamentUsedMm,
    etaSeconds,
    errorText: reading.error,
    observedAt,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Moonraker (Klipper)
// ---------------------------------------------------------------------------

const MOONRAKER_STATES: Record<string, TelemetryState> = {
  standby: 'idle',
  printing: 'printing',
  paused: 'paused',
  complete: 'completed',
  error: 'error',
  cancelled: 'idle',
};

export function mapMoonraker(
  payload: unknown,
  observedAt: string,
  printerKey = 'moonraker',
): PrinterTelemetry {
  const root = asRecord(payload);
  const result = asRecord(root?.result);
  const status = asRecord(result?.status) ?? asRecord(root?.status);

  if (!status) {
    return emptyTelemetry('moonraker', printerKey, observedAt, [
      'moonraker status object missing (expected result.status)',
    ]);
  }

  const notes: string[] = [];
  const printStats = asRecord(status.print_stats);
  const rawState = str(printStats?.state);
  const state = rawState === null ? 'unknown' : (MOONRAKER_STATES[rawState] ?? 'unknown');

  if (rawState === null) notes.push('print_stats.state not reported');
  else if (state === 'unknown') notes.push(`unrecognized klipper state "${rawState}"`);
  if (rawState === 'cancelled') notes.push('last job was cancelled');

  const nozzle = moonrakerTempOf(status.extruder);
  const bed = moonrakerTempOf(status.heater_bed);
  if (temperatureMissing(nozzle)) notes.push('extruder temperature not reported');
  if (temperatureMissing(bed)) notes.push('bed temperature not reported');

  // virtual_sdcard.progress is the authoritative print progress; display_status
  // mirrors it for Mainsail-style UIs and is only a fallback.
  const virtualSd = asRecord(status.virtual_sdcard);
  const displayStatus = asRecord(status.display_status);
  const progressPct = ratioPct(virtualSd?.progress) ?? ratioPct(displayStatus?.progress);
  if (progressPct === null) notes.push('progress not reported');

  const jobName = str(printStats?.filename);
  const filamentUsedMm = num(printStats?.filament_used);
  if (filamentUsedMm === null) notes.push('filament usage not reported');

  // Moonraker exposes elapsed time, not remaining time. We refuse to derive an
  // ETA by dividing progress: at low progress that number is noise, and a wrong
  // ETA on the floor is worse than no ETA.
  notes.push('remaining time not reported (moonraker exposes elapsed only)');

  const message = str(printStats?.message);
  if (state === 'error' && message === null) notes.push('error state without message');

  return {
    provider: 'moonraker',
    printerKey,
    state,
    rawState,
    jobName,
    progressPct,
    nozzle,
    bed,
    filamentUsedMm,
    etaSeconds: null,
    errorText: state === 'error' ? message : null,
    observedAt,
    notes,
  };
}

// ---------------------------------------------------------------------------
// dispatch + presentation
// ---------------------------------------------------------------------------

export function mapFleetPayload(
  provider: FleetProviderId,
  payload: unknown,
  observedAt: string,
  printerKey?: string,
): PrinterTelemetry {
  if (provider === 'octoprint') {
    const rec = asRecord(payload) ?? {};
    return mapOctoPrint(
      { printer: rec.printer, job: rec.job },
      observedAt,
      printerKey ?? 'octoprint',
    );
  }
  return mapMoonraker(payload, observedAt, printerKey ?? 'moonraker');
}

function formatTemp(value: number | null): string {
  return value === null ? '?' : `${Math.round(value * 10) / 10}`;
}

function formatEta(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `ETA ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `ETA ${hours}h${rest.toString().padStart(2, '0')}m`;
}

/** One-line shop-floor summary. Missing fields are skipped, never zero-filled. */
export function describeTelemetry(t: PrinterTelemetry): string {
  const parts: string[] = [];

  const stateLabel = t.state === 'unknown' && t.rawState !== null ? `unknown (${t.rawState})` : t.state;
  if (t.state === 'printing' && t.progressPct !== null) {
    parts.push(`${stateLabel} ${t.progressPct}%`);
  } else {
    parts.push(stateLabel);
  }

  if (!temperatureMissing(t.nozzle)) {
    parts.push(`nozzle ${formatTemp(t.nozzle.actualC)}/${formatTemp(t.nozzle.targetC)}°C`);
  }
  if (!temperatureMissing(t.bed)) {
    parts.push(`bed ${formatTemp(t.bed.actualC)}/${formatTemp(t.bed.targetC)}°C`);
  }

  const eta = formatEta(t.etaSeconds);
  if (eta) parts.push(eta);

  if (t.jobName) parts.push(t.jobName);
  if (t.state === 'error' && t.errorText) parts.push(`error: ${t.errorText}`);

  return parts.join(' · ');
}

/** True when the snapshot is complete enough to be trusted for a verdict. */
export function isTelemetryComplete(t: PrinterTelemetry): boolean {
  if (t.state === 'unknown' || t.state === 'offline') return false;
  if (temperatureMissing(t.nozzle) && temperatureMissing(t.bed)) return false;
  return true;
}
