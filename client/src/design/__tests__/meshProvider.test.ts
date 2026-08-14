import { describe, expect, it } from 'vitest';
import { createTripoAdapter, createMockMeshAdapter, createMeshGenerator } from '../generator';
import { shapeForPrompt } from '../generator/mock';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('mock shape keywords', () => {
  it('maps prompt keywords to primitives', () => {
    expect(shapeForPrompt('a gear')).toBe('torus');
    expect(shapeForPrompt('a bicycle wheel')).toBe('torus');
    expect(shapeForPrompt('a cube')).toBe('box');
    expect(shapeForPrompt('a cylinder')).toBe('cylinder');
    expect(shapeForPrompt('a marble')).toBe('sphere');
    expect(shapeForPrompt('a mysterious thing')).toBe('torus'); // default
  });
});

describe('mock mesh adapter', () => {
  it('is available and returns a valid binary STL on success', async () => {
    const adapter = createMockMeshAdapter({ delayMs: 1, shape: 'torus' });
    expect(await adapter.isAvailable()).toBe(true);

    const handle = await adapter.submit({ prompt: 'a torus' });
    expect(handle.id).toMatch(/^mock-/);

    const state = await adapter.poll(handle);
    expect(state.status).toBe('succeeded');
    if (state.status !== 'succeeded') return;
    expect(state.payload.kind).toBe('mesh');
    if (state.payload.kind !== 'mesh') return;
    // Binary STL: 80-byte header + 4-byte facet count + facets.
    expect(state.payload.stlBytes.byteLength).toBeGreaterThan(84);
  });
});

describe('tripo mesh adapter', () => {
  it('isAvailable reflects the /api/tripo proxy health (key stays server-side)', async () => {
    const up = createTripoAdapter({
      endpoint: 'http://x/api',
      fetchImpl: (async () => jsonResponse({ ok: true, ready: true })) as typeof fetch,
    });
    const down = createTripoAdapter({
      endpoint: 'http://x/api',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });

    expect(await up.isAvailable()).toBe(true);
    expect(await down.isAvailable()).toBe(false);
  });

  it('submits a text_to_model task through the proxy and returns the task id', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({ code: 0, data: { task_id: 'task-123' } });
    }) as typeof fetch;

    const adapter = createTripoAdapter({ endpoint: 'http://x/api', fetchImpl });
    const handle = await adapter.submit({ prompt: 'a dragon' });

    expect(capturedUrl).toContain('/task');
    expect(capturedHeaders.Authorization).toBeUndefined();
    expect(capturedBody).toEqual({ prompt: 'a dragon' });
    expect(handle.id).toBe('task-123');
  });

  it('polls to succeeded and downloads the STL', async () => {
    const stlBytes = new Uint8Array(84 + 50).buffer;
    const fetchImpl = (async (url: unknown) => {
      const u = String(url);
      if (u.includes('/task/task-123')) {
        return jsonResponse({
          data: {
            status: 'succeeded',
            result: {
              model_v2: {
                glb: { url: 'https://cdn.example.com/model.glb' },
                pbr_model: { stl: { url: 'https://cdn.example.com/model.stl' } },
              },
            },
          },
        });
      }
      return new Response(stlBytes);
    }) as typeof fetch;

    const adapter = createTripoAdapter({ endpoint: 'http://x/api', fetchImpl });
    const state = await adapter.poll({ id: 'task-123', provider: 'tripo' });

    expect(state.status).toBe('succeeded');
    if (state.status !== 'succeeded') return;
    expect(state.payload.kind).toBe('mesh');
    if (state.payload.kind !== 'mesh') return;
    expect(state.payload.stlBytes.byteLength).toBe(134);
  });

  it('reports failure with a reason', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ data: { status: 'failed', error: 'mesh generation failed' } })) as typeof fetch;

    const adapter = createTripoAdapter({ endpoint: 'http://x/api', fetchImpl });
    const state = await adapter.poll({ id: 'x', provider: 'tripo' });

    expect(state.status).toBe('failed');
    if (state.status !== 'failed') return;
    expect(state.reason).toBe('mesh generation failed');
  });
});

describe('createMeshGenerator factory', () => {
  it('uses Tripo when the proxy is ready, else the mock', async () => {
    const tripoFetch = (async (url: unknown) => {
      if (String(url).endsWith('/health')) return jsonResponse({ ok: true, ready: true });
      return jsonResponse({ code: 0, data: { task_id: 'task-123' } });
    }) as typeof fetch;
    const downFetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    expect((await createMeshGenerator({ tripoEndpoint: 'http://x/api', fetchImpl: tripoFetch })).id).toBe('tripo');
    expect((await createMeshGenerator({ tripoEndpoint: 'http://x/api', fetchImpl: downFetch })).id).toBe('mock');
  });
});