import { describe, expect, it } from 'vitest';
import { normalizeVisionIssues, visionProvider } from '../visionProvider';

describe('normalizeVisionIssues', () => {
  it('accepts only allowlisted structured categories', () => {
    expect(normalizeVisionIssues([
      { category: 'structural_damage', description: 'Visible crack at the base' },
      { category: 'not-a-category', description: 'Unclassified observation' },
      { category: 'deformation', description: '   ' },
    ])).toEqual([
      { category: 'structural_damage', description: 'Visible crack at the base' },
      { category: 'other', description: 'Unclassified observation' },
    ]);
  });

  it('keeps legacy string observations as non-escalating other findings', () => {
    expect(normalizeVisionIssues(['Visible crack', '  '])).toEqual([
      { category: 'other', description: 'Visible crack' },
    ]);
  });

  it('rejects malformed model output', () => {
    expect(normalizeVisionIssues({ observedIssues: [] })).toEqual([]);
    expect(normalizeVisionIssues([null, 42, { category: 'deformation' }])).toEqual([]);
  });
});

describe('visionProvider abort handling', () => {
  it('threads the abort signal into the fetch and falls back gracefully on abort', async () => {
    const originalFetch = globalThis.fetch;
    const captured: { signal?: AbortSignal } = {};
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      captured.signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as typeof fetch;
    try {
      const controller = new AbortController();
      const resultPromise = visionProvider.analyzeWithAI(
        'data:image/png;base64,abc',
        'geometry summary',
        { provider: 'openai', apiKey: 'sk-test' },
        'en',
        controller.signal,
      );

      expect(captured.signal).toBe(controller.signal);

      controller.abort();
      const result = await resultPromise;
      expect(result.confidence).toBe(0);
      expect(result.observedIssues).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('routes gemini vision through the relay and parses its response shape', async () => {
    const originalFetch = globalThis.fetch;
    let captured: { url: string; body: { provider?: string; body?: { model?: string; contents?: Array<{ parts?: Array<{ inline_data?: { data?: string } }> }> } } } = { url: '', body: {} };
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      captured = { url: String(_input), body: init?.body ? JSON.parse(String(init.body)) : {} };
      return {
        ok: true,
        text: async () => JSON.stringify({
          candidates: [{
            content: { parts: [{ text: '{"qualitativeAssessment":"solid model","observedIssues":[{"category":"deformation","description":"edge"}],"confidence":0.9}' }] },
          }],
        }),
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const result = await visionProvider.analyzeWithAI(
        'data:image/png;base64,xyz',
        'geometry summary',
        { provider: 'gemini', apiKey: 'AIza-test' },
        'en',
      );
      expect(captured.url).toBe('/api/llm');
      expect(captured.body.provider).toBe('gemini');
      expect(captured.body.body?.model).toBe('gemini-2.0-flash');
      expect(captured.body.body?.contents?.[0]?.parts?.[1]?.inline_data?.data).toBe('xyz');
      expect(result.qualitativeAssessment).toBe('solid model');
      expect(result.observedIssues[0].category).toBe('deformation');
      expect(result.confidence).toBe(0.9);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
