/**
 * S3 — Validation Reporter
 *
 * Generates human-readable and machine-readable test reports.
 */

import type { S3TestCaseResult, ModuleComparison } from "../s3-schema";

export interface ReportOptions {
  /** Include field-level details in report */
  verbose?: boolean;
  /** Format: "text" | "json" | "markdown" */
  format?: "text" | "json" | "markdown";
}

export interface ValidationReport {
  /** Total cases run */
  total: number;
  /** Cases that passed */
  passed: number;
  /** Cases that failed */
  failed: number;
  /** Total duration (ms) */
  totalDurationMs: number;
  /** Average duration per case (ms) */
  avgDurationMs: number;
  /** Pass rate (0-1) */
  passRate: number;
  /** Individual case results */
  results: S3TestCaseResult[];
  /** Failure summary */
  failures: Array<{
    caseId: string;
    failures: string[];
  }>;
}

/**
 * Generate a validation report from results.
 */
export function generateReport(
  results: S3TestCaseResult[],
  options: ReportOptions = {}
): ValidationReport {
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  const totalDurationMs = results.reduce(
    (sum, r) => sum + r.totalDurationMs,
    0
  );
  const avgDurationMs = total > 0 ? totalDurationMs / total : 0;
  const passRate = total > 0 ? passed / total : 0;

  const failures = results
    .filter(r => !r.passed)
    .map(r => ({
      caseId: r.caseId,
      failures: r.failures,
    }));

  return {
    total,
    passed,
    failed,
    totalDurationMs,
    avgDurationMs,
    passRate,
    results,
    failures,
  };
}

/**
 * Format report as human-readable text.
 */
export function formatTextReport(
  report: ValidationReport,
  options: ReportOptions = {}
): string {
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("                    S3 VALIDATION REPORT");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("");

  // Summary
  lines.push("Summary:");
  lines.push(`  Total cases: ${report.total}`);
  lines.push(`  Passed: ${report.passed}`);
  lines.push(`  Failed: ${report.failed}`);
  lines.push(`  Pass rate: ${(report.passRate * 100).toFixed(1)}%`);
  lines.push(`  Total duration: ${report.totalDurationMs.toFixed(0)}ms`);
  lines.push(`  Avg duration: ${report.avgDurationMs.toFixed(0)}ms`);
  lines.push("");

  // Individual results
  lines.push("───────────────────────────────────────────────────────────────");
  lines.push("Results:");
  lines.push("───────────────────────────────────────────────────────────────");

  for (const result of report.results) {
    const status = result.passed ? "✅ PASS" : "❌ FAIL";
    lines.push(
      `  ${status} ${result.caseId} (${result.totalDurationMs.toFixed(0)}ms)`
    );

    if (!result.passed && options.verbose) {
      for (const f of result.failures) {
        lines.push(`    - ${f}`);
      }
    }
  }

  lines.push("");

  // Failures
  if (report.failures.length > 0) {
    lines.push(
      "───────────────────────────────────────────────────────────────"
    );
    lines.push("Failure Details:");
    lines.push(
      "───────────────────────────────────────────────────────────────"
    );

    for (const failure of report.failures) {
      lines.push(`  ${failure.caseId}:`);
      for (const f of failure.failures) {
        lines.push(`    - ${f}`);
      }
    }
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");

  return lines.join("\n");
}

/**
 * Format report as JSON.
 */
export function formatJsonReport(report: ValidationReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Format report as Markdown.
 */
export function formatMarkdownReport(report: ValidationReport): string {
  const lines: string[] = [];

  lines.push("# S3 Validation Report");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total cases | ${report.total} |`);
  lines.push(`| Passed | ${report.passed} |`);
  lines.push(`| Failed | ${report.failed} |`);
  lines.push(`| Pass rate | ${(report.passRate * 100).toFixed(1)}% |`);
  lines.push(`| Total duration | ${report.totalDurationMs.toFixed(0)}ms |`);
  lines.push(`| Avg duration | ${report.avgDurationMs.toFixed(0)}ms |`);
  lines.push("");

  lines.push("## Results");
  lines.push("");
  lines.push("| Status | Case ID | Duration |");
  lines.push("|--------|---------|----------|");

  for (const result of report.results) {
    const status = result.passed ? "✅" : "❌";
    lines.push(
      `| ${status} | ${result.caseId} | ${result.totalDurationMs.toFixed(0)}ms |`
    );
  }

  lines.push("");

  if (report.failures.length > 0) {
    lines.push("## Failures");
    lines.push("");

    for (const failure of report.failures) {
      lines.push(`### ${failure.caseId}`);
      lines.push("");
      for (const f of failure.failures) {
        lines.push(`- ${f}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
