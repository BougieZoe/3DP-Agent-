import type { Request, Response } from 'express';
import { verifyUser, consumeUsage } from './supabase';

// Shared /api/llm relay logic — used by BOTH the Express server (local/Electron)
// and the Vercel serverless function (api/llm.ts) so behavior is identical.
// The user's key travels through here per-request and is NEVER stored.

const LLM_ENDPOINTS: Record<string, string> = {
  claude: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  kimi: "https://api.moonshot.cn/v1/chat/completions",
  fireworks: "https://api.fireworks.ai/inference/v1/chat/completions",
  zhipu: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
};
const LLM_ALLOWED_MODELS: Record<string, ReadonlySet<string>> = {
  claude: new Set(["claude-sonnet-4-20250514"]),
  openai: new Set(["gpt-4o"]),
  gemini: new Set(["gemini-3.6-flash"]),
  deepseek: new Set(["deepseek-chat"]),
  kimi: new Set(["kimi-k3"]),
  fireworks: new Set(["accounts/fireworks/models/deepseek-v4-pro"]),
  zhipu: new Set(["glm-4.7"]),
};
// Server-hosted keys for signed-in users.
const SERVER_KEY_ENV: Record<string, string | undefined> = {
  claude: process.env.ANTHROPIC_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  deepseek: process.env.DEEPSEEK_API_KEY,
  kimi: process.env.MOONSHOT_API_KEY,
  fireworks: process.env.FIREWORKS_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
  zhipu: process.env.GLM_API_KEY,
};
const FREE_MONTHLY_LIMIT = Number(process.env.FREE_MONTHLY_LIMIT || 100);

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
      const remaining = await consumeUsage(user.id, FREE_MONTHLY_LIMIT);
      if (remaining !== null && remaining <= 0) return { status: 429, text: json({ error: "quota_exceeded" }) };
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
    if (bearer) {
      const user = await verifyUser(bearer);
      if (!user) { res.status(401).json({ error: "invalid or expired session" }); return; }
      const serverKey = SERVER_KEY_ENV[provider];
      if (!serverKey) { res.status(503).json({ error: "provider_not_configured" }); return; }
      effectiveKey = serverKey;
      const remaining = await consumeUsage(user.id, FREE_MONTHLY_LIMIT);
      if (remaining !== null && remaining <= 0) { res.status(429).json({ error: "quota_exceeded" }); return; }
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
