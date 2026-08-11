import type {
  MeshGenerationProvider,
  MeshJobHandle,
  MeshJobState,
  MeshGenerationRequest,
} from './types';

export interface TripoMeshProviderOptions {
  apiKey: string;
  /** Default 'https://api.tripo3d.ai/v2/openapi'. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE = 'https://api.tripo3d.ai/v2/openapi';

/**
 * Tripo text-to-3D provider. Tripo's API is asynchronous: POST /task to submit,
 * GET /task/{id} to poll until 'succeeded', then download the STL/GLB from the
 * returned URLs. Response parsing is intentionally defensive (recursively looks
 * for .stl/.glb URLs) so a field rename in their payload is a small adapter fix
 * rather than a break.
 */
export function createTripoMeshProvider(options: TripoMeshProviderOptions): MeshGenerationProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${options.apiKey}`,
  };

  return {
    id: 'tripo',

    async isAvailable(): Promise<boolean> {
      return options.apiKey.trim().length > 0;
    },

    async generate(request: MeshGenerationRequest): Promise<MeshJobHandle> {
      const res = await fetchImpl(`${baseUrl}/task`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ type: 'text_to_model', prompt: request.prompt }),
        signal: request.signal,
      });
      if (!res.ok) throw new Error(`Tripo submit failed: HTTP ${res.status}`);
      const body = (await res.json()) as { data?: { task_id?: string } };
      const taskId = body?.data?.task_id;
      if (!taskId) throw new Error('Tripo submit: response had no task_id');
      return { id: taskId, provider: 'tripo' };
    },

    async poll(handle: MeshJobHandle): Promise<MeshJobState> {
      const res = await fetchImpl(`${baseUrl}/task/${handle.id}`, { headers: authHeaders });
      if (!res.ok) throw new Error(`Tripo poll failed: HTTP ${res.status}`);
      const body = (await res.json()) as TripoTaskResponse;
      const data = body?.data ?? {};
      const status = data.status;

      if (status === 'succeeded') {
        const stlUrl = findDownloadUrl(data, 'stl');
        const glbUrl = findDownloadUrl(data, 'glb');
        const stlBytes = stlUrl
          ? await (await fetchImpl(stlUrl)).arrayBuffer()
          : new ArrayBuffer(0);
        const glbBytes = glbUrl
          ? await (await fetchImpl(glbUrl)).arrayBuffer()
          : undefined;
        return { status: 'succeeded', stlBytes, glbBytes };
      }
      if (status === 'failed') {
        return {
          status: 'failed',
          reason: typeof data.error === 'string' ? data.error : 'Tripo generation failed',
        };
      }
      return { status: status === 'queued' ? 'queued' : 'running' };
    },
  };
}

type TripoTaskResponse = {
  data?: {
    status?: string;
    error?: unknown;
    result?: unknown;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

/** Recursively find a download URL ending in .stl / .glb anywhere in the payload. */
function findDownloadUrl(node: unknown, ext: 'stl' | 'glb'): string | undefined {
  if (typeof node === 'string') {
    return node.toLowerCase().includes(`.${ext}`) ? node : undefined;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findDownloadUrl(item, ext);
      if (found) return found;
    }
    return undefined;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      const found = findDownloadUrl(value, ext);
      if (found) return found;
    }
  }
  return undefined;
}
