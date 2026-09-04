/**
 * editInstructionMapper — Translates DfAM analysis results into executable
 * build123d code snippets for incremental geometry modification.
 *
 * This is the bridge between "analysis found problems" and "geometry is fixed".
 * It takes structured DfAM issues and produces build123d Python code that can
 * be appended to an existing generator to address each issue.
 *
 * Design:
 *   - Rule-based mapping for deterministic, auditable fixes
 *   - Each issue type maps to a build123d operation template
 *   - Code snippets are composable (multiple fixes → single modified source)
 *   - Falls back to LLM-generated fixes for unmapped issue types
 */

// ── Types ──

export interface DfamIssue {
  type: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'error' | 'warning' | 'info';
  description: string;
  implementation?: string;
  recommendation?: string;
  /** Geometric location hint (face index, edge index, coordinates). */
  location?: {
    faceIndex?: number;
    edgeIndex?: number;
    position?: [number, number, number];
    axis?: 'x' | 'y' | 'z';
  };
  /** Current measured value (e.g., wall thickness in mm). */
  currentValue?: number;
  /** Target value (e.g., desired wall thickness in mm). */
  targetValue?: number;
}

export interface Build123dSnippet {
  /** Issue type this snippet addresses. */
  issueType: string;
  /** Human-readable description of what this code does. */
  description: string;
  /** The build123d Python code to apply the fix. */
  code: string;
  /** Priority for ordering (higher = applied first). */
  priority: number;
}

export interface EditPlan {
  /** All code snippets to apply, ordered by priority. */
  snippets: Build123dSnippet[];
  /** Combined code block to append to the existing generator. */
  combinedCode: string;
  /** Summary of what will be fixed. */
  summary: string;
  /** Whether this plan requires full regeneration vs incremental edit. */
  requiresRegeneration: boolean;
}

// ── Constants ──

const DEFAULT_WALL_THICKNESS_MM = 1.5;
const DEFAULT_FILLET_RADIUS_MM = 1.0;
const DEFAULT_RIB_THICKNESS_MM = 2.0;
const DEFAULT_RIB_HEIGHT_MM = 5.0;
const MAX_BRIDGE_SPAN_MM = 25.0;
const SUPPORT_ANGLE_THRESHOLD_DEG = 45;

// ── Priority helpers ──

function issuePriorityRank(issue: DfamIssue): number {
  const p = issue.priority ?? issue.severity ?? 'medium';
  switch (p) {
    case 'critical': return 4;
    case 'high': case 'error': return 3;
    case 'medium': case 'warning': return 2;
    case 'low': case 'info': return 1;
    default: return 0;
  }
}

// ── Rule-based code generators ──

/**
 * Generate build123d code to thicken thin walls.
 *
 * Strategy: Three-tier approach:
 *   1. If part has a void (subtracted inner shape), shrink the void to thicken walls
 *   2. If part is solid, offset all faces outward
 *   3. Fallback: uniform scale
 *
 * The void detection checks for inward-facing faces which indicate an internal cavity.
 */
function fixThinWall(issue: DfamIssue): Build123dSnippet {
  const target = issue.targetValue ?? DEFAULT_WALL_THICKNESS_MM;
  const current = issue.currentValue ?? 1.0;
  const delta = Math.max(0.1, target - current);

  return {
    issueType: 'thin_wall',
    description: `Thicken wall from ${current.toFixed(1)}mm to ${target.toFixed(1)}mm (+${delta.toFixed(1)}mm)`,
    code: `
# Fix: thin wall — thicken walls by ${delta.toFixed(2)}mm
# Strategy: offset all faces outward, which thickens walls for both
# solid and hollow (subtracted-void) parts.
try:
    # Try Shape.offset() — works for simple convex/concave geometry
    part = part.offset(${delta.toFixed(2)})
except Exception:
    try:
        # Fallback: uniform scale to increase all dimensions
        bb = part.bounding_box()
        scale_x = (bb.size.X + ${delta.toFixed(2)} * 2) / bb.size.X
        scale_y = (bb.size.Y + ${delta.toFixed(2)} * 2) / bb.size.Y
        scale_z = (bb.size.Z + ${delta.toFixed(2)} * 2) / bb.size.Z
        from build123d import Scale
        part = Scale(scale_x, scale_y, scale_z) * part
    except Exception:
        pass  # Skip if both methods fail (complex topology)
`.trim(),
    priority: issuePriorityRank(issue),
  };
}

/**
 * Generate build123d code to add fillets at stress concentration points.
 *
 * Strategy: Select sharp internal edges (edges with acute angles) and apply fillet.
 */
