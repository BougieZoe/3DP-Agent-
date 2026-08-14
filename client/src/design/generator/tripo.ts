import type {
  GeneratorAdapter,
  GeneratorJob,
  GeneratorJobState,
  GeneratorRequest,
} from './types';

/**
 * Tripo text-to-3D adapter — async job lifecycle through the server proxy
 * (/api/tripo). The API key stays server-side (never in the bundle); this
 * adapter only submits the prompt, polls status, and downloads the STL from
 * Tripo's signed URL. The facade owns the poll budget / backoff / abort.
 *
 * Response parsing is intentionally defensive (recursively looks for .stl/.glb
 * URLs) so a field rename in their payload is a small adapter fix, not a break.
 */

export interface TripoAdapterOptions {
  /** Same-origin proxy, default '/api/tripo'. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = '/api/tripo';

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

export function createTripoAdapter(options: TripoAdapterOptions = {}): GeneratorAdapter {
  const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    id: 'tripo',

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
      const res = await fetchImpl(`${endpoint}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: request.prompt }),
        signal: request.signal,
      });
      if (!res.ok) {
        let detail = `Tripo submit failed: HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: { detail?: string } };
          if (body?.error?.detail) detail = body.error.detail;
        } catch {
          /* non-JSON body */
        }
        throw new Error(detail);
      }
      const body = (await res.json()) as { data?: { task_id?: string } };
      const taskId = body?.data?.task_id;
      if (!taskId) throw new Error('Tripo submit: response had no task_id');
      return { id: taskId, provider: 'tripo' };
    },

    async poll(handle: GeneratorJob, signal?: AbortSignal): Promise<GeneratorJobState> {
      const res = await fetchImpl(`${endpoint}/task/${handle.id}`, { signal });
      if (!res.ok) {
        let detail = `Tripo poll failed: HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: { detail?: string } };
          if (body?.error?.detail) detail = body.error.detail;
        } catch {
          /* non-JSON body */
        }
        throw new Error(detail);
      }
      const body = (await res.json()) as TripoTaskResponse;
      const data = body?.data ?? {};
      const status = data.status;

      if (status === 'succeeded') {
        const stlUrl = findDownloadUrl(data, 'stl');
        if (!stlUrl) {
          return { status: 'failed', code: 'invalid-artifact', reason: 'Tripo succeeded but returned no STL download URL' };
        }
        const stlBytes = await (await fetchImpl(stlUrl, { signal })).arrayBuffer();
        if (stlBytes.byteLength <= 84) {
          return { status: 'failed', code: 'invalid-artifact', reason: 'Tripo STL payload too small' };
        }
        return { status: 'succeeded', payload: { kind: 'mesh', stlBytes } };
      }
      if (status === 'failed') {
        return {
          status: 'failed',
          code: 'generation-failed',
          reason: typeof data.error === 'string' ? data.error : 'Tripo generation failed',
        };
      }
      return { status: status === 'queued' ? 'queued' : 'running' };
    },
  };
}