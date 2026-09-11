// client/src/lib/config.ts
//
// Holds values that change over time — currently just the AMD Cloud endpoint.
// Every time you destroy and recreate your AMD Droplet, you get a new IP.
// This is the ONLY place you need to update it — apiKeys.ts imports from here
// instead of hardcoding the address.
//
// Claude / OpenAI / Gemini / DeepSeek don't need this treatment: their URLs
// are permanent addresses maintained by those companies, not infrastructure
// you personally spin up and tear down.

export const AMD_CLOUD_ENDPOINT = '/api/amd-proxy';

// Same-origin relay for ALL keyed LLM providers (claude/openai/gemini/
// deepseek/kimi/fireworks). Browser-origin calls to Anthropic/Moonshot/Gemini
// are blocked by CORS, so every provider call goes through our server, which
// forwards with the user's key attached per-request (never stored).
export const LLM_PROXY_ENDPOINT = '/api/llm';

/**
 * Semantic Diagnostic Layer provider.
 *
 * - "none"  (default): skip the module entirely; pipeline shows raw structured facts.
 * - "local": call a local OpenAI-compatible endpoint (e.g. Lemonade, Ollama).
 * - "cloud": call through the existing /api/llm relay with the user's key.
 *
 * Set via window.__SEMANTIC_LAYER_PROVIDER__ at runtime, or defaults to "none".
 */
export type SemanticLayerProvider = 'none' | 'local' | 'cloud';

export function getSemanticLayerProvider(): SemanticLayerProvider {
  const raw = (window as unknown as Record<string, unknown>).__SEMANTIC_LAYER_PROVIDER__
    ?? (import.meta.env.VITE_SEMANTIC_LAYER_PROVIDER as string | undefined)
    ?? 'none';
  if (raw === 'local' || raw === 'cloud') return raw;
  return 'none';
}

/** Endpoint for the "local" provider (OpenAI-compatible). */
export const SEMANTIC_LAYER_LOCAL_ENDPOINT = '/v1/chat/completions';

/** Timeout for semantic diagnostic LLM call (ms). */
export const SEMANTIC_LAYER_TIMEOUT_MS = 15_000;