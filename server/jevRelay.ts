/**
 * jevRelay — Server-side relay for Jev (TypeSafe System One) API.
 *
 * Handles the System One API format which is different from Chat Completion:
 * - Input: { model, state, questions }
 * - Output: { model, answers, usage }
 *
 * The user's key travels through here per-request and is NEVER stored.
 * For signed-in users, the server uses OPENROUTER_API_KEY from env.
 * For anonymous users, they provide their own key (BYOK).
 */

export interface JevRelayResult {
  status: number;
  text: string;
}

const JEV_UPSTREAM = 'https://openrouter.ai/api/v1/systemone';

const JEV_ALLOWED_MODELS = new Set([
  '~typesafe/jev-latest',
  'typesafe/jev-1.13',
  'typesafe/jev-latest',
]);

export async function relayJev(params: {
  apiKey: string;
  body: unknown;
}): Promise<JevRelayResult> {
  const { apiKey, body } = params;
  const json = (o: unknown) => JSON.stringify(o);

  try {
    // Validate input
    if (!apiKey || apiKey.length === 0) {
      return { status: 400, text: json({ error: 'apiKey is required' }) };
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return { status: 400, text: json({ error: 'body must be an object' }) };
    }

    const { model, state, questions } = body as Record<string, unknown>;

    // Validate model
    if (typeof model !== 'string' || !JEV_ALLOWED_MODELS.has(model)) {
      return {
        status: 400,
        text: json({
          error: 'model not allowed',
          allowed: Array.from(JEV_ALLOWED_MODELS),
        }),
      };
    }

    // Validate state
    if (typeof state !== 'string' && typeof state !== 'object') {
      return { status: 400, text: json({ error: 'state must be a string or object' }) };
    }

    // Validate questions
    if (typeof questions !== 'object' || questions === null) {
      return { status: 400, text: json({ error: 'questions must be an object' }) };
    }

    // Forward to OpenRouter System One API
    const upstream = await fetch(JEV_UPSTREAM, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(30_000), // Jev is usually <100ms
    });

    const text = await upstream.text();
    return { status: upstream.status, text: text || '{}' };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return {
      status: timedOut ? 504 : 500,
      text: json({ error: 'Jev relay failed', detail: String(err) }),
    };
  }
}
