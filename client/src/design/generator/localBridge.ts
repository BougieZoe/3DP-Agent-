import { postGeneration, settleOutcome } from './bridgePost';
import type {
  GeneratorAdapter,
  GeneratorJob,
  GeneratorJobState,
  GeneratorRequest,
  GenerationOutcome,
} from './types';

/**
 * Local bridge adapter — the dev path: POST to the local Express CAD bridge
 * (server/cadBridge.ts, mounted at /api/cad/generate), which shells out to this
 * machine's Python + CAD skill install. Synchronous job: submit kicks off the
 * request and returns immediately; the first poll settles it.
 *
 * Request mapping, timeout/cancel, and inbound contract validation all live in
 * the shared postGeneration helper (verbatim from the old transport layer).
 */

export interface LocalBridgeLlm {
  /** OpenAI-compatible endpoint base, e.g. 'https://api.deepseek.com/v1'. */
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface LocalBridgeAdapterOptions {
  /** Default '/api/cad/generate' (same-origin, vite dev proxy → Express :3001). */
  endpoint?: string;
  /** LLM used by the bridge to author build123d source. Resolved client-side (BYO key). */
  llm?: LocalBridgeLlm;
  /** Ordered [primary, ...fallbacks] for failover when the active provider
   * is quota-limited. Each must be OpenAI-compatible (chat/completions). */
  llmCandidates?: LocalBridgeLlm[];
  /** Dev/test escape hatch: skip the LLM and send explicit gen_step() source. */
  generatorSource?: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

const DEFAULT_ENDPOINT = '/api/cad/generate';
const DEFAULT_TIMEOUT_MS = 180_000;

export function createLocalBridgeAdapter(
  options: LocalBridgeAdapterOptions = {},
): GeneratorAdapter {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const fetchImpl = options.fetchImpl ?? fetch;
  // One in-flight request per adapter instance.
  let pending: Promise<GenerationOutcome> | null = null;

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

    async submit(request: GeneratorRequest): Promise<GeneratorJob> {
      const timeoutMs = request.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
      // Kick off the request immediately; the first poll settles it.
      pending = postGeneration({
        endpoint,
        headers: { 'Content-Type': 'application/json' },
        body: {
          prompt: request.prompt,
          locale: request.locale,
          constraints: request.constraints,
          baseModel: request.baseModel,
          params: request.params,
          llm: options.llm,
          llmCandidates: options.llmCandidates,
          generatorSource: options.generatorSource,
          timeoutMs,
        },
        timeoutMs,
        fetchImpl,
        signal: request.signal,
      });
      return { id: `cad-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, provider: 'local-bridge' };
    },

    async poll(_handle: GeneratorJob, _signal?: AbortSignal): Promise<GeneratorJobState> {
      const outcome: GenerationOutcome = await pending!;
      return settleOutcome(outcome);
    },
  };
}