import { normalizeModelAnalysis, type ModelAnalysis } from '@shared/domain/analysis';
import { createGeometryBounds } from '@shared/domain/geometry';
import type { PrintabilityFinding, Severity } from '@shared/domain/printability';
import type { AnalysisResult } from './stlLoader';
import type { ModelData } from './ruleEngine';

export interface ModelAnalysisInput {
  fileName: string;
  fileSizeBytes?: number;
  analysis: AnalysisResult;
}

function statusToSeverity(status: AnalysisResult['wallThickness']['status']): Severity {
  if (status === 'critical') return 'critical';
  if (status === 'warning') return 'warning';
  return 'info';
}

function createFindings(analysis: AnalysisResult): PrintabilityFinding[] {
  const findings: PrintabilityFinding[] = [];

  if (analysis.wallThickness.status !== 'good') {
    findings.push({
      id: 'wall-thickness-summary',
      category: 'wall_thickness',
      severity: statusToSeverity(analysis.wallThickness.status),
      title: 'Wall thickness',
      message: `Minimum wall thickness is ${analysis.wallThickness.minThickness.toFixed(2)}mm.`,
      source: 'heuristic',
      metrics: {
        minThicknessMm: analysis.wallThickness.minThickness,
        affectedAreas: analysis.wallThickness.areas,
      },
    });
  }

  if (analysis.overhang.status !== 'good') {
    findings.push({
      id: 'overhang-summary',
      category: 'overhang',
      severity: statusToSeverity(analysis.overhang.status),
      title: 'Overhang',
      message: `${analysis.overhang.areas} faces exceed ${analysis.overhang.angle} degrees.`,
      source: 'heuristic',
      metrics: {
        affectedFaces: analysis.overhang.areas,
        thresholdDeg: analysis.overhang.angle,
      },
    });
  }

  return findings;
}

export function toModelAnalysis(input: ModelAnalysisInput): ModelAnalysis {
  const { analysis } = input;

  return normalizeModelAnalysis({
    source: {
      id: input.fileName,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      fileType: input.fileName.toLowerCase().endsWith('.stl') ? 'stl' : 'unknown',
    },
    metrics: {
      bounds: createGeometryBounds(analysis.bounds.min, analysis.bounds.max),
      triangleCount: analysis.triangleCount,
      surfaceAreaMm2: analysis.surfaceArea,
      boundingBoxVolumeMm3: analysis.volume,
    },
    findings: createFindings(analysis),
    legacy: {
      wallThickness: {
        minThicknessMm: analysis.wallThickness.minThickness,
        affectedAreas: analysis.wallThickness.areas,
        status: analysis.wallThickness.status,
      },
      overhang: {
        thresholdDeg: analysis.overhang.angle,
        affectedFaces: analysis.overhang.areas,
        status: analysis.overhang.status,
      },
    },
  });
}

export function modelAnalysisToModelData(modelAnalysis: ModelAnalysis): ModelData {
  return {
    fileName: modelAnalysis.source.fileName,
    wallThickness: {
      minThickness: modelAnalysis.legacy.wallThickness.minThicknessMm,
      areas: modelAnalysis.legacy.wallThickness.affectedAreas,
      status: modelAnalysis.legacy.wallThickness.status,
    },
    overhang: {
      angle: modelAnalysis.legacy.overhang.thresholdDeg,
      areas: modelAnalysis.legacy.overhang.affectedFaces,
      status: modelAnalysis.legacy.overhang.status,
    },
    volume: modelAnalysis.metrics.boundingBoxVolumeMm3,
    surfaceArea: modelAnalysis.metrics.surfaceAreaMm2,
    dims: modelAnalysis.metrics.bounds.size,
  };
}
