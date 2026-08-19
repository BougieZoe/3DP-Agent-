// External auth snapshot so non-component modules (agentPipeline, deepAnalysis,
// ChatPanel) can read the current auth state synchronously, without hooks.

export interface Profile {
  id: string;
  plan: "free" | "pro";
  usage_count: number;
  quota_month: string | null;
}

export interface AuthSnapshot {
  user: { id: string; email?: string } | null;
  profile: Profile | null;
  loading: boolean;
  /** Supabase access token, kept fresh by AuthContext — read synchronously. */
  token: string | null;
}

let current: AuthSnapshot = { user: null, profile: null, loading: true, token: null };

export function getAuthSnapshot(): AuthSnapshot {
  return current;
}

export function setAuthSnapshot(s: AuthSnapshot): void {
  current = s;
}
