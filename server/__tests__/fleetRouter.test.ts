import { describe, it, expect } from 'vitest';
import { probeFleet, type FleetProbeDeps } from '../fleetRouter';

const AT = new Date('2026-11-24T10:00:00.000Z');

interface RouteReply {
  status?: number;
  body?: unknown;
  /** Simulate a network failure (DNS refused, connection reset). */
  throws?: Error;
  /** Simulate the hard timeout firing. */
  aborts?: boolean;
}

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

/**
 * Fake fetch keyed by path suffix. Returns a recorder so tests can assert the
 * API key travels in the header and never in the URL.
 */
function fakeFetch(routes: Record<string, RouteReply>) {
  const calls: RecordedCall[] = [];

  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });

    const path = new URL(url).pathname + new URL(url).search;
    // includes(), not endsWith(): the moonraker query string follows the path.
    const key = Object.keys(routes).find((suffix) => path.includes(suffix));
    if (!key) throw new Error(`unexpected request: ${path}`);

    const reply = routes[key];
    if (!reply) throw new Error('unreachable');
    if (reply.throws) throw reply.throws;
    if (reply.aborts) {
      const abort = new Error('The operation was aborted.');
      abort.name = 'AbortError';
      throw abort;
    }

    const status = reply.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => reply.body,
      text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? '')),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function deps(impl: typeof fetch): FleetProbeDeps {
  return { fetchImpl: impl, now: () => AT, timeoutMs: 1_000 };
}

const OCTO_PRINTER = {
  state: { text: 'Printing', flags: { operational: true, printing: true } },
  temperature: { tool0: { actual: 210, target: 210 }, bed: { actual: 60, target: 60 } },
};

const OCTO_JOB = {
  job: { file: { name: 'part.gcode' }, filament: { tool0: { length: 1500 } } },
  progress: { completion: 10, printTimeLeft: 600 },
};

