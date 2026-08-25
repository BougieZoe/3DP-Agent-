/**
 * Shared LLM Configuration
 *
 * Single source of truth for LLM endpoints, allowed models, and server keys.
 * Used by server/llmRelay.ts (Express) and api/llm.ts (Vercel serverless).
 *
 * NOTE: api/llm.ts is SELF-CONTAINED for Vercel bundling and duplicates this config.
 * If you update models/endpoints here, ALSO update api/llm.ts to stay in sync.
 */

// ── Provider Endpoints ─────────────────────────────────────────────────────

export const LLM_ENDPOINTS: Record<string, string> = {
  claude: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  kimi: "https://api.moonshot.cn/v1/chat/completions",
  fireworks: "https://api.fireworks.ai/inference/v1/chat/completions",
  zhipu: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
};

// ── Allowed Models (whitelist) ─────────────────────────────────────────────

export const LLM_ALLOWED_MODELS: Record<string, ReadonlySet<string>> = {
  claude: new Set(["claude-sonnet-4-20250514"]),
  openai: new Set(["gpt-4o"]),
  gemini: new Set(["gemini-3.6-flash"]),
  deepseek: new Set(["deepseek-chat"]),
  kimi: new Set(["kimi-k3"]),
  fireworks: new Set(["accounts/fireworks/models/deepseek-v4-pro"]),
  zhipu: new Set(["glm-4.7"]),
};

// ── Server-side API Key Environment Variables ──────────────────────────────

export const SERVER_KEY_ENV: Record<string, string | undefined> = {
  claude: process.env.ANTHROPIC_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  deepseek: process.env.DEEPSEEK_API_KEY,
  kimi: process.env.MOONSHOT_API_KEY,
  fireworks: process.env.FIREWORKS_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
  zhipu: process.env.GLM_API_KEY,
};

// ── Plan-based Monthly Limits ──────────────────────────────────────────────

export const PLAN_LIMITS: Record<string, number> = {
  free: Number(process.env.FREE_MONTHLY_LIMIT || 100),
  pro: Number(process.env.PRO_MONTHLY_LIMIT || 1000),
};
