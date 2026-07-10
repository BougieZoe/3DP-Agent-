import * as THREE from 'three';
import type { AnalysisReport, ModelAnalysis } from '@shared/domain/analysis';
import type { AdvisorLanguage } from '@shared/domain/advisor';
import {
  completeStage,
  createPendingStage,
  failStage,
  skipStage,
  startStage,
  type WorkflowStageResult,
} from '@shared/domain/workflow';
import { generateQuickReport, type ModelData } from './ruleEngine';
import { loadSTLFile } from './stlLoader';
import { runAnalysisPipeline, fromThreeBufferGeometry, type UnifiedAnalysis } from '@/analysis';

function deriveWtStatus(
  thinWallRatio: number | undefined,
  p5Thickness?: number | null,
): 'good' | 'warning' | 'critical' {
  const twr = thinWallRatio ?? 0;
  if (twr > 0.15) return 'critical';
  if (twr > 0.05) return 'warning';
  if (p5Thickness != null && p5Thickness < 0.4) return 'warning';
  return 'good';
}

function deriveOhStatus(faceCount: number | undefined, totalTriangles: number | undefined): 'good' | 'warning' | 'critical' {
  if (!faceCount || faceCount === 0) return 'good';
  const ratio = totalTriangles && totalTriangles > 0 ? faceCount / totalTriangles : 0;
  if (ratio > 0.3) return 'critical';
  if (ratio > 0.1) return 'warning';
  return 'good';
}

function unifiedToModelData(unifiedAnalysis: UnifiedAnalysis, fileName: string): ModelData {
  const metrics = unifiedAnalysis.metrics.result;
  const topology = unifiedAnalysis.topology.result;
  const triCount = topology?.triangleCount ?? 0;
  const volume = metrics?.meshVolumeMm3 ?? metrics?.boundingBoxVolumeMm3 ?? 0;
  const surfaceArea = metrics?.surfaceAreaMm2 ?? 0;
  const oh = metrics?.overhang;
  const dims = metrics?.boundingBoxDimensionsMm ?? { x: 0, y: 0, z: 0 };
  const thinWallRatio = metrics?.thinWallRatio ?? 0;
  const p5Thickness = metrics?.p5WallThicknessMm;
  const minWall = metrics?.minWallThicknessMm;
  const wtStatus = deriveWtStatus(thinWallRatio, p5Thickness);

  return {
    fileName,
    wallThickness: {
      minThickness: p5Thickness ?? metrics?.avgWallThicknessMm ?? metrics?.medianWallThicknessMm ?? minWall ?? Math.min(dims.x, dims.y, dims.z) * 0.5,
      p1Thickness: metrics?.p1WallThicknessMm ?? null,
      p5Thickness: metrics?.p5WallThicknessMm ?? null,
      p10Thickness: metrics?.p10WallThicknessMm ?? null,
      medianThickness: metrics?.medianWallThicknessMm ?? null,
      avgThickness: metrics?.avgWallThicknessMm ?? null,
      thinWallCount: metrics?.thinWallCount ?? 0,
      thinWallPercentage: metrics?.thinWallPercentage ?? 0,
      thinWallRatio: metrics?.thinWallRatio ?? 0,
      averageConfidence: metrics?.averageConfidence ?? 0,
      lowConfidenceSampleCount: metrics?.lowConfidenceSampleCount ?? 0,
      areas: Math.floor(triCount * 0.15),
      status: wtStatus,
    },
    overhang: {
      angle: 45,
      areas: oh?.faceCount ?? 0,
      status: deriveOhStatus(oh?.faceCount, triCount),
    },
    volume,
    surfaceArea,
    dims,
  };
}

export interface ParseMeshStageOutput {
  fileName: string;
  fileSizeBytes?: number;
  geometryAvailable: true;
}

export interface AnalyzeGeometryStageOutput {
  triangleCount: number;
  surfaceArea: number;
  boundingBoxVolume: number;
}

export interface PrintReviewWorkflowStages {
  parseMesh: WorkflowStageResult<ParseMeshStageOutput>;
  analyzeGeometry: WorkflowStageResult<AnalyzeGeometryStageOutput>;
  evaluatePrintability: WorkflowStageResult<ModelAnalysis>;
  generateReport: WorkflowStageResult<AnalysisReport>;
}

export interface LocalPrintReviewWorkflowResult {
  stages: PrintReviewWorkflowStages;
  geometry?: THREE.BufferGeometry;
  unifiedAnalysis?: UnifiedAnalysis;
  modelAnalysis?: ModelAnalysis;
  report?: AnalysisReport;
}

