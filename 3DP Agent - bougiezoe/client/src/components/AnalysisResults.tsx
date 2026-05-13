import { UploadedModel } from './STLUploadHandler';
import { ModelPreviewScene } from './ModelPreviewScene';
import { ResultsAnimation } from './ResultsAnimation';
import { isComplete } from '../../../shared/domain/analysis';
import type { FindingSeverity } from '../../../shared/domain/printability';

interface AnalysisResultsProps {
  model: UploadedModel;
  language: 'en' | 'ja' | 'zh';
}

const severityColors: Record<FindingSeverity, string> = {
  info: 'text-blue-600',
  warning: 'text-yellow-600',
  error: 'text-red-600',
};

const statusLabels = {
  en: {
    excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor',
    wallThickness: 'Wall Thickness', minThickness: 'Min Thickness',
    overhang: 'Overhang Detection', volume: 'Volume',
    surfaceArea: 'Surface Area', bounds: 'Dimensions',
    recommendations: 'Recommendations', findings: 'Findings',
    printable: 'This model is suitable for 3D printing with recommended settings.',
    needsOptimization: 'This model needs optimization for better print quality.',
    notPrintable: 'This model has critical issues that must be resolved before printing.',
    noIssues: 'No issues detected.',
  },
  ja: {
    excellent: '優秀', good: '良好', fair: '普通', poor: '不良',
    wallThickness: '壁厚', minThickness: '最小厚さ',
    overhang: 'オーバーハング検出', volume: '体積',
    surfaceArea: '表面積', bounds: '寸法',
    recommendations: '推奨事項', findings: '検出結果',
    printable: 'このモデルは推奨設定で3Dプリント可能です。',
    needsOptimization: 'より良い印刷品質のため、このモデルは最適化が必要です。',
    notPrintable: 'このモデルは印刷前に解決する必要がある重大な問題があります。',
    noIssues: '問題は検出されませんでした。',
  },
  zh: {
    excellent: '优秀', good: '良好', fair: '一般', poor: '较差',
    wallThickness: '壁厚', minThickness: '最小厚度',
    overhang: '悬垂检测', volume: '体积',
    surfaceArea: '表面积', bounds: '尺寸',
    recommendations: '建议', findings: '检测结果',
    printable: '该模型适合用推荐设置进行3D打印。',
    needsOptimization: '该模型需要优化以获得更好的打印质量。',
    notPrintable: '该模型存在必须在打印前解决的严重问题。',
    noIssues: '未检测到问题。',
  },
};

export function AnalysisResults({ model, language }: AnalysisResultsProps) {
  const labels = statusLabels[language];
  const analysis = model.analysis;

  const complete = isComplete(analysis);
  const geo = analysis.geometry;
  const print = analysis.printability;

  const score = print?.score ?? 'fair';
  const recommendation =
    score === 'poor' ? labels.notPrintable :
    score === 'excellent' ? labels.printable :
    labels.needsOptimization;

  const scoreColor =
    score === 'excellent' ? 'text-green-600' :
    score === 'good' ? 'text-green-500' :
    score === 'fair' ? 'text-yellow-600' :
    'text-red-600';

  return (
    <ResultsAnimation>
      <div className="space-y-8">
        <ModelPreviewScene model={model} />

        <div className="space-y-2">
          <div className="font-mono text-xs text-muted-foreground opacity-70">FILE</div>
          <div className="font-serif text-2xl font-bold text-foreground">{model.fileName}</div>
        </div>

        <div className="space-y-3 p-6 bg-secondary/50 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs text-muted-foreground opacity-70">
              {labels.recommendations}
            </div>
            <span className={`font-mono text-xs font-bold ${scoreColor}`}>
              {labels[score]}
            </span>
          </div>
          <p className="font-mono text-sm text-muted-foreground leading-relaxed">
            {recommendation}
          </p>
        </div>

        {/* Findings */}
        {print && print.findings.length > 0 && (
          <div className="space-y-3">
            <div className="font-mono text-xs text-muted-foreground opacity-70">
              {labels.findings}
            </div>
            {print.findings.map(f => (
              <div key={f.id} className="p-4 bg-secondary/30 rounded-lg space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-bold text-foreground">{f.title}</span>
                  <span className={`font-mono text-xs font-bold ${severityColors[f.severity]}`}>
                    {f.severity.toUpperCase()}
                  </span>
                </div>
                <p className="font-mono text-xs text-muted-foreground">{f.description}</p>
              </div>
            ))}
          </div>
        )}

        {print && print.findings.length === 0 && (
          <div className="p-4 bg-secondary/30 rounded-lg">
            <p className="font-mono text-sm text-muted-foreground">{labels.noIssues}</p>
          </div>
        )}

        {/* Geometry metrics */}
        {complete && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <div className="font-mono text-xs text-muted-foreground opacity-70">
                {labels.volume}
              </div>
              <div className="font-serif text-2xl font-bold text-foreground">
                {geo!.volume.toFixed(2)} cm³
              </div>
            </div>

            <div className="space-y-2">
              <div className="font-mono text-xs text-muted-foreground opacity-70">
                {labels.surfaceArea}
              </div>
              <div className="font-serif text-2xl font-bold text-foreground">
                {geo!.surfaceArea.toFixed(2)} cm²
              </div>
            </div>
          </div>
        )}

        {/* Dimensions */}
        {complete && (
          <div className="space-y-3 p-6 bg-secondary/30 rounded-lg">
            <div className="font-mono text-xs text-muted-foreground opacity-70">
              {labels.bounds}
            </div>
            <div className="grid grid-cols-3 gap-4 font-mono text-sm">
              <div>
                <div className="text-muted-foreground opacity-70">X</div>
                <div className="font-bold text-foreground">
                  {geo!.dimensions.width.toFixed(2)} mm
                </div>
              </div>
              <div>
                <div className="text-muted-foreground opacity-70">Y</div>
                <div className="font-bold text-foreground">
                  {geo!.dimensions.depth.toFixed(2)} mm
                </div>
              </div>
              <div>
                <div className="text-muted-foreground opacity-70">Z</div>
                <div className="font-bold text-foreground">
                  {geo!.dimensions.height.toFixed(2)} mm
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ResultsAnimation>
  );
}