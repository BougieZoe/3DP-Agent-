/**
 * Vercel serverless function for /api/jev
 *
 * Relay for Jev (TypeSafe System One) API.
 * Self-contained for Vercel bundling — mirrors server/jevRelay.ts behavior.
 *
 * Handles the System One API format:
 * - Input: { apiKey, body: { model, state, questions } }
 * - Output: { model, answers, usage, ... }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const JEV_UPSTREAM = 'https://openrouter.ai/api/v1/systemone';

const JEV_ALLOWED_MODELS = new Set([
  '~typesafe/jev-latest',
  'typesafe/jev-1.13',
  'typesafe/jev-latest',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const { apiKey, body } = (req.body ?? {}) as Record<string, unknown>;
  const json = (o: unknown) => JSON.stringify(o);

  try {
    // Validate input
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length === 0) {
      return res.status(400).json({ error: 'apiKey is required' });
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return res.status(400).json({ error: 'body must be an object' });
    }

    const { model, state, questions } = body as Record<string, unknown>;

    // Validate model
    if (typeof model !== 'string' || !JEV_ALLOWED_MODELS.has(model)) {
      return res.status(400).json({
        error: 'model not allowed',
        allowed: Array.from(JEV_ALLOWED_MODELS),
      });
    }

    // Validate state
    if (typeof state !== 'string' && typeof state !== 'object') {
      return res.status(400).json({ error: 'state must be a string or object' });
    }

    // Validate questions
    if (typeof questions !== 'object' || questions === null) {
      return res.status(400).json({ error: 'questions must be an object' });
    }

    // Forward to OpenRouter System One API
    const upstream = await fetch(JEV_UPSTREAM, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(text || '{}');
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    res.status(timedOut ? 504 : 500).json({
      error: 'Jev relay failed',
      detail: String(err),
    });
  }
}
