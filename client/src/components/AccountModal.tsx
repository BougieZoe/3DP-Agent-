import { useState } from "react";
import { X } from "lucide-react";
import { GoogleIcon } from "./GoogleIcon";
import { getTranslation } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { PLAN_LIMITS, getRemainingCalls } from "@/lib/authStore";

// Account / sign-in modal. Signed-in users see their plan + monthly usage.
// Hosted LLM means no API key to configure — just an account.
export function AccountModal({ language, onClose }: { language: Language; onClose: () => void }) {
  const { user, profile, loading, signIn, signUp, signInWithGoogle, signOut, token } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  const t = (k: "signIn" | "signUp" | "signOut" | "signInWithGoogle" | "email" | "password" | "planFree" | "aiCallsLeft" | "close") =>
    getTranslation(language, k);

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      setError("Email + password (min 6 chars)");
      return;
    }
    setBusy(true);
    setError(null);
    const res = mode === "signin" ? await signIn(email.trim(), password) : await signUp(email.trim(), password);
    setBusy(false);
    if (res.error) setError(res.error);
    else if (mode === "signup") setMode("signin"); // switch to sign-in after registering
  };

  const plan = profile?.plan ?? "free";
  const planLimit = PLAN_LIMITS[plan]?.monthlyCalls ?? PLAN_LIMITS.free.monthlyCalls;
  const remaining = getRemainingCalls(profile);
  const usagePct = planLimit > 0 ? Math.round(((profile?.usage_count ?? 0) / planLimit) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex overflow-y-auto" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg w-full max-w-sm p-6 m-auto my-6"
        onClick={(e) => e.stopPropagation()}
      >
        {user ? (
          // ── Signed in: plan + usage + sign out ──
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-mono text-muted-foreground/60">{user.email}</h2>
              <button onClick={onClose} className="p-1 rounded-sm text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3 mb-5">
              {/* Plan */}
              <div className="flex items-center justify-between text-sm font-mono">
                <span className="text-muted-foreground/50">{t("planFree")}</span>
                <span className={`uppercase font-semibold ${plan === 'pro' ? 'text-amber-400' : 'text-primary'}`}>
                  {PLAN_LIMITS[plan]?.label ?? plan.toUpperCase()}
                </span>
              </div>

              {/* Usage bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm font-mono">
                  <span className="text-muted-foreground/50">{t("aiCallsLeft")}</span>
                  <span className="text-foreground tabular-nums">
                    {remaining} / {planLimit}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-border/30 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      usagePct > 90 ? 'bg-red-500' : usagePct > 70 ? 'bg-amber-500' : 'bg-primary/70'
                    }`}
                    style={{ width: `${Math.min(usagePct, 100)}%` }}
                  />
                </div>
                <div className="text-[10px] font-mono text-muted-foreground/40 text-right">
                  {usagePct}% used this month
                </div>
              </div>

              {/* Upgrade prompt for free users */}
              {plan === 'free' && (
                <div className="border border-amber-500/30 rounded-sm p-3 bg-amber-500/5">
                  <div className="text-xs font-mono text-amber-400 mb-1">Upgrade to Pro</div>
                  <div className="text-[10px] font-mono text-muted-foreground/50">
                    10x more LLM calls, priority support, all providers
                  </div>
                  <button
                    onClick={async () => {
                      if (!token) return;
                      setUpgrading(true);
                      try {
                        const res = await fetch('/api/stripe/checkout', {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        const data = await res.json();
                        if (data.url) {
                          window.location.href = data.url;
                        } else {
                          setError(data.error || 'Checkout failed');
                        }
                      } catch {
                        setError('Checkout unavailable');
                      } finally {
                        setUpgrading(false);
                      }
                    }}
                    disabled={upgrading}
                    className="mt-2 w-full py-1.5 text-[11px] font-mono border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 rounded-sm transition-all disabled:opacity-50"
                  >
                    {upgrading ? '...' : 'Upgrade — $19/mo'}
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={async () => { await signOut(); onClose(); }}
              className="w-full h-10 border border-border/40 text-muted-foreground hover:text-foreground rounded-sm text-sm font-mono transition-all"
            >
              {t("signOut")}
            </button>
          </>
        ) : (
          // ── Anonymous: sign in / sign up form ──
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold font-mono">{mode === "signin" ? t("signIn") : t("signUp")}</h2>
              <button onClick={onClose} className="p-1 rounded-sm text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("email")}
                className="w-full bg-background border border-border/40 rounded-sm px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("password")}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                className="w-full bg-background border border-border/40 rounded-sm px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50"
              />
              {error && <div className="text-xs font-mono text-red-400/80">{error}</div>}

              <button
                onClick={submit}
                disabled={busy}
                className="w-full h-10 bg-foreground text-background rounded-sm text-sm font-mono font-bold hover:bg-foreground/90 disabled:opacity-40 transition-all"
              >
                {busy ? "…" : mode === "signin" ? t("signIn") : t("signUp")}
              </button>

              <button
                onClick={() => signInWithGoogle()}
                className="w-full h-10 inline-flex items-center justify-center gap-2.5 bg-white text-[#3c4043] border border-black/10 rounded-[4px] text-sm font-medium shadow-sm hover:bg-gray-50 transition-all"
              >
                <GoogleIcon className="w-4 h-4 shrink-0" />
                {t("signInWithGoogle")}
              </button>

              <div className="text-center">
                <button
                  onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
                  className="text-xs font-mono text-muted-foreground/60 hover:text-primary"
                >
                  {mode === "signin" ? t("signUp") : t("signIn")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
