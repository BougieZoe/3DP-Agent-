import { useRef, useState } from 'react';
import { diagnosePrintFailure, failureModeLabel, type FailureDiagnosis } from '@/lib/failureDiagnosis';
import { getTranslation, type Language } from '@/lib/i18n';

/** Failed-print photo diagnosis — the "after the fact" half of the agent loop. */
export function DiagnosisPanel({ language, canRun, onNeedAuth, materialContext }: {
  language: Language;
  canRun: boolean;
  onNeedAuth: () => void;
  materialContext?: string;
}) {
  const t = (key: keyof typeof import('@/lib/i18n').translations.en) => getTranslation(language, key);
  const inputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<FailureDiagnosis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImage(reader.result as string);
      setDiagnosis(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const run = async () => {
    if (!canRun) { onNeedAuth(); return; }
    if (!image) return;
    setLoading(true);
    setError(null);
    setDiagnosis(null);
    const result = await diagnosePrintFailure(image, { materialContext, language });
    if (result.diagnosis) {
      setDiagnosis(result.diagnosis);
    } else if (result.error === 'not_configured') {
      setError(t('diagErrorConfig'));
    } else if (result.error === 'auth') {
      setError(t('diagErrorAuth'));
    } else if (result.error === 'quota') {
      setError(t('diagErrorQuota'));
    } else {
      setError(t('diagError'));
    }
    setLoading(false);
  };

  return (
    <div className="border border-dashed border-border/50 rounded-sm p-4 space-y-3">
      <div>
        <div className="text-xs font-mono text-muted-foreground">{t('diagTitle')}</div>
        <div className="mt-1 text-xs text-muted-foreground/60">{t('diagDesc')}</div>
      </div>

      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => pick(e.target.files?.[0])} />

      {!image && (
        <button onClick={() => inputRef.current?.click()}
          className="w-full py-2.5 text-xs font-mono border border-primary/30 text-primary hover:bg-primary/10 rounded-sm transition-all">
          {t('diagUpload')}
        </button>
      )}

      {image && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <img src={image} alt="failed print" className="w-24 h-24 object-cover rounded-sm border border-border" />
            <div className="flex flex-col gap-2 flex-1">
              <button onClick={() => inputRef.current?.click()}
                className="text-[11px] font-mono text-muted-foreground hover:text-primary transition-colors text-left">
                ↺ {t('diagUpload')}
              </button>
              <button onClick={run} disabled={loading}
                className="py-2 text-xs font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all disabled:opacity-40">
                {loading ? t('diagAnalyzing') : (canRun ? t('diagTitle') : t('diagSignIn'))}
              </button>
            </div>
          </div>

          {error && <div className="text-xs font-mono text-red-400">{error}</div>}

          {diagnosis && (
            <div className="space-y-3 fade-up">
              <div className="text-[13px] text-foreground/90 leading-relaxed">{diagnosis.overallAssessment}</div>

              {diagnosis.failureModes.map((m, i) => (
                <div key={i} className="border border-border/40 rounded-sm p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-foreground/90">{failureModeLabel(m.mode, language)}</span>
                    <span className="text-[11px] font-mono text-muted-foreground/60">{Math.round(m.probability * 100)}%</span>
                  </div>
                  {m.causes.length > 0 && (
                    <div className="text-[11px] text-muted-foreground/70">
                      <span className="font-mono text-muted-foreground/40">{t('diagCauses')}: </span>
                      {m.causes.join(' · ')}
                    </div>
                  )}
                  {m.fixes.length > 0 && (
                    <div className="text-[11px] text-foreground/80">
                      <span className="font-mono text-muted-foreground/40">{t('diagFixes')}: </span>
                      {m.fixes.join(' · ')}
                    </div>
                  )}
                </div>
              ))}

              <div className="text-[11px] font-mono text-muted-foreground/50">
                {t('diagConfidence')}: {Math.round(diagnosis.confidence * 100)}% · {t('diagAdvisory')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
