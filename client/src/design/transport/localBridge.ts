import type { CADGenerationOutcome, CADGenerationRequest } from '../cadGenerationService';
import type { CADGenerationTransport } from './types';
import { postGeneration } from './fetchGeneration';

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

      // Request mapping + timeout/cancel + inbound STL validation all live in
      // the shared postGeneration helper (same contract for every transport).
      return postGeneration({
        endpoint,
        headers: { 'Content-Type': 'application/json' },
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
          llm: options.llm,
          generatorSource: options.generatorSource,
          timeoutMs,
        },
        timeoutMs,
        fetchImpl,
        signal: request.signal,
      });
    },
  };
}
