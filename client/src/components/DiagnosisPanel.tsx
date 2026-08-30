import { useRef, useState } from 'react';
import { diagnosePrintFailure, failureModeLabel, type FailureDiagnosis } from '@/lib/failureDiagnosis';
import { getTranslation, type Language } from '@/lib/i18n';

/** Downscale an image to ≤640px and export as a ~80% JPEG data URL —
 *  small enough to keep the vision inference fast, clear enough to read a
 *  failure pattern. */
async function compressImage(file: File, maxDim = 640): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image load failed'));
    img.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** Failed-print photo diagnosis — the "after the fact" half of the agent loop. */
export function DiagnosisPanel({ language, canRun, onNeedAuth, materialContext, geometryContext }: {
  language: Language;
  canRun: boolean;
  onNeedAuth: () => void;
  materialContext?: string;
  /** Known geometry facts from the uploaded 3D file (if any) — lets the model
   *  weigh "multiple bodies by design" against a "broke apart" narrative. */
  geometryContext?: string;
}) {
  const t = (key: keyof typeof import('@/lib/i18n').translations.en) => getTranslation(language, key);
  const inputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<FailureDiagnosis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) return;
    // Downscale to a small JPEG so the vision call is fast and stays well under
    // the server's 2MB body cap — a raw phone photo base64 can be several MB.
    try {
      const compressed = await compressImage(file);
      setImage(compressed);
      setDiagnosis(null);
      setError(null);
    } catch {
      setError(t('diagError'));
    }
  };

  const run = async () => {
    if (!canRun) { onNeedAuth(); return; }
    if (!image) return;
    setLoading(true);
    setError(null);
    setDiagnosis(null);
    const result = await diagnosePrintFailure(image, { materialContext, geometryContext, language });
    if (result.diagnosis) {
      setDiagnosis(result.diagnosis);
    } else if (result.error === 'not_configured') {
      setError(t('diagErrorConfig'));
    } else if (result.error === 'auth') {
      setError(t('diagErrorAuth'));
    } else if (result.error === 'quota') {
      setError(t('diagErrorQuota'));
    } else if (result.error === 'timeout') {
      setError(t('diagErrorTimeout'));
    } else if (result.error === 'parse') {
      setError(t('diagErrorParse'));
    } else {
      setError(t('diagError'));
    }
    setLoading(false);
  };

  if (!image && !diagnosis && !loading && !error) {
    // 没图时不占地方 — 主入口在 chat 右下角线稿相机
    return null
  }

  return (
    <div className="border border-border/10 rounded-sm p-2 space-y-2 bg-background/20">
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => pick(e.target.files?.[0])} />

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

              {diagnosis.ruledOutAlternatives.length > 0 && (
                <div className="border border-border/40 rounded-sm p-3 space-y-1">
                  <div className="text-[10px] font-mono text-muted-foreground/40 tracking-widest">{t('diagAlternatives')}</div>
                  {diagnosis.ruledOutAlternatives.map((a, i) => (
                    <div key={i} className="text-[11px] text-muted-foreground/70 leading-relaxed">· {a}</div>
                  ))}
                </div>
              )}

              <div className="text-[11px] font-mono text-muted-foreground/60">
                {t('diagIsFailure')}: {Math.round(diagnosis.isFailure * 100)}% · {t('diagModeConfidence')}: {Math.round(diagnosis.confidence * 100)}%
              </div>

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
