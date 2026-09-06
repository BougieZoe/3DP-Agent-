import { PANEL } from '@/lib/visualLanguage';
import { getTranslation, type Language } from '@/lib/i18n';
import type { UnifiedAnalysis } from '../analysis/types';
import type { ProcessRecommendation } from '../lib/manufacturingRecommendation';

interface ManufacturerExportProps {
  analysis: UnifiedAnalysis | null;
  recommendations: ProcessRecommendation[];
  fileName: string;
  language?: Language;
}

export interface ManufacturerSpec {
  _format: '3dp-agent-manufacturer-spec';
  _version: '1.0';
  _generated: string;
  _source: string;
  geometry: {
    fileName: string;
    volumeMm3: number;
    surfaceAreaMm2: number;
    boundingBoxMm: { x: number; y: number; z: number };
    triangleCount: number;
    isWatertight: boolean;
    isManifold: boolean;
  };
  wallThickness: {
    minimumMm: number | null;
    averageMm: number | null;
    medianMm: number | null;
    thinWallCount: number;
    thinWallPercentage: number;
    confidence: number;
  };
  overhang: {
    severity: string;
    faceCount: number;
    ratio: number;
    areaMm2: number;
  };
  support: {
    difficulty: string;
    estimatedVolumeMm3: number;
    estimatedGrams: number;
  } | null;
  printTime: {
    estimatedMinutes: number;
    estimatedHours: number;
    materialGrams: number;
    layerCount: number;
  } | null;
  thermal: {
    warpageRisk: number;
    delaminationRisk: number;
  } | null;
  recommendations: Array<{
    process: string;
    fit: string;
    confidence: number;
    reasons: string[];
    warnings: string[];
  }>;
  dfamNotes: string[];
}

function buildSpec(
  analysis: UnifiedAnalysis,
  recommendations: ProcessRecommendation[],
  fileName: string,
): ManufacturerSpec {
  const m = analysis.metrics?.result;
  const v = analysis.validation?.result;
  const t = analysis.topology?.result;
  const s = analysis.support?.result;
  const pt = analysis.printTime?.result;
  const fgf = analysis.fgf?.result;

  const dfamNotes: string[] = [];

  if (m && m.minWallThicknessMm !== null && m.minWallThicknessMm < 0.8) {
    dfamNotes.push(`Min wall ${m.minWallThicknessMm.toFixed(2)}mm is below 0.8mm — reinforce or thicken critical areas`);
  }
  if (m && m.overhang.severity === 'severe') {
    dfamNotes.push('Severe overhangs detected — optimize print orientation or add support structures');
  }
  if (v && !v.isWatertight) {
    dfamNotes.push('Mesh is not watertight — repair before printing to avoid slicer artifacts');
  }
  if (fgf && fgf.warpageRisk > 0.6) {
    dfamNotes.push(`High warpage risk (${(fgf.warpageRisk * 100).toFixed(0)}%) — consider brim/raft or heated chamber`);
  }
  if (s && s.difficulty === 'very_difficult') {
    dfamNotes.push('Very difficult support removal — consider splitting model or redesigning overhangs');
  }
  if (m && m.boundingBoxDimensionsMm.x > 256 && m.boundingBoxDimensionsMm.y > 256 && m.boundingBoxDimensionsMm.z > 256) {
    dfamNotes.push('Part exceeds standard FDM build volume — requires large-format (FGF) or splitting');
  }

  return {
    _format: '3dp-agent-manufacturer-spec',
    _version: '1.0',
    _generated: new Date().toISOString(),
    _source: fileName,
    geometry: {
      fileName,
      volumeMm3: m?.meshVolumeMm3 ?? 0,
      surfaceAreaMm2: m?.surfaceAreaMm2 ?? 0,
      boundingBoxMm: m?.boundingBoxDimensionsMm ?? { x: 0, y: 0, z: 0 },
      triangleCount: t?.triangleCount ?? 0,
      isWatertight: v?.isWatertight ?? false,
      isManifold: t?.isManifold ?? false,
    },
    wallThickness: {
      minimumMm: m?.minWallThicknessMm ?? null,
      averageMm: m?.avgWallThicknessMm ?? null,
      medianMm: m?.medianWallThicknessMm ?? null,
      thinWallCount: m?.thinWallCount ?? 0,
      thinWallPercentage: m?.thinWallPercentage ?? 0,
      confidence: m?.averageConfidence ?? 0,
    },
    overhang: {
      severity: m?.overhang.severity ?? 'unknown',
      faceCount: m?.overhang.faceCount ?? 0,
      ratio: m?.overhang.ratio ?? 0,
      areaMm2: m?.overhang.overhangAreaMm2 ?? 0,
    },
    support: s ? {
      difficulty: s.difficulty,
      estimatedVolumeMm3: s.totalSupportVolumeMm3,
      estimatedGrams: s.estimatedSupportGrams,
    } : null,
    printTime: pt ? {
      estimatedMinutes: pt.estimatedPrintTimeMinutes,
      estimatedHours: pt.estimatedPrintTimeHours,
      materialGrams: pt.materialWeightGrams,
      layerCount: pt.layerCount,
    } : null,
    thermal: fgf ? {
      warpageRisk: fgf.warpageRisk,
      delaminationRisk: fgf.delaminationRisk,
    } : null,
    recommendations: recommendations.map(r => ({
      process: r.processName,
      fit: r.fit,
      confidence: r.confidence,
      reasons: r.reasons,
      warnings: r.warnings,
    })),
    dfamNotes,
  };
}

function downloadJson(spec: ManufacturerSpec, fileName: string) {
  const json = JSON.stringify(spec, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName.replace(/\.[^.]+$/, '')}-manufacturer-spec.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ManufacturerExport({
  analysis,
  recommendations,
  fileName,
  language = 'en',
}: ManufacturerExportProps) {
  if (!analysis) return null;

  const t = (key: keyof typeof import('@/lib/i18n').translations.en) => getTranslation(language, key);
  const spec = buildSpec(analysis, recommendations, fileName);

  return (
    <div className="backdrop-blur-xl bg-background/60 border border-border/30 rounded-md p-3 space-y-2 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between">
        <span className={PANEL.fontLabel}>{t('mfgHandoff')}</span>
        <button
          onClick={() => downloadJson(spec, fileName)}
          className={`${PANEL.chip} border border-cyan-400/30 text-cyan-400/80 hover:bg-cyan-400/10 transition-colors`}
        >
          {t('mfgExportJson')}
        </button>
      </div>
      <div className={`${PANEL.fontTiny} text-muted-foreground/40`}>
        {t('mfgHandoffDesc')}
      </div>
      {spec.dfamNotes.length > 0 && (
        <div className="space-y-0.5">
          {spec.dfamNotes.map((note, i) => (
            <div key={i} className={`${PANEL.fontTiny} text-amber-400/70 flex items-start gap-1`}>
              <span className="text-amber-400/40 shrink-0">{t('mfgDfam')}:</span>
              <span>{note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
