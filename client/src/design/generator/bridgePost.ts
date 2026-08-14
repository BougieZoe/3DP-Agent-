import type { GeneratedModel } from '@shared/domain/generatedModel';
import type {
  GenerationError,
  GenerationOutcome,
  GeneratorJobState,
} from './types';

/**
 * Shared "POST a generation request, parse the bridge response, validate the
 * STL artifact, decode bytes" core used by the cad-backed generator adapters
 * (localBridge, remoteProxy). Handles the request timeout/abort and maps
 * bridge errors to typed outcomes.
 *
 * NOTE: the inbound contract assertions here are the crown jewels of the
 * generation layer — they moved verbatim from the old transport/fetchGeneration.
 * Do not weaken them.
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

function fail(error: GenerationError): GenerationOutcome {
  return { ok: false, error };
}

/** Map a settled cad-bridge outcome into the unified job lifecycle state. */
export function settleOutcome(outcome: GenerationOutcome): GeneratorJobState {
  if (outcome.ok) {
    return {
      status: 'succeeded',
      payload: {
        kind: 'cad',
        result: {
          generatedModel: outcome.result.generatedModel as GeneratedModel,
          stlBytes: outcome.result.stlBytes,
          repaired: outcome.result.repaired,
          repairType: outcome.result.repairType,
          attempts: outcome.result.attempts,
        },
      },
    };
  }
  if (outcome.error.code === 'generation-timeout') {
    return { status: 'failed', code: 'generation-timeout', reason: `generation exceeded ${outcome.error.timeoutMs}ms budget` };
  }
  if (outcome.error.code === 'cancelled') {
    return { status: 'failed', code: 'cancelled', reason: 'cancelled' };
  }
  return { status: 'failed', code: outcome.error.code, reason: outcome.error.detail };
}

export interface BridgePostArgs {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  /** External abort signal (e.g. the caller cancelling a request). */
  signal?: AbortSignal;
}

export async function postGeneration(args: BridgePostArgs): Promise<GenerationOutcome> {
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
        // Surface the engine's actual Python traceback so a build failure is
        // diagnosable instead of a bare "exited with code 1".
        if (errBody?.error?.stderr) {
          detail = `${detail}\n\nBuild log:\n${errBody.error.stderr.slice(-2000)}`;
        }
        if (errBody?.error?.code && KNOWN_ERROR_CODES.has(errBody.error.code)) {
          code = errBody.error.code;
        }
      } catch {
        /* non-JSON error body — keep defaults */
      }
      if (code === 'generation-timeout') return fail({ code, timeoutMs });
      return fail({ code: code as GenerationError['code'], detail } as GenerationError);
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
        modelId: success.model.id,
        stlBytes,
        generatedModel: success.model,
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
