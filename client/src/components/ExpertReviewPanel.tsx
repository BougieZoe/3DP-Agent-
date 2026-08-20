import { useState } from 'react';
import { runExpertReview, type ExpertReview } from '@/agents';
import type { ModelData } from '@/lib/ruleEngine';
import type { Material } from '@shared/domain/material';
import type { ObjectContext } from '@/analysis/context';
import { getTranslation, type Language } from '@/lib/i18n';

/**
 * Expert LLM review — a material-domain AI expert translates the deterministic
 * metrics into plain-language advice. Runs one on-demand LLM call; shows the
 * verdict in plain language plus structured findings and next actions.
 */
export function ExpertReviewPanel({ model, material, objectContext, materialMetrics, language, canRun, onNeedAuth, onReviewChange }: {
  model: ModelData;
  material: Material;
  objectContext: ObjectContext;
  materialMetrics?: string;
  language: Language;
  /** Whether the current user is signed in (hosted LLM) or has a BYOK key. */
  canRun: boolean;
  onNeedAuth: () => void;
  /** Called with the review whenever it's (re)run — lets the parent include it in the PDF report. */
  onReviewChange?: (review: ExpertReview | null) => void;
}) {
  const [review, setReview] = useState<ExpertReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = (key: keyof typeof import('@/lib/i18n').translations.en) => getTranslation(language, key);

  const run = async () => {
    if (!canRun) {
      onNeedAuth();
      return;
    }
    setLoading(true);
    setError(null);
    setReview(null);
    onReviewChange?.(null);
    const result = await runExpertReview({ model, material, objectContext, materialMetrics, language });
    if (result) {
      setReview(result);
      onReviewChange?.(result);
    } else {
      setError(t('expertReviewError'));
    }
    setLoading(false);
  };

  const severityColor = (s: string) =>
    s === 'high' ? '#ef4444' : s === 'medium' ? '#eab308' : '#34d399';

  // Feedback → self-improvement loop. The rating plus a snapshot of the review
  // is appended to the same agent-trace JSONL that feeds the fine-tuning
  // dataset (deploy/amd/build-dataset.py). Fire-and-forget: on Vercel the
  // endpoint is unmounted, so failures are silently ignored.
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const sendFeedback = (rating: 'up' | 'down') => {
    setFeedback(rating);
    fetch('/api/agent-trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'expert_feedback',
        rating,
        raw: review?.plain ?? '',
        verdict: review?.verdict ?? 'warning',
        materialName: material.name,
        materialFamily: material.technology,
        objectContext,
        findings: review?.findings.length ?? 0,
        actions: review?.actions.length ?? 0,
        language,
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {});
  };

  return (
    <div className="border border-dashed border-border/50 rounded-sm p-4 space-y-3">
      <div>
        <div className="text-xs font-mono text-muted-foreground">{t('expertReview')}</div>
        <div className="mt-1 text-xs text-muted-foreground/60">{t('expertReviewDesc')}</div>
      </div>

      {!review && (
        loading ? (
          <div className="text-xs font-mono text-cyan-400/80 animate-pulse">{t('expertReviewLoading')}</div>
        ) : (
          <div className="space-y-2">
            {error && <div className="text-xs font-mono text-red-400">{error}</div>}
            <button
              onClick={run}
              disabled={loading}
              className="text-xs font-mono px-4 py-2 border border-primary/30 text-primary hover:bg-primary/10 rounded-sm transition-all disabled:opacity-40"
            >
              {canRun ? t('expertReviewRun') : t('signInToExpertReview')}
            </button>
          </div>
        )
      )}

      {review && (
        <div className="space-y-3 fade-up">
          <div className="text-xs font-mono text-muted-foreground">{t('expertReviewPlain')}</div>
          <div className="text-[13px] text-foreground/90 leading-relaxed">{review.plain}</div>

          {review.findings.length > 0 && (
            <>
              <div className="text-xs font-mono text-muted-foreground pt-1">{t('expertReviewFindings')}</div>
              <ul className="space-y-2">
                {review.findings.map((f, i) => (
                  <li key={i} className="text-xs text-muted-foreground/80 leading-relaxed border-l-2 pl-2" style={{ borderColor: severityColor(f.severity) }}>
                    <span className="font-mono uppercase text-[10px]">{f.severity}</span>{' '}
                    <span className="text-foreground/90">{f.what}</span>{f.why ? ` — ${f.why}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}

          {review.actions.length > 0 && (
            <>
              <div className="text-xs font-mono text-muted-foreground pt-1">{t('expertReviewActions')}</div>
              <ul className="space-y-1.5">
                {review.actions.map((a, i) => (
                  <li key={i} className="text-xs text-muted-foreground/80 leading-relaxed">
                    → {a.do}{' '}
                    <span className="text-muted-foreground/40">(impact {a.impact} · effort {a.effort})</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="text-[11px] text-muted-foreground/40 font-mono pt-1">{t('expertReviewAdvisory')}</div>

          {/* Feedback → self-improvement */}
          {feedback ? (
            <div className="text-[11px] font-mono text-emerald-400/80 pt-1">{t('expertFeedbackThanks')}</div>
          ) : (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11px] font-mono text-muted-foreground/50">{t('expertFeedback')}</span>
              <button onClick={() => sendFeedback('up')} title="Helpful"
                className="text-sm px-2 py-0.5 border border-border/40 rounded-sm hover:border-emerald-400/50 hover:bg-emerald-400/10 transition-all">
                👍
              </button>
              <button onClick={() => sendFeedback('down')} title="Not helpful"
                className="text-sm px-2 py-0.5 border border-border/40 rounded-sm hover:border-red-400/50 hover:bg-red-400/10 transition-all">
                👎
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
