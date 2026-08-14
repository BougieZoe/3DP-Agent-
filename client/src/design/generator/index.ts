import { generateDesign } from './service';
import { createLocalBridgeAdapter } from './localBridge';
import { createRemoteProxyAdapter } from './remoteProxy';
import { createTripoAdapter } from './tripo';
import { createMockMeshAdapter } from './mock';
import type {
  GeneratorAdapter,
  GeneratorJob,
  GeneratorJobState,
  GeneratorRequest,
  GenerationError,
  GenerationOutcome,
  GenerationResult,
  GeneratorPayload,
} from './types';
import { DEFAULT_GENERATE_TIMEOUT_MS } from './types';

export {
  generateDesign,
  createLocalBridgeAdapter,
  createRemoteProxyAdapter,
  createTripoAdapter,
  createMockMeshAdapter,
  DEFAULT_GENERATE_TIMEOUT_MS,
};
export type {
  GeneratorAdapter,
  GeneratorJob,
  GeneratorJobState,
  GeneratorRequest,
  GenerationError,
  GenerationOutcome,
  GenerationResult,
  GeneratorPayload,
};

export interface MeshGeneratorConfig {
  /** Base URL of the same-origin Tripo proxy; defaults to '/api/tripo'. */
  tripoEndpoint?: string;
  fetchImpl?: typeof fetch;
  mock?: { delayMs?: number; shape?: 'torus' | 'box' | 'sphere' | 'cylinder' | 'auto' };
}

/**
 * Select the best mesh generator: the server-backed Tripo adapter when the
 * proxy reports ready (TRIPO_API_KEY configured server-side), otherwise the
 * local mock so the pipeline stays usable/demoable with no external dependency.
 */
export async function createMeshGenerator(config: MeshGeneratorConfig = {}): Promise<GeneratorAdapter> {
  const tripo = createTripoAdapter({
    endpoint: config.tripoEndpoint,
    fetchImpl: config.fetchImpl,
  });
  if (await tripo.isAvailable()) return tripo;
  return createMockMeshAdapter(config.mock);
}
