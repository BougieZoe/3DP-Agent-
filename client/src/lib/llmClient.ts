/**
 * Production-grade LLM Client
 *
 * Enhancements over the base callAI():
 * 1. Streaming — callAIStream() returns an async iterator of text chunks
 * 2. Retry + exponential backoff — transient failures auto-retry
 * 3. Cost tracking — extracts token usage from provider responses
 */

import { callLLMProxy, CHAT_COMPLETION_MODELS, CLAUDE_MODEL, GEMINI_MODEL } from './llmProxy';
import { AMD_CLOUD_ENDPOINT } from './config';
import type { AIProvider } from './apiKeys';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  text: string;
  usage: LLMUsage;
  provider: AIProvider;
  model: string;
}

export interface StreamChunk {
  /** Incremental text delta */
  delta: string;
  /** Full accumulated text so far */
  fullText: string;
}

export interface RetryConfig {
  /** Max retry attempts (default: 2) */
  maxRetries: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs: number;
  /** Max delay in ms (default: 10000) */
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

// ── Cost tracking ──────────────────────────────────────────────────────────

/** Approximate cost per 1M tokens (USD) — used for display only */
const COST_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o':                     { input: 2.50,  output: 10.00 },
  'claude-sonnet-4-20250514':   { input: 3.00,  output: 15.00 },
  'gemini-3.6-flash':           { input: 0.075, output: 0.30  },
  'deepseek-chat':              { input: 0.14,  output: 0.28  },
  'kimi-k3':                    { input: 0.70,  output: 2.10  },
  'accounts/fireworks/models/deepseek-v4-pro': { input: 0.90, output: 0.90 },
  'glm-4.7':                    { input: 0.35,  output: 1.40  },
  'Qwen/Qwen3-8B':             { input: 0,     output: 0     },
};

export function estimateCostUSD(model: string, usage: LLMUsage): number {
  const rates = COST_PER_1M_TOKENS[model];
  if (!rates) return 0;
  return (usage.promptTokens * rates.input + usage.completionTokens * rates.output) / 1_000_000;
}

// ── Token usage extraction ─────────────────────────────────────────────────

function extractUsage(provider: AIProvider, data: Record<string, unknown>): LLMUsage {
  const u = data.usage as Record<string, unknown> | undefined;
  const prompt = typeof u?.prompt_tokens === 'number' ? u.prompt_tokens : 0;
  const completion = typeof u?.completion_tokens === 'number' ? u.completion_tokens : 0;

  // Claude returns usage in a different shape
  if (provider === 'claude' && typeof u?.input_tokens === 'number') {
    return {
      promptTokens: u.input_tokens as number,
      completionTokens: u.output_tokens as number ?? 0,
      totalTokens: (u.input_tokens as number) + (u.output_tokens as number ?? 0),
    };
  }

  return { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion };
}

// ── Request body builders (with stream support) ────────────────────────────

function buildLLMBodyStream(
  provider: AIProvider,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1024,
): Record<string, unknown> {
  const base = buildLLMBodyBase(provider, systemPrompt, userMessage, maxTokens);
  // All providers support stream:true for SSE
  return { ...base, stream: true };
}

function buildLLMBodyBase(
  provider: AIProvider,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1024,
): Record<string, unknown> {
  if (provider === 'claude') {
    return {
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    };
  }
  if (provider === 'gemini') {
    return {
      model: GEMINI_MODEL,
      contents: [{ parts: [{ text: `${systemPrompt}\n\n${userMessage}` }] }],
    };
  }
  const model = CHAT_COMPLETION_MODELS[provider];
  if (!model) throw new Error(`Unknown provider: ${provider}`);
  return {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  };
}

