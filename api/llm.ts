import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Vercel serverless function for /api/llm on the deployed site.
// FULLY SELF-CONTAINED (no imports from server/) so @vercel/node reliably
// bundles it — the deployed function only depends on node_modules.
// This mirrors server/llmRelay.ts + server/supabase.ts (the local Express path);
// keep the allowlists and behavior in sync.
// ---------------------------------------------------------------------------

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
const SERVER_KEY_ENV: Record<string, string | undefined> = {
  claude: process.env.ANTHROPIC_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  deepseek: process.env.DEEPSEEK_API_KEY,
  kimi: process.env.MOONSHOT_API_KEY,
  fireworks: process.env.FIREWORKS_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
};
const FREE_MONTHLY_LIMIT = Number(process.env.FREE_MONTHLY_LIMIT || 100);

let sbClient: ReturnType<typeof createClient> | null = null;
function getSb() {
  if (sbClient) return sbClient;
  const url = process.env.SUPABASE_URL;
  const role = process.env.SUPABASE_SERVICE_ROLE_KEY;
  sbClient = url && role ? createClient(url, role, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return sbClient;
}

async function verifyUser(token: string): Promise<string | null> {
  const client = getSb();
  if (!client) return null;
  const auth = client.auth as unknown as {
    getUser: (t: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  const { data, error } = await auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

// Call the consume_usage RPC directly via PostgREST HTTP. @vercel/node's bundling
// of supabase-js leaves `client.rest` undefined (so client.rpc() throws), but a
// plain fetch to the REST endpoint is version-independent and reliable.
async function consumeUsage(userId: string, limit: number): Promise<number | null> {
  const url = process.env.SUPABASE_URL;
  const role = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !role) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/consume_usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: role, Authorization: `Bearer ${role}` },
      body: JSON.stringify({ p_user: userId, p_limit: limit }),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return typeof data === "number" ? data : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  const { provider, apiKey, body } = (req.body ?? {}) as Record<string, unknown>;
  const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const json = (o: unknown) => JSON.stringify(o);

  try {
    if (typeof provider !== "string") return res.status(400).json({ error: "provider is required" });
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return res.status(400).json({ error: "body must be an object" });

    let effectiveKey = typeof apiKey === "string" && apiKey.length > 0 ? apiKey : "";
    if (bearer) {
      const userId = await verifyUser(bearer);
      if (!userId) return res.status(401).json({ error: "invalid or expired session" });
      const serverKey = SERVER_KEY_ENV[provider];
      if (!serverKey) return res.status(503).json({ error: "provider_not_configured" });
      effectiveKey = serverKey;
      const remaining = await consumeUsage(userId, FREE_MONTHLY_LIMIT);
      if (remaining !== null && remaining <= 0) return res.status(429).json({ error: "quota_exceeded" });
    }
    if (effectiveKey.length === 0)
      return res.status(400).json({ error: "provider and apiKey are required" });

    const allowedModels = LLM_ALLOWED_MODELS[provider];
    if (!allowedModels) return res.status(400).json({ error: "provider not allowed" });
    const model = typeof (body as { model?: unknown }).model === "string" ? (body as { model: string }).model : "";
    if (!allowedModels.has(model)) return res.status(400).json({ error: "model not allowed" });

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
    res.status(upstream.status).setHeader("Content-Type", "application/json").send(text || "{}");
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    res.status(timedOut ? 504 : 500).json({ error: "LLM proxy failed", detail: String(err) });
  }
}
