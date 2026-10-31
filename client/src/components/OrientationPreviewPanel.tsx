import { useState } from 'react';
import { suggestOrientation, type OrientationSuggestion } from '@/lib/autoOrient';
import { runAnalysisInWorker, fromThreeBufferGeometry, type UnifiedAnalysis } from '@/analysis';
import { createMeshFromGeometry } from '@/lib/stlLoader';
import type { UploadedModel } from '@/components/STLUploadHandler';
import type { Material } from '@shared/domain/material';
import { getTranslation, type Language } from '@/lib/i18n';

/**
 * Orientation preview loop: suggest a better pose, show deterministic
 * before/after metrics (overhang, support volume + difficulty, build
 * height, base contact), and only commit the rotated geometry when the
 * user accepts. The uploaded model is never mutated during preview.
 * Agent consensus re-run is intentionally out of scope for v1.
 */
export function OrientationPreviewPanel({
  model,
  material,
  language,
  onAccept,
}: {
  model: UploadedModel;
  material: Material;
  language: Language;
  onAccept: (updated: UploadedModel) => void;
}) {
  const t = (key: keyof typeof import('@/lib/i18n').translations.en) =>
    getTranslation(language, key);

  const [suggestion, setSuggestion] = useState<OrientationSuggestion | null>(null);
  const [afterAnalysis, setAfterAnalysis] = useState<UnifiedAnalysis | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    setAfterAnalysis(null);
    try {
      const s = suggestOrientation(model.geometry, material.overhangThreshold);
      setSuggestion(s);
      if (s.verdict === 'rotated' && s.rotatedGeometry) {
        const after = await runAnalysisInWorker(
          fromThreeBufferGeometry(s.rotatedGeometry),
          { fileName: model.fileName, material },
        );
        setAfterAnalysis(after);
      }
    } finally {
      setBusy(false);
    }
  };

  const accept = () => {
    if (!suggestion?.rotatedGeometry || !afterAnalysis) return;
    const rotated = suggestion.rotatedGeometry;
    onAccept({
      ...model,
      geometry: rotated,
      mesh: createMeshFromGeometry(rotated),
      unifiedAnalysis: afterAnalysis,
      // rawGeometry is the source for units-change reprocessing — keep the
      // accepted pose so a later units change does not resurrect the old one.
      rawGeometry: rotated.clone(),
    });
    setSuggestion(null);
    setAfterAnalysis(null);
  };

  const revert = () => {
    setSuggestion(null);
    setAfterAnalysis(null);
  };

  const current = suggestion?.candidates[0];
  const chosen = suggestion?.chosen;
  const before = model.unifiedAnalysis;
  const fmtPct = (r: number) => `${(r * 100).toFixed(1)}%`;

  return (
    <div className="border border-dashed border-border/50 rounded-sm p-4 space-y-3">
      <div>
        <div className="text-xs font-mono text-muted-foreground">{t('orientationTitle')}</div>
        <div className="mt-1 text-xs text-muted-foreground/60">{t('orientationScopeNote')}</div>
      </div>

      {!suggestion && (
        <button
          onClick={() => void check()}
          disabled={busy}
          className="text-xs font-mono px-4 py-2 border border-primary/30 text-primary hover:bg-primary/10 rounded-sm transition-all disabled:opacity-40"
        >
          {busy ? t('orientationAnalyzing') : t('orientationCheck')}
        </button>
      )}

      {suggestion && suggestion.verdict === 'kept' && (
        <div className="text-xs font-mono text-emerald-400/80">
          {t('orientationKept')}
        </div>
      )}

      {suggestion && suggestion.verdict === 'no_good_orientation' && (
        <div className="space-y-1">
          <div className="text-xs font-mono text-yellow-400/90">
            {t('orientationNoGood')}
          </div>
          <div className="text-xs font-mono text-muted-foreground/70">{suggestion.reason}</div>
        </div>
      )}

      {suggestion && suggestion.verdict === 'rotated' && chosen && current && (
        <div className="space-y-3">
          <div className="text-xs font-mono text-cyan-400/90">
            {t('orientationRotated').replace('{label}', chosen.label)}
          </div>

          {!afterAnalysis ? (
            <div className="flex items-center gap-2 text-xs font-mono text-cyan-400/80">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
              {t('orientationAnalyzing')}
            </div>
          ) : (
            <>
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-muted-foreground/60">
                    <th className="text-left font-normal pb-1"></th>
                    <th className="text-right font-normal pb-1">{t('orientationBefore')}</th>
                    <th className="text-right font-normal pb-1">{t('orientationAfter')}</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr>
                    <td className="py-0.5">{t('orientationOverhang')}</td>
                    <td className="text-right">{fmtPct(before.metrics.result.overhang.ratio)}</td>
                    <td className="text-right text-cyan-400">{fmtPct(afterAnalysis.metrics.result.overhang.ratio)}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5">{t('orientationSupportVol')}</td>
                    <td className="text-right">{before.support ? `${before.support.result.totalSupportVolumeMm3.toFixed(0)} mm³` : '—'}</td>
                    <td className="text-right text-cyan-400">{afterAnalysis.support ? `${afterAnalysis.support.result.totalSupportVolumeMm3.toFixed(0)} mm³` : '—'}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5">{t('orientationSupportDiff')}</td>
                    <td className="text-right">{before.support?.result.difficulty ?? '—'}</td>
                    <td className="text-right text-cyan-400">{afterAnalysis.support?.result.difficulty ?? '—'}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5">{t('orientationHeight')}</td>
                    <td className="text-right">{current.buildHeightMm.toFixed(1)} mm</td>
                    <td className="text-right">{chosen.buildHeightMm.toFixed(1)} mm</td>
                  </tr>
                  <tr>
                    <td className="py-0.5">{t('orientationBase')}</td>
                    <td className="text-right">{current.baseContactAreaMm2.toFixed(1)} mm²</td>
                    <td className="text-right">{chosen.baseContactAreaMm2.toFixed(1)} mm²</td>
                  </tr>
                </tbody>
              </table>

              <div className="flex gap-2">
                <button
                  onClick={accept}
                  className="text-xs font-mono px-4 py-2 border border-primary/30 text-primary hover:bg-primary/10 rounded-sm transition-all"
                >
                  {t('orientationAccept')}
                </button>
                <button
                  onClick={revert}
                  className="text-xs font-mono px-4 py-2 border border-border/50 text-muted-foreground hover:bg-muted/20 rounded-sm transition-all"
                >
                  {t('orientationRevert')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {suggestion && suggestion.verdict !== 'rotated' && (
        <button
          onClick={revert}
          className="text-xs font-mono px-4 py-2 border border-border/50 text-muted-foreground hover:bg-muted/20 rounded-sm transition-all"
        >
          {t('orientationRevert')}
        </button>
      )}
    </div>
  );
}
