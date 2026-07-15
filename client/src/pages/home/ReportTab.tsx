import { ReportGenerator } from "@/components/ReportGenerator";
import type { UnifiedAnalysis } from '@/analysis';
import type { translations } from '@/lib/i18n';

type TKey = keyof (typeof translations)['en'];

export function ReportTab({ quickReport, handleGenerateReport, reportLoading, t, unifiedAnalysis, fileName, materialLoading, hasApiKey, onOpenApiConfig, onRegenerate }: {
  quickReport: string;
  handleGenerateReport: () => void;
  reportLoading: boolean;
  t: (key: TKey) => string;
  unifiedAnalysis?: UnifiedAnalysis;
  fileName: string;
  materialLoading: boolean;
  hasApiKey: boolean;
  onOpenApiConfig: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="pt-4 space-y-4 relative">
      {materialLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 rounded-sm">
          <div className="text-xs font-mono text-primary animate-pulse">&#x258b; RECALCULATING...</div>
        </div>
      )}
      {!quickReport && (
        <button onClick={handleGenerateReport} disabled={reportLoading}
          className="w-full py-3 text-xs font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all disabled:opacity-50">
          {reportLoading ? '\u258b ' + t('analyze') : t('generateQuickReport')}
        </button>
      )}
      {quickReport && (
        <div className="border border-border rounded-sm bg-card p-4 fade-up">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-primary tracking-widest">{t('analysisReport')}</span>
            <span className="text-xs font-mono text-muted-foreground/40">{t('localEngine')}</span>
          </div>
          <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
            {quickReport}
          </pre>
          <button onClick={onRegenerate}
            className="mt-4 text-xs font-mono text-muted-foreground hover:text-primary transition-colors">
            {t('regenerate')}
          </button>
{unifiedAnalysis && (
  <ReportGenerator
    analysis={unifiedAnalysis}
    fileName={fileName}
  />
)}
        </div>
      )}
      <div className="border border-dashed border-border/40 rounded-sm p-4 text-center space-y-2">
        <div className="text-xs font-mono text-muted-foreground">{t('deepAnalysis')}</div>
        <div className="text-xs text-muted-foreground/50">{t('deepAnalysisDesc')}</div>
        <button onClick={onOpenApiConfig}
          className="text-xs font-mono px-4 py-2 border border-primary/30 text-primary hover:bg-primary/10 rounded-sm transition-all">
          {hasApiKey ? t('switchToChat') : t('configureApiKey')}
        </button>
      </div>
    </div>
  );
}
