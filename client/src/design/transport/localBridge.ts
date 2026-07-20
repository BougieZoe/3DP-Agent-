import type { GeneratedModel } from '@shared/domain/generatedModel';
import type {
  CADGenerationError,
  CADGenerationOutcome,
  CADGenerationRequest,
} from '../cadGenerationService';
import type { CADGenerationTransport } from './types';

/**
 * Local bridge transport — POSTs generation requests to the local Express
 * CAD bridge (server/cadBridge.ts, mounted at /api/cad/generate), which
 * shells out to this machine's Python + CAD skill install. Dev only.
 *
 * The transport owns: request mapping, timeout/cancel handling, and inbound
 * contract validation (STL artifact present, mm units, non-empty bytes).
 */

export interface LocalBridgeLlm {
  /** OpenAI-compatible endpoint base, e.g. 'https://api.deepseek.com/v1'. */
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface LocalBridgeTransportOptions {
  /** Default '/api/cad/generate' (same-origin, vite dev proxy → Express :3001). */
  endpoint?: string;
  /** LLM used by the bridge to author build123d source. Resolved client-side (BYO key). */
  llm?: LocalBridgeLlm;
  /** Dev/test escape hatch: skip the LLM and send explicit gen_step() source. */
  generatorSource?: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

const DEFAULT_ENDPOINT = '/api/cad/generate';
const DEFAULT_TIMEOUT_MS = 180_000;

interface BridgeSuccessBody {
  ok: true;
  model: GeneratedModel;
  stlBase64: string;
}

interface BridgeErrorBody {
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

export function createLocalBridgeTransport(
  options: LocalBridgeTransportOptions = {},
): CADGenerationTransport {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    id: 'local-bridge',

    async isAvailable(): Promise<boolean> {
      try {
        const res = await fetchImpl(`${endpoint}/health`, { method: 'GET' });
        if (!res.ok) return false;
        const body = (await res.json()) as { ready?: boolean };
        return body.ready === true;
      } catch {
        return false;
      }
    },

    async generate(request: CADGenerationRequest): Promise<CADGenerationOutcome> {
      const timeoutMs = request.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

      const body = {
        prompt: request.prompt,
        locale: request.locale,
        constraints: request.constraints
          ? {
              targetPrinter: request.constraints.targetPrinter,
              materialName: request.constraints.material?.name,
              maxDimensionMm: request.constraints.maxDimensionMm,
            }
          : undefined,
        baseModel: request.baseModel,
        llm: options.llm,
        generatorSource: options.generatorSource,
        timeoutMs,
      };

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onExternalAbort = () => controller.abort();
      request.signal?.addEventListener('abort', onExternalAbort);

      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

        return { ok: true, result: { model: success.model, stlBytes } };
      } catch (err) {
        if (timedOut) return fail({ code: 'generation-timeout', timeoutMs });
        if (request.signal?.aborted) return fail({ code: 'cancelled' });
        return fail({ code: 'transport-unavailable', detail: String(err) });
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}
