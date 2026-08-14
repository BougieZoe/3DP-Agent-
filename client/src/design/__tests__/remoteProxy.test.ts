import { describe, expect, it } from 'vitest';
import type { GeneratedModel } from '@shared/domain/generatedModel';
import { createRemoteProxyAdapter } from '../generator/remoteProxy';
import { generateDesign } from '../generator/service';

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

/** Route /health to a ready response so the facade's availability gate passes. */
function router(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/health')) return jsonResponse({ ok: true, ready: true });
    return handler(u, init);
  }) as typeof fetch;
}

const BASE_URL = 'https://cad.example.com';

describe('remoteProxy adapter (via generateDesign facade)', () => {
  it('posts to the hosted endpoint and decodes the STL', async () => {
    let requestedUrl = '';
    const adapter = createRemoteProxyAdapter({
      baseUrl: BASE_URL,
      fetchImpl: router(async (url) => {
        requestedUrl = String(url);
        return jsonResponse({ ok: true, model: makeModel(), stlBase64: stlBase64() });
      }),
    });
    const outcome = await generateDesign({ prompt: 'a 20mm cube' }, adapter);

    expect(requestedUrl).toBe(`${BASE_URL}/api/cad/generate`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.stlBytes.byteLength).toBe(134);
    expect(outcome.result.generatedModel?.id).toBe('remote-id-1');
  });

  it('sends an Authorization bearer header when apiKey is set', async () => {
    let capturedHeaders: Record<string, string> = {};
    const adapter = createRemoteProxyAdapter({
      baseUrl: BASE_URL,
      apiKey: 'secret',
      fetchImpl: router(async (_url, init) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return jsonResponse({ ok: true, model: makeModel(), stlBase64: stlBase64() });
      }),
    });
    await generateDesign({ prompt: 'x' }, adapter);

    expect(capturedHeaders.Authorization).toBe('Bearer secret');
  });

  it('does not forward llm or generatorSource (server owns generation config)', async () => {
    let capturedBody: Record<string, unknown> = {};
    const adapter = createRemoteProxyAdapter({
      baseUrl: BASE_URL,
      fetchImpl: router(async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ ok: true, model: makeModel(), stlBase64: stlBase64() });
      }),
    });
    await generateDesign(
      { prompt: 'x', baseModel: { generatedModelId: 'p', editInstruction: 'x' } },
      adapter,
    );

    expect(capturedBody.prompt).toBe('x');
    expect(capturedBody.baseModel).toBeDefined();
    expect(capturedBody.llm).toBeUndefined();
    expect(capturedBody.generatorSource).toBeUndefined();
  });

  it('maps bridge error responses to typed errors', async () => {
    const adapter = createRemoteProxyAdapter({
      baseUrl: BASE_URL,
      fetchImpl: router(async () =>
        jsonResponse(
          { ok: false, error: { code: 'generation-failed', detail: 'worker crashed' } },
          502,
        ),
      ),
    });
    const outcome = await generateDesign({ prompt: 'x' }, adapter);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({ code: 'generation-failed', detail: 'worker crashed' });
  });

  it('reports transport-unavailable on network failure', async () => {
    const adapter = createRemoteProxyAdapter({
      baseUrl: BASE_URL,
      fetchImpl: router(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    const outcome = await generateDesign({ prompt: 'x' }, adapter);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('transport-unavailable');
  });

  it('isAvailable reflects the hosted health endpoint', async () => {
    const up = createRemoteProxyAdapter({
      baseUrl: BASE_URL,
      fetchImpl: (async (url: unknown) => {
        if (String(url).endsWith('/health')) return jsonResponse({ ok: true, ready: true });
        throw new Error('unexpected url');
      }) as typeof fetch,
    });
    const down = createRemoteProxyAdapter({
      baseUrl: BASE_URL,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });

    expect(await up.isAvailable()).toBe(true);
    expect(await down.isAvailable()).toBe(false);
  });
});