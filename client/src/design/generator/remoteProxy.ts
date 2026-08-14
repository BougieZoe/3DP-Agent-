import { postGeneration, settleOutcome } from './bridgePost';
import type {
  GeneratorAdapter,
  GeneratorJob,
  GeneratorJobState,
  GeneratorRequest,
  GenerationOutcome,
} from './types';

/**
 * Remote proxy adapter — the production path: POSTs generation requests to a
 * hosted CAD service (createGenerator({ transport: 'remote-proxy' })) that runs
 * the build123d skill server-side. The client sends only the request (prompt /
 * constraints / edit lineage / params); the service owns its own LLM config and
 * generation worker. Synchronous job like the local bridge.
 */

export interface RemoteProxyAdapterOptions {
  /** Absolute base URL of the hosted CAD service, e.g. 'https://cad.example.com'. */
  baseUrl: string;
  /** Optional bearer token the hosted service requires. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 180_000;

export function createRemoteProxyAdapter(
  options: RemoteProxyAdapterOptions,
): GeneratorAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/api/cad/generate`;
  let pending: Promise<GenerationOutcome> | null = null;

  return {
    id: 'remote-proxy',

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
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

      // The hosted service provides generation config (LLM keys / worker), so
      // the client never sends llm/generatorSource to a remote endpoint.
      pending = postGeneration({
        endpoint,
        headers,
        body: {
          prompt: request.prompt,
          locale: request.locale,
          constraints: request.constraints,
          baseModel: request.baseModel,
          params: request.params,
          timeoutMs,
        },
        timeoutMs,
        fetchImpl,
        signal: request.signal,
      });
      return { id: `cad-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, provider: 'remote-proxy' };
    },

    async poll(_handle: GeneratorJob, _signal?: AbortSignal): Promise<GeneratorJobState> {
      const outcome: GenerationOutcome = await pending!;
      return settleOutcome(outcome);
    },
  };
}