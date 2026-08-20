import type { UnifiedAnalysis } from '@/analysis/types';
import { productionFromUnified } from '@/analysis/production';
import type { Material } from '@shared/domain/material';
import { getTranslation, type Language } from '@/lib/i18n';

/** Production-suitability card — is this part mass-producible? Directional estimate. */
export function ProductionCard({ analysis, material, language }: {
  analysis: UnifiedAnalysis;
  material: Material;
  language: Language;
}) {
  const t = (key: keyof typeof import('@/lib/i18n').translations.en) => getTranslation(language, key);
  const prod = productionFromUnified(analysis, material);
  if (!prod) return null;

  const verdictLabel =
    prod.verdict === 'production' ? t('prodProduction')
      : prod.verdict === 'small-batch' ? t('prodSmallBatch')
      : t('prodPrototype');
  const scoreColor =
    prod.score >= 70 ? 'text-emerald-400' : prod.score >= 40 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="border border-border rounded-sm bg-card p-4 mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-muted-foreground tracking-widest">{t('prodTitle')}</span>
        <span className={`text-lg font-mono font-bold ${scoreColor}`}>{prod.score}<span className="text-xs text-muted-foreground/40">/100</span></span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground/60">{t('prodPerBatch')}</span>
          <span className="font-mono text-foreground/90">{prod.partsPerBatch}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground/60">{t('prodPerPartCost')}</span>
          <span className="font-mono text-foreground/90">${prod.perPartCostUsd.toFixed(2)}</span>
        </div>
      </div>
      <div className="text-[11px] font-mono text-foreground/80 mt-2">{verdictLabel}</div>
      <div className="text-[11px] font-mono text-muted-foreground/50 mt-1 leading-relaxed">{prod.note}</div>
      <div className="text-[10px] font-mono text-muted-foreground/30 mt-1">{t('prodAdvisory')}</div>
    </div>
  );
}
