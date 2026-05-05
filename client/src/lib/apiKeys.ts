/**
 * API Key manager — stored in localStorage, never sent to our server
 */

export type AIProvider = 'claude' | 'openai' | 'gemini';

const STORAGE_KEY = '3dp_agent_api_keys';

export interface APIKeys {
  claude?: string;
  openai?: string;
  gemini?: string;
}

export function getAPIKeys(): APIKeys {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveAPIKeys(keys: APIKeys) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function getKey(provider: AIProvider): string | undefined {
  return getAPIKeys()[provider];
}

export function hasAnyKey(): boolean {
  const keys = getAPIKeys();
  return !!(keys.claude || keys.openai || keys.gemini);
}

export function getActiveProvider(): AIProvider | null {
  const keys = getAPIKeys();
  if (keys.claude) return 'claude';
  if (keys.openai) return 'openai';
  if (keys.gemini) return 'gemini';
  return null;
}

export async function callAI(
  provider: AIProvider,
  apiKey: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  if (provider === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
    const data = await res.json();
    return data.content?.[0]?.text || 'No response';
  }

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'No response';
  }

  if (provider === 'gemini') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\n${userMessage}` }] }],
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
  }

  throw new Error('Unknown provider');
}
