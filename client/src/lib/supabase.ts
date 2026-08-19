import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Valid HTTP(S) URL required — a malformed/empty env would otherwise make
// createClient throw at startup and blank the whole app.
const validUrl =
  typeof url === "string" && /^https?:\/\/.+/i.test(url.trim()) ? url.trim() : undefined;

// null when unconfigured → the whole app degrades to the anonymous/BYOK path
// (also what vitest sees, so the existing 479 tests stay green).
export const supabase =
  validUrl && anonKey
    ? createClient(validUrl, anonKey, {
        auth: {
          flowType: "pkce",
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      })
    : null;