describe('probeFleet / octoprint', () => {
  it('normalizes a live controller and sends the key as a header, not in the URL', async () => {
    const { impl, calls } = fakeFetch({
      '/api/printer': { body: OCTO_PRINTER },
      '/api/job': { body: OCTO_JOB },
    });

    const result = await probeFleet(
      { provider: 'octoprint', baseUrl: 'http://octopi.local/', apiKey: 'SECRET123' },
      deps(impl),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.telemetry.state).toBe('printing');
    expect(result.telemetry.progressPct).toBe(10);
    expect(result.telemetry.nozzle.actualC).toBe(210);
    expect(result.telemetry.printerKey).toBe('octopi.local');
    expect(result.telemetry.observedAt).toBe(AT.toISOString());

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.headers['X-Api-Key']).toBe('SECRET123');
      // The credential must never leak into a URL that could be logged.
      expect(call.url).not.toContain('SECRET123');
    }
    // Trailing slash is normalized so we do not build //api/printer.
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/api/printer', '/api/job']);
  });

  it('classifies a rejected key as unauthorized', async () => {
    const { impl } = fakeFetch({
      '/api/printer': { status: 401, body: 'Unauthorized' },
      '/api/job': { status: 401, body: 'Unauthorized' },
    });

    const result = await probeFleet(
      { provider: 'octoprint', baseUrl: 'http://octopi.local' },
      deps(impl),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthorized');
  });

  it('explains a 409 as "no printer attached" rather than a generic failure', async () => {
    const { impl } = fakeFetch({
      '/api/printer': { status: 409, body: { error: 'Printer is not operational' } },
      '/api/job': { body: OCTO_JOB },
    });

    const result = await probeFleet(
      { provider: 'octoprint', baseUrl: 'http://octopi.local' },
      deps(impl),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('bad-response');
    expect(result.error.detail).toContain('no printer attached');
  });

  it('still returns a snapshot when only the job endpoint fails', async () => {
    const { impl } = fakeFetch({
      '/api/printer': { body: OCTO_PRINTER },
      '/api/job': { status: 500, body: 'boom' },
    });

    const result = await probeFleet(
      { provider: 'octoprint', baseUrl: 'http://octopi.local' },
      deps(impl),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.telemetry.state).toBe('printing');
    expect(result.telemetry.progressPct).toBeNull();
    expect(result.telemetry.notes.some((n) => n.includes('job endpoint failed'))).toBe(true);
  });

  it('surfaces a timeout as unreachable', async () => {
    const { impl } = fakeFetch({
      '/api/printer': { aborts: true },
      '/api/job': { aborts: true },
    });

    const result = await probeFleet(
      { provider: 'octoprint', baseUrl: 'http://octopi.local' },
      deps(impl),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unreachable');
    expect(result.error.detail).toContain('1000ms');
  });

  it('surfaces a connection error as unreachable', async () => {
    const { impl } = fakeFetch({
      '/api/printer': { throws: new Error('connect ECONNREFUSED 192.168.1.50:80') },
      '/api/job': { throws: new Error('connect ECONNREFUSED 192.168.1.50:80') },
    });

    const result = await probeFleet(
      { provider: 'octoprint', baseUrl: 'http://192.168.1.50' },
      deps(impl),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unreachable');
    expect(result.error.detail).toContain('ECONNREFUSED');
  });

  it('rejects a non-JSON body instead of guessing', async () => {
    const { impl } = fakeFetch({
      '/api/printer': { body: '<html>login</html>' },
      '/api/job': { body: OCTO_JOB },
    });

    // html body parses as JSON failure only if json() rejects; emulate that.
    const strict = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await impl(input, init);
      return {
        ...response,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await probeFleet(
      { provider: 'octoprint', baseUrl: 'http://octopi.local' },
      deps(strict),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('bad-response');
    expect(result.error.detail).toContain('did not return JSON');
  });
});

describe('probeFleet / moonraker', () => {
  it('queries the object endpoint and maps the answer', async () => {
    const { impl, calls } = fakeFetch({
      '/printer/objects/query': {
        body: {
          result: {
            status: {
              print_stats: { state: 'printing', filename: 'x.gcode', filament_used: 400 },
              extruder: { temperature: 250, target: 250 },
              heater_bed: { temperature: 110, target: 110 },
              virtual_sdcard: { progress: 0.5 },
            },
          },
        },
      },
    });

    const result = await probeFleet(
      { provider: 'moonraker', baseUrl: 'http://mainsail.local' },
      deps(impl),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.telemetry.provider).toBe('moonraker');
    expect(result.telemetry.state).toBe('printing');
    expect(result.telemetry.progressPct).toBe(50);
    expect(calls[0]!.url).toContain('print_stats');
  });
});

describe('probeFleet / request validation', () => {
  it('rejects an unknown provider', async () => {
    const { impl } = fakeFetch({});
    const result = await probeFleet({ provider: 'cura', baseUrl: 'http://x.local' }, deps(impl));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-request');
    expect(result.error.detail).toContain('octoprint, moonraker');
  });

  it('rejects a missing baseUrl', async () => {
    const { impl } = fakeFetch({});
    const result = await probeFleet({ provider: 'octoprint' }, deps(impl));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-request');
    expect(result.error.detail).toContain('baseUrl is required');
  });

  it('rejects non-http protocols', async () => {
    const { impl } = fakeFetch({});
    const result = await probeFleet(
      { provider: 'octoprint', baseUrl: 'file:///etc/passwd' },
      deps(impl),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-request');
    expect(result.error.detail).toContain('unsupported protocol');
  });

  it('refuses link-local metadata hosts', async () => {
    const { impl } = fakeFetch({});
    const result = await probeFleet(
      { provider: 'octoprint', baseUrl: 'http://169.254.169.254' },
      deps(impl),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-request');
    expect(result.error.detail).toContain('link-local');
  });

  it('never touches the network for an invalid request', async () => {
    const { impl, calls } = fakeFetch({});
    await probeFleet({ provider: 'nope', baseUrl: 'http://x.local' }, deps(impl));
    expect(calls).toHaveLength(0);
  });
});
