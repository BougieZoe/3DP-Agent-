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
import { computeGeometryMetrics, type GeometryMetricsResult } from './geometryMetrics';
import { loadSTLFile } from './stlLoader';
import { modelAnalysisToModelData, toModelAnalysis } from './modelAnalysisAdapters';
import { composeAnalysisResult, type AnalysisResult } from './stlAnalysis';

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
  geometryMetrics?: GeometryMetricsResult;
  analysis?: AnalysisResult;
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
    const geometryMetrics = computeGeometryMetrics(geometry);
    result.geometryMetrics = geometryMetrics;
    stages.analyzeGeometry = completeStage(
      stages.analyzeGeometry,
      {
        triangleCount: geometryMetrics.triangleCount,
        surfaceArea: geometryMetrics.surfaceArea,
        boundingBoxVolume: geometryMetrics.boundingBoxVolume,
      },
      now(),
    );

    stages.evaluatePrintability = startStage(stages.evaluatePrintability, now());
    const analysis = composeAnalysisResult(geometryMetrics);
    const modelAnalysis = toModelAnalysis({
      fileName: file.name,
      fileSizeBytes: file.size,
      analysis,
    });
    result.analysis = analysis;
    result.modelAnalysis = modelAnalysis;
    stages.evaluatePrintability = completeStage(
      stages.evaluatePrintability,
      modelAnalysis,
      now(),
    );

    if (options.generateReport === false) {
      stages.generateReport = skipStage(stages.generateReport, now());
      return result;
    }

    stages.generateReport = startStage(stages.generateReport, now());
    const report = createAnalysisReport(
      modelAnalysis,
      modelAnalysisToModelData(modelAnalysis),
      options.language,
      now(),
    );
    result.report = report;
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
  modelAnalysis: ModelAnalysis,
  modelData: ModelData,
  language: AdvisorLanguage,
  generatedAt: string,
): AnalysisReport {
  return {
    id: `${modelAnalysis.source.id}:local-report:${language}`,
    modelSourceId: modelAnalysis.source.id,
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
