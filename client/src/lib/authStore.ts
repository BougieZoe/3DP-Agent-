// External auth snapshot so non-component modules (agentPipeline, deepAnalysis,
// ChatPanel) can read the current auth state synchronously, without hooks.

export interface Profile {
  id: string;
  plan: "free" | "pro";
  usage_count: number;
  quota_month: string | null;
  /** Prepaid credits for LLM calls (deducted per call). */
  credits: number;
}

/** Per-plan monthly quotas and pricing */
export const PLAN_LIMITS = {
  free: { monthlyCalls: 100, label: "Free" },
  pro:  { monthlyCalls: 1000, label: "Pro ($19/mo)" },
} as const;

/** Remaining calls for the current billing period */
export function getRemainingCalls(profile: Profile | null): number {
  if (!profile) return 0;
  const limit = PLAN_LIMITS[profile.plan]?.monthlyCalls ?? PLAN_LIMITS.free.monthlyCalls;
  return Math.max(0, limit - profile.usage_count);
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