export interface LocalPrintReviewWorkflowOptions {
  language: AdvisorLanguage;
  generateReport?: boolean;
}

export interface LocalPrintReviewWorkflowDependencies {
  parseMesh?: (file: File) => Promise<THREE.BufferGeometry>;
  now?: () => string;
}

export async function executeLocalPrintReviewWorkflow(
  file: File,
  options: LocalPrintReviewWorkflowOptions,
  dependencies: LocalPrintReviewWorkflowDependencies = {},
): Promise<LocalPrintReviewWorkflowResult> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const parseMesh = dependencies.parseMesh ?? loadSTLFile;
  const stages = createInitialPrintReviewStages();
  const result: LocalPrintReviewWorkflowResult = { stages };

  try {
    stages.parseMesh = startStage(stages.parseMesh, now());
    const geometry = await parseMesh(file);
    result.geometry = geometry;
    stages.parseMesh = completeStage(
      stages.parseMesh,
      {
        fileName: file.name,
        fileSizeBytes: file.size,
        geometryAvailable: true,
      },
      now(),
    );

    stages.analyzeGeometry = startStage(stages.analyzeGeometry, now());
    const model = fromThreeBufferGeometry(geometry);
    const unifiedAnalysis = runAnalysisPipeline(model, { fileName: file.name });
    result.unifiedAnalysis = unifiedAnalysis;
    const triCount = unifiedAnalysis.topology.result?.triangleCount ?? 0;
    const surfaceArea = unifiedAnalysis.metrics.result?.surfaceAreaMm2 ?? 0;
    const boundingBoxVolume = unifiedAnalysis.metrics.result?.boundingBoxVolumeMm3 ?? 0;
    stages.analyzeGeometry = completeStage(
      stages.analyzeGeometry,
      { triangleCount: triCount, surfaceArea, boundingBoxVolume },
      now(),
    );

    stages.evaluatePrintability = startStage(stages.evaluatePrintability, now());
    const modelData = unifiedToModelData(unifiedAnalysis, file.name);

    if (options.generateReport === false) {
      stages.evaluatePrintability = completeStage(
        stages.evaluatePrintability,
        {} as ModelAnalysis,
        now(),
      );
      stages.generateReport = skipStage(stages.generateReport, now());
      return result;
    }

    const report = createAnalysisReport(modelData, options.language, now());
    result.report = report;
    stages.evaluatePrintability = completeStage(
      stages.evaluatePrintability,
      report as unknown as ModelAnalysis,
      now(),
    );

    stages.generateReport = startStage(stages.generateReport, now());
    stages.generateReport = completeStage(stages.generateReport, report, now());

    return result;
  } catch (error) {
    failActiveStage(stages, error, now());
    return result;
  }
}

export function createInitialPrintReviewStages(): PrintReviewWorkflowStages {
  return {
    parseMesh: createPendingStage('parse_mesh'),
    analyzeGeometry: createPendingStage('analyze_geometry'),
    evaluatePrintability: createPendingStage('evaluate_printability'),
    generateReport: createPendingStage('generate_report'),
  };
}

function createAnalysisReport(
  modelData: ModelData,
  language: AdvisorLanguage,
  generatedAt: string,
): AnalysisReport {
  return {
    id: `${modelData.fileName}:local-report:${language}`,
    modelSourceId: modelData.fileName,
    format: 'plain_text',
    content: generateQuickReport(modelData, language),
    generatedAt,
    source: 'local_rules',
  };
}

function failActiveStage(
  stages: PrintReviewWorkflowStages,
  error: unknown,
  completedAt: string,
) {
  const stageError = {
    code: 'stage_failed',
    message: error instanceof Error ? error.message : 'Workflow stage failed',
  };

  if (stages.parseMesh.status === 'running') {
    stages.parseMesh = failStage(stages.parseMesh, stageError, completedAt);
    return;
  }
  if (stages.analyzeGeometry.status === 'running') {
    stages.analyzeGeometry = failStage(stages.analyzeGeometry, stageError, completedAt);
    return;
  }
  if (stages.evaluatePrintability.status === 'running') {
    stages.evaluatePrintability = failStage(stages.evaluatePrintability, stageError, completedAt);
    return;
  }
  if (stages.generateReport.status === 'running') {
    stages.generateReport = failStage(stages.generateReport, stageError, completedAt);
  }
}