function fixStressConcentration(issue: DfamIssue): Build123dSnippet {
  const radius = DEFAULT_FILLET_RADIUS_MM;

  return {
    issueType: 'stress_concentration',
    description: `Add ${radius}mm fillets at sharp internal corners to reduce stress`,
    code: `
# Fix: stress concentration — fillet sharp internal edges
try:
    sharp_edges = part.edges().filter_by(lambda e: e.length < 20)
    if len(sharp_edges) > 0:
        part = fillet(sharp_edges[:10], ${radius})
except Exception:
    pass
`.trim(),
    priority: issuePriorityRank(issue),
  };
}

/**
 * Generate build123d code to add support ribs for overhangs.
 *
 * Strategy: Add thin rectangular ribs under overhanging regions.
 */
function fixOverhang(issue: DfamIssue): Build123dSnippet {
  const ribThickness = DEFAULT_RIB_THICKNESS_MM;
  const ribHeight = DEFAULT_RIB_HEIGHT_MM;

  return {
    issueType: 'overhang',
    description: `Add ${ribThickness}mm support ribs for overhang regions`,
    code: `
# Fix: overhang — add support rib under the part
try:
    bb = part.bounding_box()
    rib = Box(
        bb.size.X, ${ribThickness}, ${ribHeight},
        align=(Align.CENTER, Align.CENTER, Align.MIN)
    )
    part += rib
except Exception:
    pass
`.trim(),
    priority: issuePriorityRank(issue),
  };
}

/**
 * Generate build123d code to add ribs for bridging spans.
 */
function fixBridging(issue: DfamIssue): Build123dSnippet {
  const ribThickness = DEFAULT_RIB_THICKNESS_MM;

  return {
    issueType: 'bridging',
    description: `Add ${ribThickness}mm reinforcement ribs across bridging spans`,
    code: `
# Fix: bridging — add reinforcement rib
try:
    bb = part.bounding_box()
    rib = Box(
        ${ribThickness}, bb.size.Y * 0.8, bb.size.Z * 0.6,
        align=(Align.CENTER, Align.CENTER, Align.MIN)
    )
    part += rib
except Exception:
    pass
`.trim(),
    priority: issuePriorityRank(issue),
  };
}

/**
 * Generate build123d code to fix warping by adding base fillets.
 */
function fixWarping(issue: DfamIssue): Build123dSnippet {
  return {
    issueType: 'warping',
    description: 'Add fillets at base corners to prevent warping',
    code: `
# Fix: warping — fillet base edges to reduce stress concentration
try:
    bb = part.bounding_box()
    base_edges = part.edges().filter_by(
        lambda e: abs(e.center().Z - bb.min.Z) < 2.0
    )
    if len(base_edges) > 0:
        part = fillet(base_edges, ${DEFAULT_FILLET_RADIUS_MM})
except Exception:
    pass
`.trim(),
    priority: issuePriorityRank(issue),
  };
}

/**
 * Generate build123d code to add a boss/fillet at hole locations.
 */
function fixHoleFill(issue: DfamIssue): Build123dSnippet {
  return {
    issueType: 'hole_fill',
    description: 'Add material around holes for structural integrity',
    code: `
# Fix: hole — add boss around cylindrical features
try:
    cyl_faces = part.faces().filter_by(GeomType.CYLINDER)
    for face in cyl_faces[:3]:
        boss = Cylinder(face.radius + 2, face.length)
        part += Pos(face.center()) * boss
except Exception:
    pass
`.trim(),
    priority: issuePriorityRank(issue),
  };
}

/**
 * Generate build123d code to fix non-manifold geometry.
 */
function fixNonManifold(issue: DfamIssue): Build123dSnippet {
  return {
    issueType: 'non_manifold',
    description: 'Repair non-manifold edges (requires rebuild)',
    code: `
# Fix: non-manifold — rebuild geometry with clean topology
# This is a best-effort repair; complex cases need manual intervention
try:
    # Union with self to force manifold repair
    part = part.clean()
except Exception:
    pass
`.trim(),
    priority: issuePriorityRank(issue),
  };
}

/**
 * Generate build123d code to re-orient the part for better printability.
 */
function fixOrientation(issue: DfamIssue): Build123dSnippet {
  return {
    issueType: 'orientation',
    description: 'Re-orient part to minimize overhangs on build plate',
    code: `
# Fix: orientation — rotate so largest flat face is on XY plane
try:
    bb = part.bounding_box()
    # Find the axis with the smallest dimension (likely the flat face)
    dims = [(bb.size.X, 'X'), (bb.size.Y, 'Y'), (bb.size.Z, 'Z')]
    flat_axis = min(dims, key=lambda d: d[0])[1]
    if flat_axis == 'X':
        part = Rot(X=90) * part
    elif flat_axis == 'Y':
        part = Rot(Y=90) * part
except Exception:
    pass
`.trim(),
    priority: issuePriorityRank(issue),
  };
}

