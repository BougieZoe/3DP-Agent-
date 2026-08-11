import { describe, expect, it } from 'vitest';
import type { GeneratedModel } from '@shared/domain/generatedModel';
import { createRemoteProxyTransport } from '../transport/remoteProxy';

/** Smallest valid binary STL: 80-byte header + facet count + one 50-byte facet. */
function makeBinaryStl(): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + 50);
  const view = new DataView(buffer);
  view.setUint32(80, 1, true); // facet count
  view.setFloat32(84 + 8, 1, true); // normal z
  view.setFloat32(84 + 12 + 4, 10, true); // v1 x
  view.setFloat32(84 + 12 + 12 + 8, 10, true); // v2 y
  return buffer;
}

function makeModel(overrides: Partial<GeneratedModel> = {}): GeneratedModel {
  return {
    id: 'remote-id-1',
    origin: 'cad-generation',
    prompt: 'a 20mm cube',
    summary: 'a 20mm cube',
    params: { prompt: 'a 20mm cube', assumptions: [] },
    artifacts: [
      {
        kind: 'stl',
        role: 'sidecar',
        format: 'binary-stl',
        units: 'mm',
        location: { type: 'inline-bytes' },
        sizeBytes: 134,
      },
    ],
    provenance: { skill: 'cad (earthtojake/text-to-cad)', generator: 'build123d', executedBy: 'remote-proxy' },
    createdAt: new Date(0).toISOString(),
    durationMs: 1234,
    warnings: [],
    ...overrides,
  };
}

function stlBase64(): string {
  return Buffer.from(makeBinaryStl()).toString('base64');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const BASE_URL = 'https://cad.example.com';

describe('remoteProxy transport', () => {
  it('posts to the hosted endpoint and decodes the STL', async () => {
    let requestedUrl = '';
    const fetchImpl = (async (url: unknown) => {
      requestedUrl = String(url);
      return jsonResponse({ ok: true, model: makeModel(), stlBase64: stlBase64() });
    }) as typeof fetch;

    const transport = createRemoteProxyTransport({ baseUrl: BASE_URL, fetchImpl });
    const outcome = await transport.generate({ prompt: 'a 20mm cube' });

    expect(requestedUrl).toBe(`${BASE_URL}/api/cad/generate`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.stlBytes.byteLength).toBe(134);
    expect(outcome.result.model.id).toBe('remote-id-1');
  });

  it('sends an Authorization bearer header when apiKey is set', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return jsonResponse({ ok: true, model: makeModel(), stlBase64: stlBase64() });
    }) as typeof fetch;

    const transport = createRemoteProxyTransport({ baseUrl: BASE_URL, apiKey: 'secret', fetchImpl });
    await transport.generate({ prompt: 'x' });

    expect(capturedHeaders.Authorization).toBe('Bearer secret');
  });

  it('does not forward llm or generatorSource (server owns generation config)', async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ ok: true, model: makeModel(), stlBase64: stlBase64() });
    }) as typeof fetch;

    const transport = createRemoteProxyTransport({ baseUrl: BASE_URL, fetchImpl });
    await transport.generate({ prompt: 'x', baseModel: { generatedModelId: 'p', editInstruction: 'x' } });

    expect(capturedBody.prompt).toBe('x');
    expect(capturedBody.baseModel).toBeDefined();
    expect(capturedBody.llm).toBeUndefined();
    expect(capturedBody.generatorSource).toBeUndefined();
  });

  it('maps bridge error responses to typed errors', async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { ok: false, error: { code: 'generation-failed', detail: 'worker crashed' } },
        502,
      )) as typeof fetch;

    const transport = createRemoteProxyTransport({ baseUrl: BASE_URL, fetchImpl });
    const outcome = await transport.generate({ prompt: 'x' });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({ code: 'generation-failed', detail: 'worker crashed' });
  });

  it('reports transport-unavailable on network failure', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    const transport = createRemoteProxyTransport({ baseUrl: BASE_URL, fetchImpl });
    const outcome = await transport.generate({ prompt: 'x' });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('transport-unavailable');
  });

  it('isAvailable reflects the hosted health endpoint', async () => {
    const up = createRemoteProxyTransport({
      baseUrl: BASE_URL,
      fetchImpl: (async (url: unknown) => {
        if (String(url).endsWith('/health')) return jsonResponse({ ok: true, ready: true });
        throw new Error('unexpected url');
      }) as typeof fetch,
    });
    const down = createRemoteProxyTransport({
      baseUrl: BASE_URL,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });

    expect(await up.isAvailable()).toBe(true);
    expect(await down.isAvailable()).toBe(false);
  });
});
