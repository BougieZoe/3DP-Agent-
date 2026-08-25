import type { Request, Response } from 'express';
import { verifyUser, consumeUsage, getUserPlan } from './supabase';
import { LLM_ENDPOINTS, LLM_ALLOWED_MODELS, SERVER_KEY_ENV, PLAN_LIMITS } from '../shared/config/llm';

// Shared /api/llm relay logic — used by BOTH the Express server (local/Electron)
// and the Vercel serverless function (api/llm.ts) so behavior is identical.
// The user's key travels through here per-request and is NEVER stored.

export interface RelayResult {
  status: number;
  text: string;
}

export async function relayLLM(params: {
  provider: string;
  apiKey: unknown;
  body: unknown;
  bearer?: string;
}): Promise<RelayResult> {
  const { provider, apiKey, body, bearer = "" } = params;
  const json = (o: unknown) => JSON.stringify(o);
  try {
    if (typeof provider !== "string") return { status: 400, text: json({ error: "provider is required" }) };
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return { status: 400, text: json({ error: "body must be an object" }) };

    // Hosted path: a valid Supabase session gets a server-side key + monthly
    // quota. Anonymous path: the client's own key (BYOK) is used as before.
    let effectiveKey = typeof apiKey === "string" && apiKey.length > 0 ? apiKey : "";
    if (bearer) {
      const user = await verifyUser(bearer);
      if (!user) return { status: 401, text: json({ error: "invalid or expired session" }) };
      const serverKey = SERVER_KEY_ENV[provider];
      if (!serverKey) return { status: 503, text: json({ error: "provider_not_configured" }) };
      effectiveKey = serverKey;
      // Get user's plan and apply the corresponding limit
      const plan = await getUserPlan(user.id);
      const monthlyLimit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
      const remaining = await consumeUsage(user.id, monthlyLimit);
      if (remaining !== null && remaining <= 0) return { status: 429, text: json({ error: "quota_exceeded", remaining: 0, limit: monthlyLimit, plan }) };
    }
    if (effectiveKey.length === 0)
      return { status: 400, text: json({ error: "provider and apiKey are required" }) };

    const allowedModels = LLM_ALLOWED_MODELS[provider];
    if (!allowedModels) return { status: 400, text: json({ error: "provider not allowed" }) };
    const model = typeof (body as { model?: unknown }).model === "string" ? (body as { model: string }).model : "";
    if (!allowedModels.has(model)) return { status: 400, text: json({ error: "model not allowed" }) };

    const target =
      provider === "gemini"
        ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
        : LLM_ENDPOINTS[provider];

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider === "claude") {
      headers["x-api-key"] = effectiveKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (provider === "gemini") {
      headers["x-goog-api-key"] = effectiveKey;
    } else {
      headers["Authorization"] = `Bearer ${effectiveKey}`;
    }

    const upstream = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await upstream.text();
    return { status: upstream.status, text: text || "{}" };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return { status: timedOut ? 504 : 500, text: json({ error: "LLM proxy failed", detail: String(err) }) };
  }
}

// ── Streaming relay ────────────────────────────────────────────────────────

/**
 * Streaming variant of the relay — pipes the upstream SSE stream directly to
 * the client. Used by /api/llm/stream for real-time token-by-token output.
 */
export async function relayLLMStream(req: Request, res: Response): Promise<void> {
  const { provider, apiKey, body } = (req.body ?? {}) as Record<string, unknown>;
  const bearer = typeof (req.body as Record<string, unknown>)?.bearer === "string"
    ? (req.body as Record<string, unknown>).bearer as string
    : "";
  const json = (o: unknown) => JSON.stringify(o);

  try {
    if (typeof provider !== "string") { res.status(400).json({ error: "provider is required" }); return; }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      res.status(400).json({ error: "body must be an object" }); return;
    }

    let effectiveKey = typeof apiKey === "string" && apiKey.length > 0 ? apiKey : "";
    if (typeof bearer === "string" && bearer) {
      const user = await verifyUser(bearer);
      if (!user) { res.status(401).json({ error: "invalid or expired session" }); return; }
      const serverKey = SERVER_KEY_ENV[provider];
      if (!serverKey) { res.status(503).json({ error: "provider_not_configured" }); return; }
      effectiveKey = serverKey;
      const plan = await getUserPlan(user.id);
      const monthlyLimit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
      const remaining = await consumeUsage(user.id, monthlyLimit);
      if (remaining !== null && remaining <= 0) { res.status(429).json({ error: "quota_exceeded", remaining: 0, limit: monthlyLimit, plan }); return; }
    }
    if (effectiveKey.length === 0) {
      res.status(400).json({ error: "provider and apiKey are required" }); return;
    }

    const allowedModels = LLM_ALLOWED_MODELS[provider];
    if (!allowedModels) { res.status(400).json({ error: "provider not allowed" }); return; }
    const model = typeof (body as { model?: unknown }).model === "string" ? (body as { model: string }).model : "";
    if (!allowedModels.has(model)) { res.status(400).json({ error: "model not allowed" }); return;

    }

    // Gemini uses a different streaming endpoint
    const target =
      provider === "gemini"
        ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
        : LLM_ENDPOINTS[provider];

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider === "claude") {
      headers["x-api-key"] = effectiveKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (provider === "gemini") {
      headers["x-goog-api-key"] = effectiveKey;
    } else {
      headers["Authorization"] = `Bearer ${effectiveKey}`;
    }

    const upstream = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.status(upstream.status).json({ error: `Upstream error: ${errText}` });
      return;
    }

    // Set SSE headers and pipe the response body
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    if (!upstream.body) {
      res.status(502).json({ error: "No response body from upstream" });
      return;
    }

    // Pipe the readable stream to the Express response
    const reader = upstream.body.getReader();
    const encoder = new TextEncoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch (err) {
      // Client disconnected or read error — stop gracefully
    } finally {
      reader.releaseLock();
      res.end();
    }
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    res.status(timedOut ? 504 : 500).json({ error: "LLM stream proxy failed", detail: String(err) });
  }
}
