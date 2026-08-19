// client/src/lib/llmProxy.ts
//
// Single client-side entry point for calling keyed LLM providers. Every call
// (chat through callAI, vision through visionProvider) POSTs to the same-origin
// /api/llm relay with the user's key attached per-request. The relay exists
// because Anthropic / Moonshot / Gemini block browser-origin CORS calls; the
// server forwards to the provider and never stores the key.
//
// Model names live HERE (one source of truth on the client). The server keeps
// its own allowlist copy as the security boundary — deliberate duplication
// across the process boundary.

import type { AIProviderId } from '@shared/domain/providers';
import { LLM_PROXY_ENDPOINT } from './config';
import { getAuthSnapshot } from './authStore';

export const CHAT_COMPLETION_MODELS: Partial<Record<AIProviderId, string>> = {
  openai: 'gpt-4o',
  deepseek: 'deepseek-chat',
  kimi: 'kimi-k3',
  fireworks: 'accounts/fireworks/models/deepseek-v4-pro',
};

export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
export const GEMINI_MODEL = 'gemini-2.0-flash';

/**
 * POST a provider-specific body to the /api/llm relay.
 *
 * Signed-in: attaches the Supabase access token (server uses its own key) and
 * omits apiKey. Anonymous: sends the user's own key (BYOK) as before.
 */
export async function callLLMProxy(
  provider: AIProviderId,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  // Synchronous token read — AuthContext keeps the snapshot fresh, so we avoid
  // an async getSession() round-trip on every LLM call.
  const token = getAuthSnapshot().token;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const payload: Record<string, unknown> = { provider, body };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  else payload.apiKey = apiKey;
  return fetch(LLM_PROXY_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });
}