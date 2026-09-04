/**
 * AutoFixAgent — Orchestrates the DfAM→Fix→Re-validate loop.
 *
 * Given analysis results, determines whether auto-fix is warranted,
 * translates issues into LLM-actionable edit instructions, and
 * manages iteration state until convergence or max iterations.
 */

import type { CADConfidenceReport, Issue, RepairSuggestion, Verdict } from '@/cad-confidence/types';
import { issuesToEditInstruction, prioritizeIssues, type DfamIssue } from './analysisToPrompt';

// ── Constants ──

/** Minimum confidence score to consider the design "good enough". */
export const CONVERGENCE_THRESHOLD = 75;

/** Maximum fix iterations before giving up. */
export const MAX_FIX_ITERATIONS = 3;

/** Minimum score improvement between iterations to consider progress. */
export const MIN_IMPROVEMENT = 5;

// ── Types ──

export interface FixPlan {
  shouldFix: boolean;
  iteration: number;
  editInstruction: string;
  analysisContext: {
    issues: DfamIssue[];
    originalPrompt: string;
    printabilityScore: number;
  };
  reason: string;
}

export interface FixIterationResult {
  iteration: number;
  previousScore: number;
  newScore: number;
  improvement: number;
  converged: boolean;
  verdict: Verdict;
  issues: Issue[];
}

// ── Core Logic ──

/**
 * Determine whether auto-fix is warranted and compose the fix plan.
 *
 * @param report - Current confidence report
 * @param issues - Current issues from the confidence gate
 * @param originalPrompt - The user's original design prompt
 * @param iteration - Current iteration number (0 = first attempt)
 * @returns FixPlan with edit instructions, or shouldFix=false if no fix needed
 */
export function composeFixPlan(
  report: CADConfidenceReport,
  issues: Issue[],
  originalPrompt: string,
  iteration: number,
): FixPlan {
  // Already good enough
  if (report.overallScore >= CONVERGENCE_THRESHOLD && report.verdict === 'PASS') {
    return {
      shouldFix: false,
      iteration,
      editInstruction: '',
      analysisContext: { issues: [], originalPrompt, printabilityScore: report.overallScore },
      reason: `Score ${report.overallScore} >= ${CONVERGENCE_THRESHOLD} — no fix needed`,
    };
  }

  // Max iterations reached
  if (iteration >= MAX_FIX_ITERATIONS) {
    return {
      shouldFix: false,
      iteration,
      editInstruction: '',
      analysisContext: { issues: [], originalPrompt, printabilityScore: report.overallScore },
      reason: `Max iterations (${MAX_FIX_ITERATIONS}) reached — accepting current result`,
    };
  }

  // Convert issues + repair suggestions into DfamIssue format
  const dfamIssues: DfamIssue[] = [
    ...issues.map((i) => ({
      type: categorizeIssue(i.message),
      severity: i.severity as DfamIssue['severity'],
      description: i.message,
      recommendation: i.suggestion,
    })),
    ...report.repairSuggestions.map((r) => ({
      type: r.category,
      priority: r.impact === 'high' ? 'high' as const : r.impact === 'medium' ? 'medium' as const : 'low' as const,
      description: r.description,
      implementation: r.action,
    })),
  ];

  const prioritized = prioritizeIssues(dfamIssues, 5);
  const editInstruction = issuesToEditInstruction(prioritized);

  return {
    shouldFix: true,
    iteration: iteration + 1,
    editInstruction,
    analysisContext: {
      issues: prioritized,
      originalPrompt,
      printabilityScore: report.overallScore,
    },
    reason: `Score ${report.overallScore}/100 (${report.verdict}) — applying ${prioritized.length} fixes`,
  };
}

/**
 * Evaluate whether a new iteration represents convergence.
 */
export function evaluateConvergence(
  previousScore: number,
  newScore: number,
  iteration: number,
  newVerdict: Verdict,
  newIssues: Issue[],
): FixIterationResult {
  const improvement = newScore - previousScore;
  const converged =
    newVerdict === 'PASS' ||
    newScore >= CONVERGENCE_THRESHOLD ||
    iteration >= MAX_FIX_ITERATIONS ||
    improvement < MIN_IMPROVEMENT;

  return {
    iteration,
    previousScore,
    newScore,
    improvement,
    converged,
    verdict: newVerdict,
    issues: newIssues,
  };
}

/**
 * Map issue messages to standardized categories for the fix mapper.
 */
function categorizeIssue(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('thin wall') || lower.includes('wall thick')) return 'wall_thickening';
  if (lower.includes('overhang')) return 'overhang';
  if (lower.includes('support')) return 'support_addition';
  if (lower.includes('bridge') || lower.includes('bridging')) return 'bridging_redesign';
  if (lower.includes('warp')) return 'warping';
  if (lower.includes('delamination')) return 'delamination';
  if (lower.includes('fillet') || lower.includes('stress')) return 'fillet_add';
  if (lower.includes('hole')) return 'hole_fill';
  if (lower.includes('orient')) return 'orientation_change';
  if (lower.includes('scale') || lower.includes('size')) return 'scale';
  return 'geometry';
}
