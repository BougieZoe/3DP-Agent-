/**
 * Report Generator
 *
 * Generates structured reports from analysis results.
 * Combines findings, recommendations, and cost breakdown into a unified report.
 */

import type {
  UnifiedAnalysis,
  StructuredReport,
  ReportMetadata,
  ExecutiveSummary,
  ConfidenceBreakdown,
  ActionItem,
  Finding,
  Recommendation,
} from './types';
import type { AgentRunSummary } from '../agents/types';
import { extractFindings } from './findingExtractor';
import { aggregateRecommendations } from './recommendationAggregator';
import { calculateCostBreakdown } from './costCalculator';

interface ReportGeneratorOptions {
  material?: { name: string; family: string };
  printerProfile?: { name: string };
  analysisMode?: 'rules' | 'llm' | 'hybrid';
}

/**
 * Generate a structured report from analysis results.
 */
export function generateStructuredReport(
  analysis: UnifiedAnalysis,
  agentSummary: AgentRunSummary,
  options: ReportGeneratorOptions = {},
): StructuredReport {
  const findings = extractFindings(analysis);
  const recommendations = aggregateRecommendations(findings, analysis);
  const costBreakdown = calculateCostBreakdown(analysis);

  const metadata = buildMetadata(analysis, options);
  const executiveSummary = buildExecutiveSummary(analysis, agentSummary, findings, recommendations, costBreakdown);
  const confidenceBreakdown = buildConfidenceBreakdown(analysis, agentSummary);
  const actionItems = buildActionItems(recommendations, findings);

  return {
    metadata,
    executiveSummary,
    findings,
    recommendations,
    costBreakdown,
    confidenceBreakdown,
    actionItems,
  };
}

/**
 * Build report metadata.
 */
function buildMetadata(
  analysis: UnifiedAnalysis,
  options: ReportGeneratorOptions,
): ReportMetadata {
  return {
    fileName: analysis.modelFileName,
    material: options.material?.name ?? 'Unknown',
    printerProfile: options.printerProfile?.name ?? 'Unknown',
    technologyFamily: options.material?.family ?? 'unknown',
    analysisDate: analysis.timestamp,
    analysisMode: options.analysisMode ?? 'hybrid',
    mlModelsAvailable: !!analysis.mlAnalysis,
  };
}

/**
 * Build executive summary.
 */
function buildExecutiveSummary(
  analysis: UnifiedAnalysis,
  agentSummary: AgentRunSummary,
  findings: Finding[],
  recommendations: Recommendation[],
  costBreakdown: { totalCostUsd: number },
): ExecutiveSummary {
  const keyIssues = findings
    .filter((f) => f.severity === 'critical')
    .slice(0, 3);

  const quickWins = recommendations
    .filter((r) => r.effort === 'easy')
    .slice(0, 3);

  const printTime = analysis.printTime?.result;

  return {
    overallScore: agentSummary.consensus.overallScore,
    verdict: agentSummary.consensus.verdict === 'inconclusive' ? 'warning' : agentSummary.consensus.verdict,
    keyIssues,
    quickWins,
    estimatedCost: costBreakdown.totalCostUsd,
    estimatedPrintTime: printTime?.estimatedPrintTimeMinutes ?? 0,
  };
}

/**
 * Build confidence breakdown.
 */
function buildConfidenceBreakdown(
  analysis: UnifiedAnalysis,
  agentSummary: AgentRunSummary,
): ConfidenceBreakdown {
  const geometryAnalyst = agentSummary.results.find(
    (r) => r.agentId === 'geometry_analyst',
  );
  const printabilityScorer = agentSummary.results.find(
    (r) => r.agentId === 'printability_scorer',
  );
  const failurePredictor = agentSummary.results.find(
    (r) => r.agentId === 'failure_predictor',
  );

  return {
    geometryAnalysis: analysis.topology?.confidence ?? 0,
    printabilityAssessment: printabilityScorer?.confidence ?? 0,
    failurePrediction: failurePredictor?.confidence ?? 0,
    thermalAnalysis: analysis.thermal?.confidence ?? 0,
    mlInference: analysis.mlAnalysis?.confidence ?? 0,
    overall: analysis.overallConfidence,
  };
}

/**
 * Build action items from recommendations.
 */
function buildActionItems(
  recommendations: Recommendation[],
  findings: Finding[],
): ActionItem[] {
  return recommendations
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    })
    .map((rec, index) => ({
      id: `action-${index}`,
      order: index + 1,
      action: rec.title,
      reason: rec.description,
      estimatedTime: rec.effort === 'easy' ? '5分钟' : rec.effort === 'moderate' ? '30分钟' : '2小时',
      dependencies: rec.relatedFindings,
    }));
}
