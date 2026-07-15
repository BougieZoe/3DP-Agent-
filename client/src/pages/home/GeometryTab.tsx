import type { UnifiedAnalysis } from '@/analysis';
import type { ModelData } from '@/lib/ruleEngine';
import type { translations } from '@/lib/i18n';
import { MetricRow } from './MetricRow';
import { StatusChip } from './StatusChip';

type TKey = keyof (typeof translations)['en'];

export interface AnalysisSummary {
  wallThickness: {
    minThickness: number;
    p1Thickness: number | null;
    p5Thickness: number | null;
    p10Thickness: number | null;
    medianThickness: number | null;
    avgThickness: number | null;
    thinWallCount: number;
    thinWallPercentage: number;
    thinWallRatio: number;
    averageConfidence: number;
    lowConfidenceSampleCount: number;
    status: 'good' | 'warning' | 'critical';
  };
  overhang: {
    areas: number;
    status: 'good' | 'warning' | 'critical';
  };
  volume: number;
  surfaceArea: number;
}

export function GeometryTab({ analysis, t, materialLoading, unifiedAnalysis, modelData, onSwitchToReport }: {
  analysis: AnalysisSummary;
  t: (key: TKey) => string;
  materialLoading: boolean;
  unifiedAnalysis?: UnifiedAnalysis;
  modelData: ModelData;
  onSwitchToReport: () => void;
}) {
  return (
    <div className="space-y-4 pt-4 relative">
      {materialLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 rounded-sm">
          <div className="text-xs font-mono text-primary animate-pulse">&#x258b; RECALCULATING...</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 border border-border rounded-sm bg-card">
          <div className="text-xs text-muted-foreground mb-2 font-mono">{t('wallThicknessLabel')}</div>
          <StatusChip status={analysis.wallThickness.status} label={t(analysis.wallThickness.status)} />
        </div>
        <div className="p-3 border border-border rounded-sm bg-card">
          <div className="text-xs text-muted-foreground mb-2 font-mono">{t('overhangLabel')}</div>
          <StatusChip status={analysis.overhang.status} label={t(analysis.overhang.status)} />
        </div>
      </div>
      <div className="border border-border rounded-sm bg-card p-4">
        <div className="text-xs text-muted-foreground mb-3 font-mono tracking-widest">GEOMETRY DATA</div>
        <MetricRow label={t('minThickness')} value={analysis.wallThickness.minThickness.toFixed(3)} unit="mm" highlight />
        {unifiedAnalysis?.metrics.result?.minWallThicknessMm != null && (
          <MetricRow label="Min (abs)" value={unifiedAnalysis.metrics.result.minWallThicknessMm.toFixed(3)} unit="mm" />
        )}
        <MetricRow label={t('volume')} value={analysis.volume.toFixed(1)} unit="mm³" />
        <MetricRow label={t('surfaceArea')} value={analysis.surfaceArea.toFixed(1)} unit="mm²" />
        <MetricRow label={t('dimX')} value={modelData.dims.x.toFixed(2)} unit="mm" />
        <MetricRow label={t('dimY')} value={modelData.dims.y.toFixed(2)} unit="mm" />
        <MetricRow label={t('dimZ')} value={modelData.dims.z.toFixed(2)} unit="mm" />
        <MetricRow label={t('overhangFaces')} value={analysis.overhang.areas} />
      </div>
      <button onClick={onSwitchToReport}
        className="w-full py-2.5 text-xs font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all">
        {t('generateReport')}
      </button>
    </div>
  );
}
