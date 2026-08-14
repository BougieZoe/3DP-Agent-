import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import type { UnifiedAnalysis } from '@/analysis';
import {
  computeCategories,
  computeOverallScore,
  computeVerdict,
  buildIssuesFromCategories,
  generateExplanation,
} from './confidenceEngine';
import { parsePromptMeta, runSemanticChecks } from './semanticCheck';
import { generateRepairSuggestions, buildIssuesFromSuggestions } from './repairSuggestions';
import { parseDesignIntent } from './designIntent';
import {
  computeStructuralRisk,
  computePrintRisk,
  computeManufacturingRisk,
  aggregateOverallRisk,
} from './riskEngine';
import type {
  CADConfidenceReport,
  Issue,
  DesignIntent,
  SemanticCheckResult,
  ConfidenceCategory,
  RepairSuggestion,
  GenerationQuality,
} from './types';

function computeIntentMatch(
  intent: DesignIntent,
  categories: ConfidenceCategory[],
  semanticChecks: SemanticCheckResult[],
  language: ContentLang = 'en',
): { score: number; matches: { aspect: string; passed: boolean; detail: string }[] } {
  const matches: { aspect: string; passed: boolean; detail: string }[] = [];
  const hasDims = intent.dimensions.x != null || intent.dimensions.y != null || intent.dimensions.z != null;

  if (hasDims) {
    const dimChecks = semanticChecks.filter(c =>
      ['width', 'depth', 'height'].includes(c.check),
    );
    if (dimChecks.length > 0) {
      const passed = dimChecks.filter(c => c.passed).length;
      const ratio = passed / dimChecks.length;
      matches.push({
        aspect: 'dimensions',
        passed: ratio >= 0.66,
        detail: translate(CONTENT, 'cad.intent.dimsVerified', language, { passed, total: dimChecks.length }),
      });
    } else {
      matches.push({ aspect: 'dimensions', passed: true, detail: translate(CONTENT, 'cad.intent.dimsNotVerifiable', language) });
    }
  }

  if (intent.process != null) {
    const viable = categories.find(c => c.id === 'printability');
    const score = viable?.score ?? 50;
    const isCompatible = score >= 40;
    matches.push({
      aspect: 'process',
      passed: isCompatible,
      detail: isCompatible
        ? translate(CONTENT, 'cad.intent.processCompatible', language, { process: intent.process })
        : translate(CONTENT, 'cad.intent.processNeedsAdjust', language, { process: intent.process }),
    });
  }

  if (intent.requirements.length > 0) {
    const geoScore = categories.find(c => c.id === 'geometry')?.score ?? 50;
    const plausible = geoScore >= 50;
    matches.push({
      aspect: 'requirements',
      passed: plausible,
      detail: plausible
        ? translate(CONTENT, 'cad.intent.requirementsMet', language)
        : translate(CONTENT, 'cad.intent.requirementsNotMet', language),
    });
  }

  if (matches.length === 0) {
    matches.push({ aspect: 'general', passed: true, detail: translate(CONTENT, 'cad.intent.limited', language) });
  }

  const weightedScore = Math.round(
    matches.reduce((s, m) => s + (m.passed ? 100 / matches.length : 0), 0),
  );

  return { score: weightedScore, matches };
}

export function runConfidenceGate(
  analysis: UnifiedAnalysis,
  prompt: string,
  generationQuality?: GenerationQuality,
  language?: ContentLang,
): {
  report: CADConfidenceReport;
  issues: Issue[];
} {
  const lang = language ?? 'en';
  const meta = parsePromptMeta(prompt);
  const designIntent = parseDesignIntent(prompt);
  const categories = computeCategories(analysis, lang);
  const quality = generationQuality ?? 'SUCCESS';
  const qualityPenalty = quality === 'FALLBACK' ? 12 : quality === 'FAILED' ? 40 : 0;
  const overallScore = Math.max(0, computeOverallScore(categories) - qualityPenalty);
  const semanticChecks = runSemanticChecks(meta, analysis);
  const repairSuggestions = generateRepairSuggestions(analysis, lang);

  const hasFailedChecks = semanticChecks.some(c => !c.passed && c.severity === 'error') || quality === 'FAILED';
  const hasWarningChecks = semanticChecks.some(c => !c.passed && c.severity === 'warning') || quality === 'FALLBACK';
  const verdict = computeVerdict(overallScore, hasFailedChecks, hasWarningChecks);

  const categoryIssues = buildIssuesFromCategories(categories);
  const suggestionIssues = buildIssuesFromSuggestions(repairSuggestions, analysis, lang);

  const existingMessages = new Set(categoryIssues.map(i => i.message));
  for (const si of suggestionIssues) {
    if (!existingMessages.has(si.message)) {
      categoryIssues.push(si);
      existingMessages.add(si.message);
    }
  }

  const structuralRisk = computeStructuralRisk(analysis, lang);
  const printRisk = computePrintRisk(analysis, lang);
  const intentMatch = computeIntentMatch(designIntent, categories, semanticChecks, lang);
  const manufacturingRisk = computeManufacturingRisk(structuralRisk, printRisk, intentMatch, lang);
  const aggregatedRiskScore = aggregateOverallRisk(analysis, intentMatch.score);
  const explanation = generateExplanation(categories, categoryIssues, repairSuggestions, aggregatedRiskScore, lang);

  return {
    report: {
      overallScore,
      verdict,
      categories,
      semanticChecks,
      repairSuggestions,
      timestamp: new Date().toISOString(),
      generationQuality: quality,
      explanation,
      designIntent,
      intentMatch,
      risks: {
        structural: structuralRisk,
        print: printRisk,
        manufacturing: manufacturingRisk,
      },
    },
    issues: categoryIssues,
  };
}

export type {
  Verdict,
  GenerationQuality,
  IssueSeverity,
  RepairCategory,
  Impact,
  RiskLevel,
  Issue,
  PromptMeta,
  ConfidenceCategory,
  SemanticCheckResult,
  RepairSuggestion,
  RiskAssessment,
  CADConfidenceReport,
  ConfidenceExplanation,
  DesignIntent,
  IntentMatchResult,
  CADRunRecord,
  ImprovementResult,
  RepairAction,
  RepairProposal,
  RegenerationRequest,
} from './types';
