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
};
const LLM_ALLOWED_MODELS: Record<string, ReadonlySet<string>> = {
  claude: new Set(["claude-sonnet-4-20250514"]),
  openai: new Set(["gpt-4o"]),
  gemini: new Set(["gemini-2.0-flash"]),
  deepseek: new Set(["deepseek-chat"]),
  kimi: new Set(["kimi-k3"]),
  fireworks: new Set(["accounts/fireworks/models/deepseek-v4-pro"]),
};
// Server-hosted keys for signed-in users.
const SERVER_KEY_ENV: Record<string, string | undefined> = {
  claude: process.env.ANTHROPIC_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  deepseek: process.env.DEEPSEEK_API_KEY,
  kimi: process.env.MOONSHOT_API_KEY,
  fireworks: process.env.FIREWORKS_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
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
