import { describe, it, expect, beforeEach } from 'vitest';
import { getAPIKeys, saveAPIKeys, getKey, getActiveProvider, getSelectedProvider, setSelectedProvider, callAI } from '../apiKeys';

const STORAGE_KEY = '3dp_agent_api_keys';
const ACTIVE_PROVIDER_KEY = '3dp_agent_active_provider';

function rawStored(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

describe('apiKeys obfuscation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips save → get without losing the key', () => {
    saveAPIKeys({ fireworks: 'fw_secret123' } as never);
    expect(getKey('fireworks')).toBe('fw_secret123');
    expect(getAPIKeys()).toEqual({ fireworks: 'fw_secret123' } as never);
  });

  it('does not store the plaintext key in localStorage', () => {
    saveAPIKeys({ deepseek: 'sk-plaintext' } as never);
    const raw = rawStored();
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('sk-plaintext');
    // Obfuscated values carry a version prefix so we can migrate later.
    expect(raw).toContain('obf1:');
  });

  it('migrates legacy plaintext values transparently', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ claude: 'sk-ant-legacy' }));
    expect(getKey('claude')).toBe('sk-ant-legacy');
    // Saving after migration re-obfuscates everything.
    saveAPIKeys(getAPIKeys());
    expect(rawStored()).not.toContain('sk-ant-legacy');
    expect(rawStored()).toContain('obf1:');
  });

  it('skips corrupted entries instead of throwing', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ claude: 'obf1:%%%not-valid-base64%%%', openai: 'obf1:abc' }),
    );
    // Neither value is valid obfuscated data; both must be dropped silently.
    expect(getAPIKeys()).toEqual({});
  });

  it('handles empty object and missing storage', () => {
    saveAPIKeys({} as never);
    expect(getAPIKeys()).toEqual({});
    expect(getActiveProvider()).toBeNull();
  });

  it('active provider selection respects stored keys', () => {
    saveAPIKeys({ deepseek: 'sk-ds' } as never);
    setSelectedProvider('deepseek');
    expect(getSelectedProvider()).toBe('deepseek');
    expect(getActiveProvider()).toBe('deepseek');
    // Selecting a provider with no saved key falls back to the first keyed one.
    setSelectedProvider('claude');
    expect(getActiveProvider()).toBe('deepseek');
  });
});

describe('callAI relay', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('routes keyed providers through the /api/llm relay with provider + key + body', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: { provider?: string; apiKey?: string; body?: { model?: string; messages?: unknown[] } } }> = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      calls.push({ url: String(_input), body: init?.body ? JSON.parse(String(init.body)) : {} });
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'hello from deepseek' } }] }) } as unknown as Response;
    }) as typeof fetch;
    try {
      const out = await callAI('deepseek', 'sk-test', 'You are a printer', 'check this', 'en');
      expect(out).toBe('hello from deepseek');
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('/api/llm');
      expect(calls[0].body.provider).toBe('deepseek');
      expect(calls[0].body.apiKey).toBe('sk-test');
      expect(calls[0].body.body?.model).toBe('deepseek-chat');
      expect(calls[0].body.body?.messages).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps amd-cloud on its keyless same-origin /api/amd-proxy path', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string }> = [];
    globalThis.fetch = (async (input: unknown) => {
      calls.push({ url: String(input) });
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'amd reply' } }] }) } as unknown as Response;
    }) as typeof fetch;
    try {
      const out = await callAI('amd-cloud', '', 'sys', 'usr');
      expect(out).toBe('amd reply');
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('/api/amd-proxy');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces the /api/llm status as a typed error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 429 }) as unknown as Response) as typeof fetch;
    try {
      await expect(callAI('openai', 'sk-test', 'sys', 'usr')).rejects.toThrow('openai API error: 429');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
