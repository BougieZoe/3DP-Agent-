/**
 * Client for /api/mesh/thicken — true solid offset on the bridge.
 *
 * Contract: the bridge reports what it did, never whether it is good. The
 * caller must re-analyse the returned mesh and keep the change only if the
 * measured wall improved (see docs/bridge-thicken.md).
 */

export interface ThickenDiagnostics {
  status?: 'ok' | 'not_closed' | 'too_large' | 'empty_result' | 'error';
  deltaMm?: number | null;
  inputTriangles?: number | null;
  outputTriangles?: number | null;
  watertightBefore?: boolean | null;
  watertightAfter?: boolean | null;
  minWallBeforeMm?: number | null;
  minWallAfterMm?: number | null;
  growthMm?: number | null;
  elapsedMs?: number | null;
  error?: string;
}

export interface BridgeThickenResult {
  stlBytes: ArrayBuffer;
  diagnostics: ThickenDiagnostics;
}

/** A rejection the caller can act on (repair first / too big for the bridge). */
export class ThickenRejected extends Error {
  constructor(
    readonly reason: 'not_closed' | 'too_large',
    detail: string,
  ) {
    super(detail);
    this.name = 'ThickenRejected';
  }
}

/** Bridge unreachable/misconfigured — the caller should fall back locally. */
export class ThickenUnavailable extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ThickenUnavailable';
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    for (let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function thickenMesh(
  stlBytes: ArrayBuffer,
  deltaMm: number,
  segments = 8,
): Promise<BridgeThickenResult> {
  let res: Response;
  try {
    res = await fetch('/api/mesh/thicken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stlBase64: arrayBufferToBase64(stlBytes), deltaMm, segments }),
    });
  } catch (err) {
    throw new ThickenUnavailable(err instanceof Error ? err.message : String(err));
  }

  if (res.status === 422) {
    const data = (await res.json().catch(() => null)) as { diagnostics?: ThickenDiagnostics } | null;
    throw new ThickenRejected('not_closed', data?.diagnostics?.error ?? 'mesh is not a closed solid');
  }
  if (res.status === 413) {
    const data = (await res.json().catch(() => null)) as { error?: { detail?: string } } | null;
    throw new ThickenRejected('too_large', data?.error?.detail ?? 'mesh exceeds the bridge triangle budget');
  }
  if (!res.ok) {
    // A 404/500 here usually means the route is not mounted or manifold3d is
    // missing — a local fallback is still better than a dead end.
    let detail = `thicken bridge failed (HTTP ${res.status})`;
    try {
      const err = (await res.json()) as { error?: { detail?: string } };
      if (err?.error?.detail) detail = err.error.detail;
    } catch {
      /* keep default */
    }
    throw new ThickenUnavailable(detail);
  }

  const data = (await res.json()) as {
    ok: true;
    status: 'ok';
    thickenedStlBase64: string;
    diagnostics?: ThickenDiagnostics;
  };
  return {
    stlBytes: base64ToArrayBuffer(data.thickenedStlBase64),
    diagnostics: data.diagnostics ?? {},
  };
}
