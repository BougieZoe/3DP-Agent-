import { AI_PROVIDERS, type AIProviderId } from '@shared/domain/providers';
import { LANGUAGE_NAMES } from '@shared/i18n/content';
import { AMD_CLOUD_ENDPOINT } from './config';
import { callLLMProxy, CHAT_COMPLETION_MODELS, CLAUDE_MODEL, GEMINI_MODEL } from './llmProxy';

/**
 * API Key manager — stored in localStorage, relayed through our server per
 * request, never persisted server-side.
 */

export type AIProvider = AIProviderId;

const STORAGE_KEY = '3dp_agent_api_keys';
const ACTIVE_PROVIDER_KEY = '3dp_agent_active_provider';

// ---------------------------------------------------------------------------
// BYOK key storage — obfuscation, not real security.
//
// This product is account-less and keeps keys encrypted-at-rest in the
// browser. An attacker who can execute JS in the page (XSS) can always call
// the decrypt function below — obfuscation cannot stop that, and we do not
// pretend it can.
//
// What this DOES stop: someone opening DevTools out of curiosity, shoulder
// surfing, or recovering keys from a localStorage backup. It also makes casual
// key theft ~impossible without deliberate effort.
//
// The key is sent to our own same-origin /api/llm relay on every LLM call
// (it must be, so the server can forward it to the provider). The relay never
// stores it, and the model allowlist + rate limit bound what the relay will
// forward (see server/index.ts). We changed the "never sent to our servers"
// claim accordingly: the browser is still the only place keys are stored.
// ---------------------------------------------------------------------------

const OBFUSCATION_SALT = '3dp-agent-key-v1';
const STORAGE_VERSION_PREFIX = 'obf1:'; // marks values obfuscated with salt v1

function obfuscate(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i) ^ OBFUSCATION_SALT.charCodeAt(i % OBFUSCATION_SALT.length);
    out += String.fromCharCode(code);
  }
  return STORAGE_VERSION_PREFIX + btoa(unescape(encodeURIComponent(out)));
}

function deobfuscate(value: string): string | null {
  if (!value.startsWith(STORAGE_VERSION_PREFIX)) return value; // legacy plaintext
  const encoded = value.slice(STORAGE_VERSION_PREFIX.length);
  try {
    const decoded = decodeURIComponent(escape(atob(encoded)));
    let out = '';
    for (let i = 0; i < decoded.length; i++) {
      out += String.fromCharCode(
        decoded.charCodeAt(i) ^ OBFUSCATION_SALT.charCodeAt(i % OBFUSCATION_SALT.length),
      );
    }
    return out;
  } catch {
    return null;
  }
}

export type APIKeys = Partial<Record<AIProvider, string>>;

export function getAPIKeys(): APIKeys {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const keys: APIKeys = {};
    for (const provider of Object.keys(parsed)) {
      const v = parsed[provider];
      if (typeof v !== 'string') continue;
      const cleared = deobfuscate(v);
      if (cleared !== null) keys[provider as AIProvider] = cleared;
    }
    return keys;
  } catch { return {}; }
}

export function saveAPIKeys(keys: APIKeys) {
  const enc: Record<string, string> = {};
  for (const provider of Object.keys(keys)) {
    const v = keys[provider as AIProvider];
    if (v) enc[provider] = obfuscate(v);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(enc));
}

export function getKey(provider: AIProvider): string | undefined {
  return getAPIKeys()[provider];
}

export function hasAnyKey(): boolean {
  const keys = getAPIKeys();
  return AI_PROVIDERS.some(provider => !!keys[provider.id]);
}

export function getSelectedProvider(): AIProvider | null {
  try {
    return (localStorage.getItem(ACTIVE_PROVIDER_KEY) as AIProvider) || null;
  } catch { return null; }
}

export function setSelectedProvider(provider: AIProvider) {
  localStorage.setItem(ACTIVE_PROVIDER_KEY, provider);
}

export function getActiveProvider(): AIProvider | null {
  const keys = getAPIKeys();
  // Prefer the user's explicit choice, but only if that provider actually
  // has a key saved (avoids pointing at a provider whose key got cleared).
  const selected = getSelectedProvider();
  if (selected && !!keys[selected]) return selected;
  // Fallback for users who saved keys before this selector existed.
  const provider = AI_PROVIDERS.find(provider => !!keys[provider.id]);
  if (provider) return provider.id;
  return null;
}

function langInstruction(language?: string): string {
  if (!language) return '';
  const name = LANGUAGE_NAMES[language as keyof typeof LANGUAGE_NAMES] ?? 'English';
  return `\n\nPlease respond in ${name}. Use natural and professional ${name} terms. Current interface language is ${language}.`;
}

/** Build the provider-specific request body for the /api/llm relay. */
function buildLLMBody(provider: AIProvider, systemPrompt: string, userMessage: string): Record<string, unknown> {
  if (provider === 'claude') {
    return {
      model: CLAUDE_MODEL,
      max_tokens: 1024,
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
  if (!model) {
    throw new Error('Unknown provider');
  }
  // OpenAI / DeepSeek / Kimi / Fireworks share the chat-completions shape.
  return {
    model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  };
}

function extractAIResponseText(provider: AIProvider, data: Record<string, unknown>): string {
  if (provider === 'claude') {
    return (data.content as Array<{ text?: string }> | undefined)?.[0]?.text || 'No response';
  }
  if (provider === 'gemini') {
    return (data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined)
      ?.[0]?.content?.parts?.[0]?.text || 'No response';
  }
  return (data.choices as Array<{ message?: { content?: string } }> | undefined)
    ?.[0]?.message?.content || 'No response';
}

export async function callAI(
  provider: AIProvider,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  language?: string,
  signal?: AbortSignal,
): Promise<string> {
  systemPrompt += langInstruction(language);

  // AMD Cloud needs no key and is already same-origin via /api/amd-proxy.
  if (provider === 'amd-cloud') {
    const res = await fetch(AMD_CLOUD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Qwen/Qwen3-8B', // Notebook only has 48GB VRAM — 30B OOMs, 8B is what's actually served
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal,
    });
    if (!res.ok) {
      throw new Error(`AMD Cloud API error: ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'No response';
  }

  // Every keyed provider goes through the same-origin /api/llm relay — the
  // browser cannot call Anthropic/Moonshot/Gemini directly (CORS).
  const res = await callLLMProxy(provider, apiKey, buildLLMBody(provider, systemPrompt, userMessage), signal);
  if (!res.ok) throw new Error(`${provider} API error: ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  return extractAIResponseText(provider, data);
}