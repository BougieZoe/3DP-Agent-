import type { CADGenerationOutcome, CADGenerationRequest } from '../cadGenerationService';
import type { CADGenerationTransport } from './types';
import { postGeneration } from './fetchGeneration';

export interface RemoteProxyOptions {
  /** Absolute base URL of the hosted CAD service, e.g. 'https://cad.example.com'. */
  baseUrl: string;
  /** Optional bearer token the hosted service requires. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Remote proxy transport — POSTs generation requests to a hosted CAD service
 * that runs the build123d skill server-side. The client sends only the request
 * (prompt / constraints / edit lineage); the service owns its own LLM config
 * and generation worker. This is the production path
 * (CADGenerationTransport.id 'remote-proxy').
 */
export function createRemoteProxyTransport(options: RemoteProxyOptions): CADGenerationTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/api/cad/generate`;

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

    async generate(request: CADGenerationRequest): Promise<CADGenerationOutcome> {
      const timeoutMs = request.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

      // The hosted service provides generation config (LLM keys / worker), so
      // the client never sends llm/generatorSource to a remote endpoint.
      return postGeneration({
        endpoint,
        headers,
        body: {
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
          timeoutMs,
        },
        timeoutMs,
        fetchImpl,
        signal: request.signal,
      });
    },
  };
}
