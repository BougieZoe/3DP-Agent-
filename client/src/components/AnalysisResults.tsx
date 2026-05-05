import { UploadedModel } from './STLUploadHandler';
import { ModelPreviewScene } from './ModelPreviewScene';
import { ResultsAnimation } from './ResultsAnimation';

interface AnalysisResultsProps {
  model: UploadedModel;
  language: 'en' | 'ja' | 'zh';
}

const statusColors = {
  good: 'text-green-600',
  warning: 'text-yellow-600',
  critical: 'text-red-600',
};

const statusLabels = {
  en: {
    good: 'Good',
    warning: 'Warning',
    critical: 'Critical',
    wallThickness: 'Wall Thickness',
    minThickness: 'Min Thickness',
    overhang: 'Overhang Detection',
    volume: 'Volume',
    surfaceArea: 'Surface Area',
    bounds: 'Dimensions',
    recommendations: 'Recommendations',
    printable: 'This model is suitable for 3D printing with recommended settings.',
    needsOptimization: 'This model needs optimization for better print quality.',
    notPrintable: 'This model has critical issues that must be resolved before printing.',
  },
  ja: {
    good: '良好',
    warning: '警告',
    critical: '重大',
    wallThickness: '壁厚',
    minThickness: '最小厚さ',
    overhang: 'オーバーハング検出',
    volume: '体積',
    surfaceArea: '表面積',
    bounds: '寸法',
    recommendations: '推奨事項',
    printable: 'このモデルは推奨設定で3Dプリント可能です。',
    needsOptimization: 'より良い印刷品質のため、このモデルは最適化が必要です。',
    notPrintable: 'このモデルは印刷前に解決する必要がある重大な問題があります。',
  },
  zh: {
    good: '良好',
    warning: '警告',
    critical: '严重',
    wallThickness: '壁厚',
    minThickness: '最小厚度',
    overhang: '悬垂检测',
    volume: '体积',
    surfaceArea: '表面积',
    bounds: '尺寸',
    recommendations: '建议',
    printable: '该模型适合用推荐设置进行3D打印。',
    needsOptimization: '该模型需要优化以获得更好的打印质量。',
    notPrintable: '该模型存在必须在打印前解决的严重问题。',
  },
};

export function AnalysisResults({ model, language }: AnalysisResultsProps) {
  const labels = statusLabels[language];
  const analysis = model.analysis;

  const isGood = analysis.wallThickness.status === 'good' && analysis.overhang.status === 'good';
  const hasCritical =
    analysis.wallThickness.status === 'critical' || analysis.overhang.status === 'critical';

  const recommendation = hasCritical
    ? labels.notPrintable
    : isGood
      ? labels.printable
      : labels.needsOptimization;

  return (
    <ResultsAnimation>
      <div className="space-y-8">
        <ModelPreviewScene model={model} />

        <div className="space-y-2">
          <div className="font-mono text-xs text-muted-foreground opacity-70">FILE</div>
          <div className="font-serif text-2xl font-bold text-foreground">{model.fileName}</div>
        </div>

        <div className="space-y-3 p-6 bg-secondary/50 rounded-lg">
          <div className="font-mono text-xs text-muted-foreground opacity-70">
            {labels.recommendations}
          </div>
          <p className="font-mono text-sm text-muted-foreground leading-relaxed">
            {recommendation}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-lg font-bold text-foreground">
                {labels.wallThickness}
              </h3>
              <span
                className={`font-mono text-xs font-bold ${statusColors[analysis.wallThickness.status]}`}
              >
                {labels[analysis.wallThickness.status]}
              </span>
            </div>
            <div className="font-mono text-sm text-muted-foreground space-y-1">
              <div>
                {labels.minThickness}: {analysis.wallThickness.minThickness.toFixed(2)} mm
              </div>
              <div>Areas affected: {analysis.wallThickness.areas}</div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-lg font-bold text-foreground">{labels.overhang}</h3>
              <span
                className={`font-mono text-xs font-bold ${statusColors[analysis.overhang.status]}`}
              >
                {labels[analysis.overhang.status]}
              </span>
            </div>
            <div className="font-mono text-sm text-muted-foreground space-y-1">
              <div>Angle threshold: {analysis.overhang.angle}°</div>
              <div>Problematic areas: {analysis.overhang.areas}</div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-mono text-xs text-muted-foreground opacity-70">
              {labels.volume}
            </div>
            <div className="font-serif text-2xl font-bold text-foreground">
              {analysis.volume.toFixed(2)} mm³
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-mono text-xs text-muted-foreground opacity-70">
              {labels.surfaceArea}
            </div>
            <div className="font-serif text-2xl font-bold text-foreground">
              {analysis.surfaceArea.toFixed(2)} mm²
            </div>
          </div>
        </div>

        <div className="space-y-3 p-6 bg-secondary/30 rounded-lg">
          <div className="font-mono text-xs text-muted-foreground opacity-70">{labels.bounds}</div>
          <div className="grid grid-cols-3 gap-4 font-mono text-sm">
            <div>
              <div className="text-muted-foreground opacity-70">X</div>
              <div className="font-bold text-foreground">
                {(analysis.bounds.max.x - analysis.bounds.min.x).toFixed(2)} mm
              </div>
            </div>
            <div>
              <div className="text-muted-foreground opacity-70">Y</div>
              <div className="font-bold text-foreground">
                {(analysis.bounds.max.y - analysis.bounds.min.y).toFixed(2)} mm
              </div>
            </div>
            <div>
              <div className="text-muted-foreground opacity-70">Z</div>
              <div className="font-bold text-foreground">
                {(analysis.bounds.max.z - analysis.bounds.min.z).toFixed(2)} mm
              </div>
            </div>
          </div>
        </div>
      </div>
    </ResultsAnimation>
  );
}