// ── Retry logic ────────────────────────────────────────────────────────────

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Network errors, timeouts, rate limits (429), server errors (5xx)
  return (
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('rate limit')
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Enhanced callAI with retry + backoff + cost tracking.
 * Returns full LLMResponse with usage data.
 */
export async function callAIEnhanced(
  provider: AIProvider,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  language?: string,
  signal?: AbortSignal,
  retryConfig: Partial<RetryConfig> = {},
): Promise<LLMResponse> {
  const config = { ...DEFAULT_RETRY, ...retryConfig };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(2, attempt - 1),
          config.maxDelayMs,
        );
        await sleep(delay);
      }

      const langSuffix = language
        ? `\n\nPlease respond in ${language}. Use natural and professional terms.`
        : '';

      // AMD Cloud path
      if (provider === 'amd-cloud') {
        const res = await fetch(AMD_CLOUD_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'Qwen/Qwen3-8B',
            max_tokens: 1024,
            messages: [
              { role: 'system', content: systemPrompt + langSuffix },
              { role: 'user', content: userMessage },
            ],
          }),
          signal,
        });
        if (!res.ok) throw new Error(`AMD Cloud API error: ${res.status}`);
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || 'No response';
        return {
          text,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          provider,
          model: 'Qwen/Qwen3-8B',
        };
      }

      // Keyed providers via relay
      const body = buildLLMBodyBase(provider, systemPrompt + langSuffix, userMessage);
      const res = await callLLMProxy(provider, apiKey, body, signal);
      if (!res.ok) throw new Error(`${provider} API error: ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      const text = extractResponseText(provider, data);
      const usage = extractUsage(provider, data);
      const model = (body.model as string) || 'unknown';

      return { text, usage, provider, model };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= config.maxRetries || !isRetryableError(err) || signal?.aborted) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error('LLM call failed after retries');
}

/**
 * Streaming LLM call — returns an async iterator of text chunks.
 * Uses Server-Sent Events (SSE) from the provider.
 */
export async function* callAIStream(
  provider: AIProvider,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  language?: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk, LLMUsage, void> {
  const langSuffix = language
    ? `\n\nPlease respond in ${language}. Use natural and professional terms.`
    : '';

  // AMD Cloud doesn't support streaming — fall back to non-streaming
  if (provider === 'amd-cloud') {
    const res = await fetch(AMD_CLOUD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Qwen/Qwen3-8B',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt + langSuffix },
          { role: 'user', content: userMessage },
        ],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`AMD Cloud API error: ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || 'No response';
    yield { delta: text, fullText: text };
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  // Keyed providers — streaming via SSE
  const token = (await import('./authStore')).getAuthSnapshot().token;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const payload: Record<string, unknown> = {
    provider,
    body: buildLLMBodyStream(provider, systemPrompt + langSuffix, userMessage),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  else payload.apiKey = apiKey;

  const res = await fetch('/api/llm/stream', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${provider} streaming error: ${res.status} ${errText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';
  let usage: LLMUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            const delta = extractStreamDelta(provider, parsed);
            if (delta) {
              fullText += delta;
              yield { delta, fullText };
            }
            // Extract usage from final chunk
            if (parsed.usage) {
              usage = extractUsage(provider, parsed);
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return usage;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractResponseText(provider: AIProvider, data: Record<string, unknown>): string {
  if (provider === 'claude') {
    return (data.content as Array<{ text?: string }> | undefined)?.[0]?.text || 'No response';
  }
  if (provider === 'gemini') {
    return (data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined)
      ?.[0]?.content?.parts?.[0]?.text || 'No response';
  }
  return (data.choices as Array<{ delta?: { content?: string }; message?: { content?: string } }> | undefined)
    ?.[0]?.delta?.content
    || (data.choices as Array<{ message?: { content?: string } }> | undefined)
      ?.[0]?.message?.content
    || 'No response';
}

function extractStreamDelta(provider: AIProvider, parsed: Record<string, unknown>): string | null {
  if (provider === 'claude') {
    // Claude SSE: { type: "content_block_delta", delta: { text: "..." } }
    if (parsed.type === 'content_block_delta') {
      return (parsed.delta as { text?: string })?.text || null;
    }
    return null;
  }
  if (provider === 'gemini') {
    // Gemini SSE: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
    const candidates = parsed.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
    return candidates?.[0]?.content?.parts?.[0]?.text || null;
  }
  // OpenAI-compatible: { choices: [{ delta: { content: "..." } }] }
  const choices = parsed.choices as Array<{ delta?: { content?: string } }> | undefined;
  return choices?.[0]?.delta?.content || null;
}
