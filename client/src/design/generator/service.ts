import {
  DEFAULT_GENERATE_TIMEOUT_MS,
  type GeneratorAdapter,
  type GeneratorRequest,
  type GenerationError,
  type GenerationOutcome,
  type GeneratorJobState,
} from './types';

/**
 * generateDesign — the single consumer-facing facade for every generation
 * engine. Owns the job lifecycle (submit → poll with budget/backoff → settle),
 * external abort handling, and the inbound STL contract for mesh payloads.
 *
 * CAD adapters perform their own (bridge-side) contract validation inside
 * submit; the facade trusts the adapter's settled payload but still guards the
 * mesh path, whose STL bytes have no bridge contract behind them.
 */

const MIN_MESH_STL_BYTES = 84; // 80-byte header + 4-byte facet count
const POLL_INITIAL_BACKOFF_MS = 250;
const POLL_MAX_BACKOFF_MS = 3_000;

function fail(error: GenerationError): GenerationOutcome {
  return { ok: false, error };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function generateDesign(
  request: GeneratorRequest,
  adapter: GeneratorAdapter,
): Promise<GenerationOutcome> {
  if (request.signal?.aborted) return fail({ code: 'cancelled' });

  let available: boolean;
  try {
    available = await adapter.isAvailable();
  } catch {
    available = false;
  }
  if (!available) {
    return fail({
      code: 'transport-unavailable',
      detail: `generator "${adapter.id}" is not available (is the server running / API key configured?)`,
    });
  }

  let job;
  try {
    job = await adapter.submit(request);
  } catch (err) {
    if (request.signal?.aborted) return fail({ code: 'cancelled' });
    return fail({ code: 'transport-unavailable', detail: String(err) });
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let backoff = POLL_INITIAL_BACKOFF_MS;

  for (;;) {
    if (request.signal?.aborted) return fail({ code: 'cancelled' });

    let state: GeneratorJobState;
    try {
      state = await adapter.poll(job, request.signal);
    } catch (err) {
      if (request.signal?.aborted) return fail({ code: 'cancelled' });
      return fail({ code: 'transport-unavailable', detail: String(err) });
    }

    if (state.status === 'succeeded') {
      const payload = state.payload;
      if (payload.kind === 'cad') {
        const { generatedModel, stlBytes, repaired, repairType, attempts } = payload.result;
        return {
          ok: true,
          result: {
            modelId: generatedModel.id,
            stlBytes,
            generatedModel,
            repaired,
            repairType,
            attempts,
          },
        };
      }
      if (payload.stlBytes.byteLength <= MIN_MESH_STL_BYTES) {
        return fail({ code: 'invalid-artifact', detail: 'STL payload too small to be a valid mesh' });
      }
      return { ok: true, result: { modelId: job.id, stlBytes: payload.stlBytes } };
    }

    if (state.status === 'failed') {
      return fail(
        state.code === 'generation-timeout'
          ? { code: 'generation-timeout', timeoutMs }
          : { code: state.code, detail: state.reason },
      );
    }

    // queued / running — respect the poll budget.
    const remaining = deadline - Date.now();
    if (remaining <= 0) return fail({ code: 'generation-timeout', timeoutMs });
    const wait = Math.min(backoff, remaining);
    backoff = Math.min(POLL_MAX_BACKOFF_MS, backoff * 2);
    await sleep(wait);
  }
}
