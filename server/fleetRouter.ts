/**
 * Fleet telemetry proxy — the only place the app talks to a real printer
 * controller directly.
 *
 * The browser never receives the controller API key: it posts a baseUrl + key
 * once to this route, the server performs the upstream call with a hard timeout
 * and returns a normalized snapshot. Errors are classified instead of collapsed
 * into "failed", because "wrong key" and "printer is off" need different fixes.
 */

import express, { Router, type Request, type Response } from 'express';
import {
  FLEET_PROVIDER_IDS,
  mapFleetPayload,
  type FleetProviderId,
  type PrinterTelemetry,
} from '../shared/domain/fleetTelemetry';

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Link-local metadata endpoints are never a printer. Everything else on the LAN
 * is allowed on purpose: the controllers this talks to live on 192.168.x.x and
 * friends, so a blanket private-range ban would block the main use case.
 */
const BLOCKED_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal']);

export type FleetErrorKind = 'invalid-request' | 'unreachable' | 'unauthorized' | 'bad-response';

export interface FleetProbeError {
  kind: FleetErrorKind;
  detail: string;
}

export type FleetProbeResult =
  | { ok: true; telemetry: PrinterTelemetry }
  | { ok: false; error: FleetProbeError };

export interface FleetProbeDeps {
  fetchImpl?: typeof fetch;
  /** Injected clock keeps tests deterministic. */
  now?: () => Date;
  timeoutMs?: number;
}

export interface FleetProbeRequest {
  provider?: unknown;
  baseUrl?: unknown;
  /** Controller API key. Never logged, never echoed back. */
  apiKey?: unknown;
}

function isProviderId(value: unknown): value is FleetProviderId {
  return typeof value === 'string' && (FLEET_PROVIDER_IDS as readonly string[]).includes(value);
}

function normalizeBaseUrl(raw: unknown): { ok: true; url: string } | { ok: false; detail: string } {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, detail: 'baseUrl is required' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, detail: 'baseUrl is not a valid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, detail: `unsupported protocol ${parsed.protocol}` };
  }
  if (BLOCKED_HOSTS.has(parsed.hostname)) {
    return { ok: false, detail: 'refusing link-local metadata host' };
  }

  const url = parsed.toString().replace(/\/+$/, '');
  return { ok: true, url };
}

function pickBodyText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  deps: Required<Pick<FleetProbeDeps, 'fetchImpl'>> & { timeoutMs: number },
): Promise<{ ok: true; json: unknown } | { ok: false; error: FleetProbeError }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);

  try {
    const response = await deps.fetchImpl(url, { ...init, signal: controller.signal });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: {
          kind: 'unauthorized',
          detail: `controller rejected the credentials (HTTP ${response.status})`,
        },
      };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const hint =
        response.status === 409
          ? ' (controller reports no printer attached or not connected)'
          : '';
      return {
        ok: false,
        error: {
          kind: 'bad-response',
          detail: `upstream HTTP ${response.status}${hint}${body ? `: ${pickBodyText(body)}` : ''}`,
        },
      };
    }

    try {
      return { ok: true, json: (await response.json()) as unknown };
    } catch {
      return {
        ok: false,
        error: { kind: 'bad-response', detail: 'upstream did not return JSON' },
      };
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    const detail = aborted
      ? `no response from controller within ${deps.timeoutMs}ms`
      : `cannot reach controller: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, error: { kind: 'unreachable', detail } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe one controller and normalize its answer. Pure enough to unit-test with
 * an injected fetch: no express, no globals, no clocks.
 */
export async function probeFleet(
  request: FleetProbeRequest,
  deps: FleetProbeDeps = {},
): Promise<FleetProbeResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = deps.now ?? (() => new Date());

  if (!isProviderId(request.provider)) {
    return {
      ok: false,
      error: {
        kind: 'invalid-request',
        detail: `provider must be one of ${FLEET_PROVIDER_IDS.join(', ')}`,
      },
    };
  }

  const normalized = normalizeBaseUrl(request.baseUrl);
  if (!normalized.ok) {
    return { ok: false, error: { kind: 'invalid-request', detail: normalized.detail } };
  }

  const apiKey = typeof request.apiKey === 'string' && request.apiKey.length > 0 ? request.apiKey : null;
  const base = normalized.url;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey !== null) headers['X-Api-Key'] = apiKey;

  const observedAt = now().toISOString();
  const callDeps = { fetchImpl, timeoutMs };

  if (request.provider === 'octoprint') {
    const [printerRes, jobRes] = await Promise.all([
      fetchJson(`${base}/api/printer`, { method: 'GET', headers }, callDeps),
      fetchJson(`${base}/api/job`, { method: 'GET', headers }, callDeps),
    ]);

    if (!printerRes.ok) return { ok: false, error: printerRes.error };

    const telemetry = mapFleetPayload(
      'octoprint',
      { printer: printerRes.json, job: jobRes.ok ? jobRes.json : undefined },
      observedAt,
      new URL(base).host,
    );

    if (!jobRes.ok) telemetry.notes.push(`job endpoint failed: ${jobRes.error.kind}`);

    return { ok: true, telemetry };
  }

  const query =
    '/printer/objects/query?print_stats&extruder&heater_bed&virtual_sdcard&display_status';
  const moonrakerRes = await fetchJson(`${base}${query}`, { method: 'GET', headers }, callDeps);
  if (!moonrakerRes.ok) return { ok: false, error: moonrakerRes.error };

  const telemetry = mapFleetPayload('moonraker', moonrakerRes.json, observedAt, new URL(base).host);
  return { ok: true, telemetry };
}

function httpStatusFor(kind: FleetErrorKind): number {
  switch (kind) {
    case 'invalid-request':
      return 400;
    case 'unauthorized':
      return 401;
    default:
      return 502;
  }
}

export function createFleetRouter(deps: FleetProbeDeps = {}): Router {
  const router = Router();
  router.use(express.json({ limit: '64kb' }));

  router.get('/providers', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      providers: [
        { id: 'octoprint', label: 'OctoPrint', hint: 'http://octopi.local' },
        { id: 'moonraker', label: 'Klipper (Moonraker)', hint: 'http://mainsail.local' },
      ],
    });
  });

  router.post('/snapshot', async (req: Request, res: Response) => {
    const result = await probeFleet((req.body ?? {}) as FleetProbeRequest, deps);

    if (!result.ok) {
      res
        .status(httpStatusFor(result.error.kind))
        .json({ ok: false, error: { code: result.error.kind, detail: result.error.detail } });
      return;
    }

    res.json({ ok: true, telemetry: result.telemetry });
  });

  return router;
}
