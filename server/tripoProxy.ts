/**
 * tripoProxy — server-side relay for the Tripo text-to-3D API.
 *
 * The Tripo key lives here (server env), NEVER in the client bundle. The
 * browser only talks to this proxy; Tripo's temporary signed download URLs
 * are returned to the client unchanged (they expire and carry no secret).
 *
 * Security posture mirrors the AMD proxy:
 *   - mounted only when bridges are enabled (production requires BRIDGE_TOKEN)
 *   - rate-limited + loopback-guarded by the caller (index.ts middleware)
 *   - request body validated before any upstream fetch
 */
import { Router, json as expressJson, type Request, type Response } from 'express';

const TRIPO_BASE_URL = (
  process.env.TRIPO_BASE_URL ?? 'https://api.tripo3d.ai/v2/openapi'
).replace(/\/+$/, '');
const TRIPO_API_KEY = process.env.TRIPO_API_KEY ?? '';
const MAX_PROMPT_LENGTH = 4000;

function sendError(res: Response, status: number, code: string, detail: string): void {
  res.status(status).json({ ok: false, error: { code, detail } });
}

/**
 * Tripo business failures arrive as `{ code: <nonzero>, message: ... }` —
 * sometimes even on HTTP 200 — so they'd pass through and make the client
 * report a confusing "no task_id" / parse error. Normalize them to the same
 * `{ ok: false, error }` shape as our own guard failures.
 */
function isTripoBusinessError(body: unknown): body is { code: number; message?: string } {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { code?: unknown }).code === 'number' &&
    (body as { code: number }).code !== 0
  );
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createTripoProxyRouter(): Router {
  const router = Router();
  router.use(expressJson({ limit: '64kb' }));

  router.get('/health', (_req, res) => {
    res.json({ ok: true, ready: TRIPO_API_KEY.length > 0 });
  });

  // Submit a text_to_model job. Client sends only the prompt; the API key and
  // job type are fixed server-side.
  router.post('/task', async (req, res) => {
    if (!TRIPO_API_KEY) {
      sendError(res, 503, 'transport-unavailable', 'TRIPO_API_KEY not configured on the server');
      return;
    }
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (prompt.length === 0) {
      sendError(res, 400, 'generation-failed', 'prompt must be a non-empty string');
      return;
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      sendError(res, 400, 'generation-failed', `prompt too long (max ${MAX_PROMPT_LENGTH} chars)`);
      return;
    }

    try {
      const upstream = await fetch(`${TRIPO_BASE_URL}/task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TRIPO_API_KEY}`,
        },
        body: JSON.stringify({ type: 'text_to_model', prompt }),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await upstream.text();
      const body = parseJsonLoose(text);
      if (isTripoBusinessError(body)) {
        // e.g. HTTP 200 + {code:2010, message:"You don't have enough credit..."}
        sendError(res, 402, body.code === 2010 ? 'generation-failed' : 'generation-failed', body.message ?? `Tripo rejected the task (code ${body.code})`);
        return;
      }
      res.status(upstream.status).set('Content-Type', 'application/json').send(text || '{}');
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      sendError(res, timedOut ? 504 : 502, 'generation-failed', `Tripo submit failed: ${String(err)}`);
    }
  });

  // Poll a job. The response (incl. signed download URLs) passes through.
  router.get('/task/:id', async (req, res) => {
    const id = req.params.id ?? '';
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      sendError(res, 400, 'invalid-artifact', 'invalid task id');
      return;
    }
    if (!TRIPO_API_KEY) {
      sendError(res, 503, 'transport-unavailable', 'TRIPO_API_KEY not configured on the server');
      return;
    }
    try {
      const upstream = await fetch(`${TRIPO_BASE_URL}/task/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${TRIPO_API_KEY}` },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await upstream.text();
      const body = parseJsonLoose(text);
      if (isTripoBusinessError(body)) {
        sendError(res, 402, 'generation-failed', body.message ?? `Tripo rejected the poll (code ${body.code})`);
        return;
      }
      res.status(upstream.status).set('Content-Type', 'application/json').send(text || '{}');
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      sendError(res, timedOut ? 504 : 502, 'generation-failed', `Tripo poll failed: ${String(err)}`);
    }
  });

  return router;
}
