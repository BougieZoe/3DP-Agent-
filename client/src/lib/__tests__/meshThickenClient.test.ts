// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { thickenMesh, ThickenRejected, ThickenUnavailable } from '../meshThickenClient';

const bytes = new Uint8Array([1, 2, 3]).buffer;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('thickenMesh', () => {
  it('decodes the returned STL and diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, {
      ok: true, status: 'ok',
      thickenedStlBase64: btoa('abc'),
      diagnostics: { inputTriangles: 100, outputTriangles: 240 },
    })));
    const res = await thickenMesh(bytes, 0.15);
    expect(new Uint8Array(res.stlBytes)).toEqual(new Uint8Array([97, 98, 99]));
    expect(res.diagnostics.outputTriangles).toBe(240);
  });

  it('maps 422 to a not_closed rejection (repair first)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(422, { ok: false, status: 'not_closed', diagnostics: { error: 'open' } })));
    await expect(thickenMesh(bytes, 0.15)).rejects.toBeInstanceOf(ThickenRejected);
    await expect(thickenMesh(bytes, 0.15)).rejects.toMatchObject({ reason: 'not_closed' });
  });

  it('maps 413 to too_large', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(413, { ok: false, status: 'too_large', error: { detail: 'too big' } })));
    await expect(thickenMesh(bytes, 0.15)).rejects.toMatchObject({ name: 'ThickenRejected', reason: 'too_large' });
  });

  it('treats a network failure as unavailable so the caller can fall back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(thickenMesh(bytes, 0.15)).rejects.toBeInstanceOf(ThickenUnavailable);
  });

  it('treats a 500 (route missing / manifold3d absent) as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(500, { ok: false, error: { detail: 'thicken-failed' } })));
    await expect(thickenMesh(bytes, 0.15)).rejects.toBeInstanceOf(ThickenUnavailable);
  });
});
