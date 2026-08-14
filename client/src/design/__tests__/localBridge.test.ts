import { describe, expect, it } from 'vitest';
import type { GeneratedModel } from '@shared/domain/generatedModel';
import { createLocalBridgeTransport } from '../transport/localBridge';

/** Smallest valid binary STL: 80-byte header + facet count + one 50-byte facet. */
function makeBinaryStl(): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + 50);
  const view = new DataView(buffer);
  view.setUint32(80, 1, true); // facet count
  // facet: normal (0,0,1), v0 (0,0,0), v1 (10,0,0), v2 (0,10,0)
  view.setFloat32(84 + 8, 1, true); // normal z
  view.setFloat32(84 + 12 + 4, 10, true); // v1 x
  view.setFloat32(84 + 12 + 12 + 8, 10, true); // v2 y
  return buffer;
}

function makeModel(overrides: Partial<GeneratedModel> = {}): GeneratedModel {
  return {
    id: 'test-id-1',
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
    provenance: { skill: 'cad (earthtojake/text-to-cad)', generator: 'build123d', executedBy: 'local-bridge' },
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

describe('localBridge transport', () => {
  it('returns decoded STL bytes and model metadata on success', async () => {
    const model = makeModel();
    const fetchImpl = (async () =>
      jsonResponse({ ok: true, model, stlBase64: stlBase64() })) as typeof fetch;

    const transport = createLocalBridgeTransport({ endpoint: 'http://x/api', fetchImpl });
    const outcome = await transport.generate({ prompt: 'a 20mm cube' });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.model.id).toBe('test-id-1');
    expect(outcome.result.stlBytes.byteLength).toBe(134);
  });

  it('forwards prompt and baseModel in the request body', async () => {
    let captured: unknown;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ ok: true, model: makeModel(), stlBase64: stlBase64() });
    }) as typeof fetch;

    const transport = createLocalBridgeTransport({ endpoint: 'http://x/api', fetchImpl });
    await transport.generate({
      prompt: 'make wall 3mm',
      baseModel: { generatedModelId: 'parent-1', editInstruction: 'make wall 3mm' },
    });

    const body = captured as { prompt: string; baseModel: { generatedModelId: string } };
    expect(body.prompt).toBe('make wall 3mm');
    expect(body.baseModel.generatedModelId).toBe('parent-1');
  });

  it('maps bridge error responses to typed errors', async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { ok: false, error: { code: 'generation-failed', detail: 'scripts/step exited with code 1' } },
        502,
      )) as typeof fetch;

    const transport = createLocalBridgeTransport({ endpoint: 'http://x/api', fetchImpl });
    const outcome = await transport.generate({ prompt: 'x' });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({ code: 'generation-failed', detail: 'scripts/step exited with code 1' });
  });

  it('reports transport-unavailable on network failure', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    const transport = createLocalBridgeTransport({ endpoint: 'http://x/api', fetchImpl });
    const outcome = await transport.generate({ prompt: 'x' });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('transport-unavailable');
  });

  it('reports generation-timeout when the request exceeds its budget', async () => {
    const hangingFetch = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted', 'AbortError')),
        );
      })) as typeof fetch;

    const transport = createLocalBridgeTransport({ endpoint: 'http://x/api', fetchImpl: hangingFetch });
    const outcome = await transport.generate({ prompt: 'x', timeoutMs: 50 });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({ code: 'generation-timeout', timeoutMs: 50 });
  });

  it('rejects responses without an inline STL artifact', async () => {
    const model = makeModel({ artifacts: [] });
    const fetchImpl = (async () =>
      jsonResponse({ ok: true, model, stlBase64: stlBase64() })) as typeof fetch;

    const transport = createLocalBridgeTransport({ endpoint: 'http://x/api', fetchImpl });
    const outcome = await transport.generate({ prompt: 'x' });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('invalid-artifact');
  });

  it('isAvailable reflects the bridge health endpoint', async () => {
    const up = createLocalBridgeTransport({
      endpoint: 'http://x/api',
      fetchImpl: (async () => jsonResponse({ ok: true, ready: true })) as typeof fetch,
    });
    const down = createLocalBridgeTransport({
      endpoint: 'http://x/api',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });

    expect(await up.isAvailable()).toBe(true);
    expect(await down.isAvailable()).toBe(false);
  });
});
