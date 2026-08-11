import { describe, expect, it } from 'vitest';
import { createMeshProvider, createMockMeshProvider, createTripoMeshProvider } from '../mesh';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('mock mesh provider', () => {
  it('is available and returns a valid binary STL on success', async () => {
    const provider = createMockMeshProvider({ delayMs: 1, shape: 'torus' });
    expect(await provider.isAvailable()).toBe(true);

    const handle = await provider.generate({ prompt: 'a torus' });
    expect(handle.id).toMatch(/^mock-/);

    const state = await provider.poll(handle);
    expect(state.status).toBe('succeeded');
    if (state.status !== 'succeeded') return;
    // Binary STL: 80-byte header + 4-byte facet count + facets.
    expect(state.stlBytes.byteLength).toBeGreaterThan(84);
  });
});

describe('tripo mesh provider', () => {
  it('is unavailable without a key', async () => {
    const provider = createTripoMeshProvider({ apiKey: '  ' });
    expect(await provider.isAvailable()).toBe(false);
  });

  it('submits a text_to_model task with bearer auth and returns the task id', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({ code: 0, data: { task_id: 'task-123' } });
    }) as typeof fetch;

    const provider = createTripoMeshProvider({ apiKey: 'secret', fetchImpl });
    const handle = await provider.generate({ prompt: 'a dragon' });

    expect(capturedUrl).toContain('/task');
    expect(capturedHeaders.Authorization).toBe('Bearer secret');
    expect(capturedBody).toEqual({ type: 'text_to_model', prompt: 'a dragon' });
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

    const provider = createTripoMeshProvider({ apiKey: 'secret', fetchImpl });
    const state = await provider.poll({ id: 'task-123', provider: 'tripo' });

    expect(state.status).toBe('succeeded');
    if (state.status !== 'succeeded') return;
    expect(state.stlBytes.byteLength).toBe(134);
  });

  it('reports failure with a reason', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ data: { status: 'failed', error: 'mesh generation failed' } })) as typeof fetch;

    const provider = createTripoMeshProvider({ apiKey: 'secret', fetchImpl });
    const state = await provider.poll({ id: 'x', provider: 'tripo' });

    expect(state.status).toBe('failed');
    if (state.status !== 'failed') return;
    expect(state.reason).toBe('mesh generation failed');
  });
});

describe('createMeshProvider factory', () => {
  it('uses Tripo when a key is set, else the mock', async () => {
    expect((await createMeshProvider({ tripoApiKey: 'k' })).id).toBe('tripo');
    expect((await createMeshProvider()).id).toBe('mock');
  });
});
