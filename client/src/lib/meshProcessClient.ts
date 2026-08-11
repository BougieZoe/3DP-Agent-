/**
 * Client for /api/mesh/process — repair (best-effort), decimate, and diagnose
 * an STL on the server. Repair may be unavailable under the venv's numpy 2.x;
 * the endpoint degrades to diagnostics + decimation.
 */

export interface MeshProcessDiagnostics {
  triangleCount?: number;
  watertight?: boolean;
  volumeMm3?: number | null;
  surfaceAreaMm2?: number;
  bodyCount?: number | null;
  repaired?: boolean;
  repairNote?: string;
}

export interface MeshProcessResult {
  stlBytes: ArrayBuffer;
  diagnostics: MeshProcessDiagnostics;
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
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  const buf = Buffer.from(base64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function processMesh(
  stlBytes: ArrayBuffer,
  options?: { decimateTo?: number },
): Promise<MeshProcessResult> {
  const res = await fetch('/api/mesh/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stlBase64: arrayBufferToBase64(stlBytes), decimateTo: options?.decimateTo ?? 0 }),
  });
  if (!res.ok) {
    let detail = `mesh process failed (HTTP ${res.status})`;
    try {
      const err = (await res.json()) as { error?: { detail?: string } };
      if (err?.error?.detail) detail = err.error.detail;
    } catch {
      /* keep default */
    }
    throw new Error(detail);
  }
  const data = (await res.json()) as { ok: true; processedStlBase64: string; diagnostics?: MeshProcessDiagnostics };
  return { stlBytes: base64ToArrayBuffer(data.processedStlBase64), diagnostics: data.diagnostics ?? {} };
}
