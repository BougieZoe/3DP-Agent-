import { createMockMeshProvider } from './mockProvider';
import { createTripoMeshProvider } from './tripoProvider';
import type {
  MeshGenerationProvider,
  MeshGenerationRequest,
  MeshJobHandle,
  MeshJobState,
} from './types';

export { createMockMeshProvider, createTripoMeshProvider };
export type { MeshGenerationProvider, MeshGenerationRequest, MeshJobHandle, MeshJobState };

export interface MeshProviderConfig {
  /** Tripo API key. When set, uses the hosted provider; otherwise the mock. */
  tripoApiKey?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Pick the best available mesh provider: a hosted Tripo when a key is
 * configured, otherwise the local mock so the pipeline stays usable/demoable
 * with no external dependency.
 */
export function createMeshProvider(config: MeshProviderConfig = {}): MeshGenerationProvider {
  if (config.tripoApiKey?.trim()) {
    return createTripoMeshProvider({ apiKey: config.tripoApiKey, fetchImpl: config.fetchImpl });
  }
  return createMockMeshProvider();
}
