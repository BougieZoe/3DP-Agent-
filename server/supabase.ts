import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { currentDir } from './currentDir';

// Minimal .env loader so bare `tsx server/index.ts` / `node dist/index.cjs`
// reads the repo-root .env. Vercel injects real env and the Electron main
// already merges .env into the child — this covers local dev + standalone runs.
// Runs here (the first server module to read process.env) so the values are
// available to every later module including server/index.ts.
const ENV_FILE = path.resolve(currentDir, '..', '.env');
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

// Service-role client used to verify user sessions and run the quota RPC.
// Env-missing → null so the app degrades gracefully to the BYOK path (and
// tests / local dev without credentials keep working).
const url = process.env.SUPABASE_URL;
const roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const sb = url && roleKey
  ? createClient(url, roleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

/** Resolve a Supabase access token to a user id (null = invalid/expired/disabled). */
export async function verifyUser(token: string): Promise<{ id: string } | null> {
  if (!sb) return null;
  // `getUser` exists at runtime (supabase-js v2), but @vercel/node's api/ tsconfig
  // misresolves the SupabaseAuthClient type, so cast through a typed shape.
  const auth = sb.auth as unknown as {
    getUser: (t: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  const { data, error } = await auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

/**
 * Atomically consume one unit of the user's monthly quota. Returns the number
 * of calls remaining after this one (0 = over quota). null = unavailable.
 * The `consume_usage` RPC in Postgres does the reset + increment in one
 * statement (FOR UPDATE), so concurrent requests can't over-spend.
 */
export async function consumeUsage(userId: string, limit: number): Promise<number | null> {
  // Call the RPC directly via PostgREST HTTP — version-independent and immune to
  // bundler quirks that leave `client.rest` undefined (see api/llm.ts).
  const url = process.env.SUPABASE_URL;
  const role = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !role) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/consume_usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: role, Authorization: `Bearer ${role}` },
      body: JSON.stringify({ p_user: userId, p_limit: limit }),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return typeof data === 'number' ? data : null;
  } catch {
    return null;
  }
}
