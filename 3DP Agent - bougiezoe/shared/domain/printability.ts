// shared/domain/printability.ts

export type FindingSeverity = 'info' | 'warning' | 'error';
export type FindingCategory =
  | 'wall_thickness'
  | 'overhang'
  | 'size'
  | 'geometry'
  | 'support';

export interface PrintabilityFinding {
  readonly id: string;
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  readonly title: string;
  readonly description: string;
  readonly value?: number;
  readonly threshold?: number;
  readonly unit?: string;
}

export type PrintabilityScore = 'excellent' | 'good' | 'fair' | 'poor';

export interface PrintabilitySummary {
  readonly score: PrintabilityScore;
  readonly findings: ReadonlyArray<PrintabilityFinding>;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly printable: boolean;
}

export function scoreFromFindings(
  findings: PrintabilityFinding[]
): PrintabilityScore {
  const errors   = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  if (errors > 0)   return 'poor';
  if (warnings > 2) return 'fair';
  if (warnings > 0) return 'good';
  return 'excellent';
}