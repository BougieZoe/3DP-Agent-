// api/amd-proxy.ts
//
// Vercel serverless function. Files under /api are auto-detected by Vercel
// and deployed as individual functions — this replaces the old Express
// route in server/index.ts, which never actually ran in production because
// Vercel serves this project as a static site (no persistent Node server).
//
// The browser calls this endpoint (same-origin, no CORS issue). This
// function then calls the AMD machine server-to-server, which has no
// CORS restriction at all.

const AMD_MACHINE_URL =
  process.env.AMD_MACHINE_URL || 'http://localhost:8000/v1/chat/completions';

// Default Vercel function timeout is 10s — LLM generation routinely takes
// longer than that, especially through a multi-agent pipeline. 60s is the
// max allowed on the Hobby plan.
export const config = {
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const amdRes = await fetch(AMD_MACHINE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await amdRes.json();
    res.status(amdRes.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'AMD proxy failed', detail: String(err) });
  }
}