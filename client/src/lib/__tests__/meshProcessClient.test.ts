import { describe, expect, it, vi, afterEach } from 'vitest';
import { processMesh } from '../meshProcessClient';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

describe('processMesh', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts base64 STL and decodes the processed STL + diagnostics', async () => {
    const processed = new Uint8Array([9, 8, 7, 6, 5]);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          processedStlBase64: bytesToBase64(processed),
          diagnostics: { triangleCount: 10, watertight: true, volumeMm3: 1234 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    const result = await processMesh(new Uint8Array([1, 2, 3, 4, 5]).buffer, { decimateTo: 50 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/mesh/process');
    const body = JSON.parse(String(init.body)) as { stlBase64: string; decimateTo: number };
    expect(body.decimateTo).toBe(50);
    expect(body.stlBase64).toBeTypeOf('string');
    expect(new Uint8Array(result.stlBytes)).toEqual(processed);
    expect(result.diagnostics.triangleCount).toBe(10);
    expect(result.diagnostics.volumeMm3).toBe(1234);
  });

  it('throws with the server detail on an error response', async () => {
    (globalThis as { fetch: unknown }).fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: { detail: 'mesh process exploded' } }), {
        status: 502,
      }),
    );
    await expect(processMesh(new ArrayBuffer(1))).rejects.toThrow('mesh process exploded');
  });
});
