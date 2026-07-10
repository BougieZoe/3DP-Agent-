import type { GeometryMetrics, ModelSource } from './geometry';
import type { LegacyPrintabilityStatus, PrintabilityFinding } from './printability';
import { createGeometryBounds } from './geometry';

export interface LegacyWallThicknessSummary {
  minThicknessMm: number;
  p1ThicknessMm: number | null;
  p5ThicknessMm: number | null;
  p10ThicknessMm: number | null;
  medianThicknessMm: number | null;
  avgThicknessMm: number | null;
  thinWallCount: number;
  thinWallPercentage: number;
  averageConfidence: number;
  lowConfidenceSampleCount: number;
  affectedAreas: number;
  status: LegacyPrintabilityStatus;
}

export interface LegacyOverhangSummary {
  thresholdDeg: number;
  affectedFaces: number;
  status: LegacyPrintabilityStatus;
}

export interface LegacyAnalysisSummary {
  wallThickness: LegacyWallThicknessSummary;
  overhang: LegacyOverhangSummary;
}

export interface ModelAnalysis {
  source: ModelSource;
  metrics: GeometryMetrics;
  findings: PrintabilityFinding[];
  legacy: LegacyAnalysisSummary;
}

export type ReportFormat = 'plain_text' | 'markdown' | 'json';

export interface AnalysisReport {
  id: string;
  modelSourceId: string;
  format: ReportFormat;
  content: string;
  generatedAt: string;
  source: 'local_rules' | 'advisor' | 'slicer';
}

export function normalizeModelAnalysis(modelAnalysis: ModelAnalysis): ModelAnalysis {
  return {
    source: {
      id: modelAnalysis.source.id,
      fileName: modelAnalysis.source.fileName,
      fileSizeBytes: modelAnalysis.source.fileSizeBytes,
      fileType: modelAnalysis.source.fileType,
    },
    metrics: {
      bounds: createGeometryBounds(
        modelAnalysis.metrics.bounds.min,
        modelAnalysis.metrics.bounds.max,
      ),
      triangleCount: modelAnalysis.metrics.triangleCount,
      surfaceAreaMm2: modelAnalysis.metrics.surfaceAreaMm2,
      boundingBoxVolumeMm3: modelAnalysis.metrics.boundingBoxVolumeMm3,
      meshVolumeMm3: modelAnalysis.metrics.meshVolumeMm3,
    },
    findings: modelAnalysis.findings.map(finding => ({
      id: finding.id,
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      message: finding.message,
      source: finding.source,
      metrics: finding.metrics ? { ...finding.metrics } : undefined,
    })),
    legacy: {
      wallThickness: {
        minThicknessMm: modelAnalysis.legacy.wallThickness.minThicknessMm,
        p1ThicknessMm: modelAnalysis.legacy.wallThickness.p1ThicknessMm,
        p5ThicknessMm: modelAnalysis.legacy.wallThickness.p5ThicknessMm,
        p10ThicknessMm: modelAnalysis.legacy.wallThickness.p10ThicknessMm,
        medianThicknessMm: modelAnalysis.legacy.wallThickness.medianThicknessMm,
        avgThicknessMm: modelAnalysis.legacy.wallThickness.avgThicknessMm,
        thinWallCount: modelAnalysis.legacy.wallThickness.thinWallCount,
        thinWallPercentage: modelAnalysis.legacy.wallThickness.thinWallPercentage,
        averageConfidence: modelAnalysis.legacy.wallThickness.averageConfidence,
        lowConfidenceSampleCount: modelAnalysis.legacy.wallThickness.lowConfidenceSampleCount,
        affectedAreas: modelAnalysis.legacy.wallThickness.affectedAreas,
        status: modelAnalysis.legacy.wallThickness.status,
      },
      overhang: {
        thresholdDeg: modelAnalysis.legacy.overhang.thresholdDeg,
        affectedFaces: modelAnalysis.legacy.overhang.affectedFaces,
        status: modelAnalysis.legacy.overhang.status,
      },
    },
  };
}
