import { getTrafficLight } from './ReportGenerator';
import type { UploadedModel } from './STLUploadHandler';
import type { UnifiedAnalysis } from '@/analysis/types';
import { deriveWtStatus, deriveOhStatus, deriveSupportStatus } from '@/analysis/metrics';
import { getTranslation, type Language } from '@/lib/i18n';

/**
 * Batch overview — a comparison table of every loaded model (part / verdict /
 * score / top concern). Clicking a row activates that model. Shown only when
 * more than one file is loaded.
 */
export function BatchReport({ models, activeFileName, onSelect, language }: {
  models: UploadedModel[];
  activeFileName: string | null;
  onSelect: (fileName: string) => void;
  language: Language;
}) {
  const t = (key: keyof typeof import('@/lib/i18n').translations.en) => getTranslation(language, key);

  function topConcern(a: UnifiedAnalysis): string {
    const v = a.validation?.result;
    const m = a.metrics?.result;
    if (v && !v.isWatertight) return t('batchNotWatertight');
    if (m) {
      if (deriveWtStatus(m.thinWallRatio ?? 0, m.p5WallThicknessMm) === 'critical') return t('batchThinWalls');
      if (deriveOhStatus(m.overhang.ratio) === 'critical') return t('batchOverhang');
      const sp = a.support?.result;
      if (sp && deriveSupportStatus(sp).status === 'critical') return t('batchSupport');
    }
    return '—';
  }

  const rows = models.map((m) => {
    const { light, score } = getTrafficLight(m.unifiedAnalysis);
    return {
      fileName: m.fileName,
      light,
      score,
      verdict: light === 'green' ? t('verdictPass') : light === 'yellow' ? t('verdictWarning') : t('verdictFail'),
      concern: topConcern(m.unifiedAnalysis),
    };
  });

  const lightCls = (light: string) =>
    light === 'green'
      ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5'
      : light === 'yellow'
        ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5'
        : 'text-red-400 border-red-400/30 bg-red-400/5';

  return (
    <div className="border border-border rounded-sm bg-card overflow-x-auto">
      <div className="text-xs text-muted-foreground/50 mb-2 pt-3 px-4 font-mono tracking-widest">{t('batchReport')}</div>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-muted-foreground/40 text-[10px] tracking-widest">
            <th className="text-left font-normal px-4 py-1.5">{t('batchPart')}</th>
            <th className="text-left font-normal px-2 py-1.5">{t('batchVerdict')}</th>
            <th className="text-right font-normal px-2 py-1.5">{t('batchScore')}</th>
            <th className="text-left font-normal px-4 py-1.5 hidden sm:table-cell">{t('batchConcern')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.fileName}
              onClick={() => onSelect(r.fileName)}
              className={`cursor-pointer border-t border-border/30 transition-all ${
                activeFileName === r.fileName ? 'bg-primary/5' : 'hover:bg-primary/5'
              }`}
            >
              <td className="px-4 py-2 text-foreground/90 max-w-[11rem] truncate">{r.fileName}</td>
              <td className="px-2 py-2">
                <span className={`px-1.5 py-0.5 border rounded-sm text-[10px] uppercase ${lightCls(r.light)}`}>{r.verdict}</span>
              </td>
              <td className="px-2 py-2 text-right text-foreground tabular-nums">{r.score}</td>
              <td className="px-4 py-2 text-muted-foreground/70 hidden sm:table-cell">{r.concern}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
