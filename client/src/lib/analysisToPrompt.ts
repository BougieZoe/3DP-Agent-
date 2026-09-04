/**
 * analysisToPrompt — Translates DfAM analysis results into structured
 * edit instructions that the CAD LLM can act on. Bridges the gap between
 * the analysis pipeline and CAD generation.
 */

export interface DfamIssue {
  type: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'error' | 'warning' | 'info';
  description: string;
  implementation?: string;
  recommendation?: string;
}

interface FixInstruction {
  category: string;
  action: string;
  detail: string;
}

/**
 * Map from DfAM issue types to concrete fix instructions for build123d.
 */
const FIX_ACTION_MAP: Record<string, (issue: DfamIssue) => FixInstruction> = {
  wall_thickening: (issue) => ({
    category: 'wall_thickness',
    action: 'Increase wall thickness to at least 1.5mm',
    detail: issue.implementation ?? 'Thicken all thin walls by adding material offset',
  }),
  thin_wall: (issue) => ({
    category: 'wall_thickness',
    action: 'Increase wall thickness to at least 1.5mm',
    detail: issue.recommendation ?? issue.description,
  }),
  wall_failure: (issue) => ({
    category: 'wall_thickness',
    action: 'Increase wall thickness to at least 1.5mm',
    detail: issue.recommendation ?? issue.description,
  }),
  orientation_change: (issue) => ({
    category: 'orientation',
    action: 'Re-orient the model to minimize overhangs',
    detail: issue.implementation ?? 'Rotate model so flat face is on the build plate',
  }),
  overhang: (issue) => ({
    category: 'overhang',
    action: 'Reduce overhangs below 45 degrees or add support geometry',
    detail: issue.recommendation ?? issue.description,
  }),
  overhang_failure: (issue) => ({
    category: 'overhang',
    action: 'Reduce overhangs below 45 degrees or add support geometry',
    detail: issue.recommendation ?? issue.description,
  }),
  support_addition: (issue) => ({
    category: 'support',
    action: 'Add built-in support structures for overhang regions',
    detail: issue.implementation ?? 'Add sacrificial support pillars under overhangs',
  }),
  support_removal: (issue) => ({
    category: 'support',
    action: 'Redesign to minimize support requirements',
    detail: issue.recommendation ?? issue.description,
  }),
  bridging_redesign: (issue) => ({
    category: 'bridging',
    action: 'Add ribs or increase thickness for long bridges',
    detail: issue.implementation ?? 'Add reinforcement ribs across bridging spans',
  }),
  fillet_add: (issue) => ({
    category: 'fillet',
    action: 'Add fillets to reduce stress concentration',
    detail: issue.implementation ?? 'Add small radius fillets at sharp internal corners',
  }),
  hole_fill: (issue) => ({
    category: 'hole_fill',
    action: 'Fill unnecessary holes or add proper bearing surfaces',
    detail: issue.implementation ?? 'Close open holes that weaken the structure',
  }),
  warping: (issue) => ({
    category: 'warping',
    action: 'Add fillets at base corners and increase brim to prevent warping',
    detail: issue.recommendation ?? issue.description,
  }),
  delamination: (issue) => ({
    category: 'delamination',
    action: 'Increase wall thickness and add rounded transitions',
    detail: issue.recommendation ?? issue.description,
  }),
};

/**
 * Translate a list of DfAM issues into a structured edit instruction
 * suitable for the CAD LLM's baseModel.editInstruction field.
 */
export function issuesToEditInstruction(issues: DfamIssue[]): string {
  if (issues.length === 0) return '';

  const instructions: FixInstruction[] = [];
  for (const issue of issues) {
    const mapper = FIX_ACTION_MAP[issue.type];
    if (mapper) {
      instructions.push(mapper(issue));
    } else {
      // Fallback: use raw description
      instructions.push({
        category: issue.type,
        action: issue.recommendation ?? issue.description,
        detail: issue.description,
      });
    }
  }

  // Deduplicate by category (keep highest priority)
  const seen = new Map<string, FixInstruction>();
  for (const inst of instructions) {
    if (!seen.has(inst.category)) {
      seen.set(inst.category, inst);
    }
  }

  const lines = Array.from(seen.values()).map(
    (inst) => `- ${inst.action}: ${inst.detail}`,
  );

  return [
    'Fix the following DfAM issues in the design:',
    ...lines,
    '',
    'Important: Preserve the original design intent. Only modify geometry to address these issues.',
    'Do not change the overall shape, size, or function of the part.',
  ].join('\n');
}

/**
 * Compose a full regeneration prompt that includes both the original design
 * intent and the DfAM issues to address. Used when the fix is too complex
 * for incremental editing and a full regeneration is needed.
 */
export function issuesToFullPrompt(
  originalPrompt: string,
  issues: DfamIssue[],
): string {
  const editInstruction = issuesToEditInstruction(issues);
  if (!editInstruction) return originalPrompt;

  return [
    originalPrompt,
    '',
    'CRITICAL MANUFACTURING REQUIREMENTS (must address):',
    editInstruction,
  ].join('\n');
}

/**
 * Determine severity priority for sorting (higher = more urgent).
 */
function severityRank(s: string | undefined): number {
  switch (s) {
    case 'critical': return 4;
    case 'high': case 'error': return 3;
    case 'medium': case 'warning': return 2;
    case 'low': case 'info': return 1;
    default: return 0;
  }
}

/**
 * Sort issues by severity (most critical first) and return the top N.
 * Used to avoid overwhelming the LLM with too many fix instructions.
 */
export function prioritizeIssues(issues: DfamIssue[], maxCount: number = 5): DfamIssue[] {
  return [...issues]
    .sort((a, b) => severityRank(b.priority ?? b.severity) - severityRank(a.priority ?? a.severity))
    .slice(0, maxCount);
}
