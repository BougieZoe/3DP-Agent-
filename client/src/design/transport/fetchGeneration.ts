import type { GeneratedModel } from '@shared/domain/generatedModel';
import type { CADGenerationError, CADGenerationOutcome } from '../cadGenerationService';

/**
 * Shared "POST a generation request, parse the bridge response, validate the
 * STL artifact, decode bytes" core used by every CADGenerationTransport
 * (localBridge, remoteProxy). Handles the request timeout/abort and maps
 * bridge errors to typed outcomes.
 */

export interface BridgeSuccessBody {
  ok: true;
  model: GeneratedModel;
  stlBase64: string;
  repaired?: boolean;
  repairType?: string;
  attempts?: number;
}

export interface BridgeErrorBody {
  ok: false;
  error: { code: string; detail: string; stderr?: string };
}

const KNOWN_ERROR_CODES = new Set([
  'transport-unavailable',
  'generation-failed',
  'generation-timeout',
  'invalid-artifact',
]);

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  // Node fallback (vitest / scripts).
  const buf = Buffer.from(base64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function fail(error: CADGenerationError): CADGenerationOutcome {
  return { ok: false, error };
}

export interface GenerationPostArgs {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  /** External abort signal (e.g. the caller cancelling a request). */
  signal?: AbortSignal;
}

export async function postGeneration(args: GenerationPostArgs): Promise<CADGenerationOutcome> {
  const { endpoint, headers, body, timeoutMs, fetchImpl, signal } = args;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = `bridge HTTP ${res.status}`;
      let code = 'generation-failed';
      try {
        const errBody = (await res.json()) as BridgeErrorBody;
        if (errBody?.error?.detail) detail = errBody.error.detail;
        if (errBody?.error?.code && KNOWN_ERROR_CODES.has(errBody.error.code)) {
          code = errBody.error.code;
        }
      } catch {
        /* non-JSON error body — keep defaults */
      }
      if (code === 'generation-timeout') return fail({ code, timeoutMs });
      return fail({ code: code as CADGenerationError['code'], detail } as CADGenerationError);
    }

    const success = (await res.json()) as BridgeSuccessBody;

    // Inbound contract validation — the analysis chain depends on these.
    const stlArtifact = success.model?.artifacts?.find(
      (a) => a.kind === 'stl' && a.location.type === 'inline-bytes',
    );
    if (!stlArtifact) {
      return fail({ code: 'invalid-artifact', detail: 'response has no inline STL artifact' });
    }
    if (stlArtifact.units !== 'mm') {
      return fail({ code: 'invalid-artifact', detail: `STL units must be mm, got ${stlArtifact.units}` });
    }
    if (typeof success.stlBase64 !== 'string' || success.stlBase64.length === 0) {
      return fail({ code: 'invalid-artifact', detail: 'empty STL payload' });
    }

    const stlBytes = base64ToArrayBuffer(success.stlBase64);
    // Binary STL minimum: 80-byte header + 4-byte facet count.
    if (stlBytes.byteLength <= 84) {
      return fail({ code: 'invalid-artifact', detail: `STL payload too small (${stlBytes.byteLength} bytes)` });
    }

    return {
      ok: true,
      result: {
        model: success.model,
        stlBytes,
        repaired: success.repaired ?? false,
        repairType: success.repairType ?? 'none',
        attempts: success.attempts ?? 1,
      },
    };
  } catch (err) {
    if (timedOut) return fail({ code: 'generation-timeout', timeoutMs });
    if (signal?.aborted) return fail({ code: 'cancelled' });
    return fail({ code: 'transport-unavailable', detail: String(err) });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