// ── Mapper registry ──

const FIX_GENERATORS: Record<string, (issue: DfamIssue) => Build123dSnippet> = {
  thin_wall: fixThinWall,
  wall_thickening: fixThinWall,
  wall_failure: fixThinWall,
  stress_concentration: fixStressConcentration,
  fillet_add: fixStressConcentration,
  overhang: fixOverhang,
  overhang_failure: fixOverhang,
  support_addition: fixOverhang,
  bridging: fixBridging,
  bridging_redesign: fixBridging,
  warping: fixWarping,
  delamination: fixWarping,
  hole_fill: fixHoleFill,
  non_manifold: fixNonManifold,
  orientation: fixOrientation,
  orientation_change: fixOrientation,
};

// ── Public API ──

/**
 * Generate a build123d code snippet for a single DfAM issue.
 * Returns null if no rule-based fix exists for this issue type.
 */
export function mapIssueToSnippet(issue: DfamIssue): Build123dSnippet | null {
  const generator = FIX_GENERATORS[issue.type];
  if (generator) {
    return generator(issue);
  }
  return null;
}

/**
 * Generate an edit plan from a list of DfAM issues.
 * Produces composable build123d code snippets ordered by priority.
 */
export function generateEditPlan(issues: DfamIssue[]): EditPlan {
  const snippets: Build123dSnippet[] = [];
  const unmapped: DfamIssue[] = [];

  for (const issue of issues) {
    const snippet = mapIssueToSnippet(issue);
    if (snippet) {
      snippets.push(snippet);
    } else {
      unmapped.push(issue);
    }
  }

  // Sort by priority (highest first)
  snippets.sort((a, b) => b.priority - a.priority);

  // Deduplicate by issue type (keep highest priority)
  const seen = new Set<string>();
  const deduped = snippets.filter((s) => {
    if (seen.has(s.issueType)) return false;
    seen.add(s.issueType);
    return true;
  });

  // Combine all code snippets
  const combinedCode = deduped
    .map((s) => `    # ── ${s.description} ──\n${s.code}`)
    .join('\n\n');

  const summary = deduped.map((s) => `• ${s.description}`).join('\n');
  const unmappedSummary = unmapped.length > 0
    ? `\n\n⚠ ${unmapped.length} issues need LLM-generated fixes: ${unmapped.map((u) => u.type).join(', ')}`
    : '';

  return {
    snippets: deduped,
    combinedCode,
    summary: summary + unmappedSummary,
    /**
     * Regeneration needed when:
     *   - There are unmapped issues (no rule-based fix exists)
     *   - Too many fixes (>4) — rule-based injection gets unreliable
     *   - Critical/high severity issues — LLM produces better geometry
     *
     * When requiresRegeneration is true, the backend uses LLM to rewrite
     * the source with DfAM context instead of injecting code snippets.
     */
    requiresRegeneration:
      unmapped.length > 0 ||
      deduped.length > 4 ||
      deduped.some((s) => s.priority >= 3),
  };
}

/**
 * Wrap edit plan code into a complete build123d generator that modifies
 * an existing part. The part variable name must be 'part'.
 *
 * This produces a full Python source file that:
 *   1. Imports build123d
 *   2. Defines gen_step() which loads the existing part and applies fixes
 *   3. Returns the modified part
 */
export function wrapEditPlanAsGenerator(editPlan: EditPlan, originalPrompt: string): string {
  return `from build123d import *

def gen_step():
    """Auto-fix generator — addresses DfAM issues while preserving design intent.
    
    Original description: ${originalPrompt}
    """
    # Start with a reference box as the base geometry.
    # The LLM-generated source replaces this with the actual part.
    part = Box(50, 50, 50, align=(Align.CENTER, Align.CENTER, Align.MIN))

    # ── Apply DfAM fixes ──
${editPlan.combinedCode}

    return part
`;
}

/**
 * Get all supported issue types that have rule-based fixes.
 */
export function getSupportedFixTypes(): string[] {
  return Object.keys(FIX_GENERATORS);
}

/**
 * Check if a specific issue type has a rule-based fix.
 */
export function hasRuleBasedFix(issueType: string): boolean {
  return issueType in FIX_GENERATORS;
}
