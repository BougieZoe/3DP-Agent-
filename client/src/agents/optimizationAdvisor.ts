import type { AgentOutput } from '@shared/domain/agent';
import { BaseAgent, type AgentContext } from './baseAgent';
import { deriveOhStatus, deriveSupportStatus, deriveWtStatus } from '@/analysis/metrics';

interface OptimizedGeometrySuggestion {
  type: 'wall_thickening' | 'orientation_change' | 'support_addition' | 'fillet_add' | 'hole_fill' | 'bridging_redesign';
  priority: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  implementation: string;
  expectedImprovement: string;
  difficulty: 'easy' | 'moderate' | 'hard';
}

interface MaterialRecommendation {
  material: string;
  process: string;
  reason: string;
  confidence: number;
  layerHeight: string;
  infill: string;
  supports: string;
}

interface OptimizationAdvisorDetails {
  suggestions: OptimizedGeometrySuggestion[];
  recommendedMaterials: MaterialRecommendation[];
  optimalOrientation: string;
  estimatedImprovement: number;
}

export class OptimizationAdvisor extends BaseAgent {
  constructor() {
    super('optimization_advisor', { supportsVision: true, requiresVision: false, timeoutMs: 20000 });
  }

  protected async analyze(ctx: AgentContext): Promise<AgentOutput> {
    const { unifiedAnalysis, modelSize, previousOutputs } = ctx;
    const metrics = unifiedAnalysis.metrics.result;
    const topology = unifiedAnalysis.topology.result;
    const support = unifiedAnalysis.support?.result;
    const triCount = topology?.triangleCount ?? 0;
    const oh = metrics?.overhang;
    const overhangFaces = oh?.faceCount ?? 0;
    const overhangRatio = oh?.ratio ?? 0;
    const p5Thickness = metrics?.p5WallThicknessMm;
    const thinWallRatio = (metrics?.thinWallRatio ?? 0);
    const minThickness = p5Thickness ?? (Math.min(modelSize.x, modelSize.y, modelSize.z) * 0.5);
    const wtStatus = deriveWtStatus(thinWallRatio, p5Thickness);
    const ohStatus = deriveOhStatus(overhangRatio);

    const analysisInput = {
      wallThickness: { status: wtStatus, minThickness, thinWallRatio },
      overhang: { status: ohStatus, areas: overhangFaces },
    };
    const metricsInput = {
      size: modelSize,
      triangleCount: triCount,
    };
    const supportDecision = support ? deriveSupportStatus(support) : null;

    const geometryOutput = previousOutputs.get('geometry_analyst');
    const scorerOutput = previousOutputs.get('printability_scorer');
    const failureOutput = previousOutputs.get('failure_predictor');

    const suggestions = this.generateSuggestions(analysisInput, metricsInput, supportDecision, geometryOutput, scorerOutput, failureOutput);
    const recommendedMaterials = this.recommendMaterials(analysisInput, metricsInput);
    const optimalOrientation = this.suggestOrientation(analysisInput, metricsInput);

    const score = Math.round(this.computeOptimizationScore(suggestions, recommendedMaterials.length));
    const confidence = 0.7;

    const details: OptimizationAdvisorDetails = {
      suggestions,
      recommendedMaterials,
      optimalOrientation,
      estimatedImprovement: this.estimateImprovement(suggestions),
    };

    const explanation = this.buildExplanation(suggestions, recommendedMaterials, optimalOrientation, score);

    return this.makeOutput(score, confidence, this.computeVerdict(score), explanation, details as unknown as Record<string, unknown>);
  }

  private generateSuggestions(
    analysis: { wallThickness: { status: string; minThickness: number; thinWallRatio?: number }; overhang: { status: string; areas: number } },
    metrics: { size: { x: number; y: number; z: number }; triangleCount: number },
    supportDecision?: { status: string; reasons: string[]; confidence: number } | null,
    geometryOutput?: AgentOutput,
    scorerOutput?: AgentOutput,
    failureOutput?: AgentOutput,
  ): OptimizedGeometrySuggestion[] {
    const suggestions: OptimizedGeometrySuggestion[] = [];
    const twr = analysis.wallThickness.thinWallRatio ?? 0;

    if (analysis.wallThickness.status === 'critical') {
      suggestions.push({
        type: 'wall_thickening',
        priority: 'critical',
        description: `Widespread thin walls — ${(twr * 100).toFixed(1)}% of sampled regions below FDM threshold (p5=${analysis.wallThickness.minThickness.toFixed(2)}mm)`,
        implementation: 'Increase wall thickness to at least 2mm model-wide. Use 3-4 perimeters in slicer. Consider shell offset in CAD.',
        expectedImprovement: 'Reduces collapse risk by 60-80%',
        difficulty: 'moderate',
      });
    } else if (analysis.wallThickness.status === 'warning') {
      suggestions.push({
        type: 'wall_thickening',
        priority: 'high',
        description: `Some thin regions — ${(twr * 100).toFixed(1)}% of samples thin (p5=${analysis.wallThickness.minThickness.toFixed(2)}mm)`,
        implementation: 'Increase to 3 perimeters. If structural, thicken to 2.5mm+ in CAD.',
        expectedImprovement: 'Eliminates isolated thin spots',
        difficulty: 'moderate',
      });
    }

    if (analysis.overhang.status !== 'good') {
      suggestions.push({
        type: 'orientation_change',
        priority: analysis.overhang.status === 'critical' ? 'high' : 'medium',
        description: `${analysis.overhang.areas} overhang faces exceed 45°`,
        implementation: 'Rotate model so most overhangs face upward. Use 45° rule — overhangs under 45° print without support. For remaining overhangs, enable auto-tree supports in slicer.',
        expectedImprovement: 'Reduces support material by 40-60%',
        difficulty: 'easy',
      });

      suggestions.push({
        type: 'support_addition',
        priority: analysis.overhang.status === 'critical' ? 'critical' : 'high',
        description: `Support structures required for ${analysis.overhang.areas} overhang faces`,
        implementation: 'Enable tree/organic supports in slicer (PrusaSlicer organic, Orca tree). Set overhang threshold to 50°. Use support blocker where not needed.',
        expectedImprovement: 'Eliminates sagging on overhangs',
        difficulty: 'easy',
      });
    }

    // ── Support reasoning from deriveSupportStatus ──
    if (supportDecision) {
      for (const reason of supportDecision.reasons) {
        if (reason.startsWith('Large continuous support island')) {
          suggestions.push({
            type: 'support_addition',
            priority: supportDecision.status === 'critical' ? 'critical' : 'high',
            description: reason,
            implementation: 'Use organic/tree supports for easier breakaway. Consider splitting model at the overhang boundary.',
            expectedImprovement: 'Simplifies support removal and improves surface finish',
            difficulty: 'moderate',
          });
        } else if (reason.includes('separate support islands')) {
          suggestions.push({
            type: 'support_addition',
            priority: 'medium',
            description: reason,
            implementation: 'Consider consolidating overhangs into fewer continuous regions by adjusting orientation or adding bridging geometry.',
            expectedImprovement: 'Reduces support interface area and post-processing time',
            difficulty: 'moderate',
          });
        } else if (reason.includes('tall supports')) {
          suggestions.push({
            type: 'support_addition',
            priority: 'high',
            description: reason,
            implementation: 'Consider reorienting model to reduce Z-height of supports. Use support blockers where possible.',
            expectedImprovement: 'Reduces tall support wobble and post-processing time',
            difficulty: 'moderate',
          });
        } else if (reason.includes('Directionally concentrated')) {
          suggestions.push({
            type: 'orientation_change',
            priority: 'medium',
            description: reason,
            implementation: 'Test rotations that spread overhang faces across multiple axes. 15-30° tilt can significantly reduce peak overhang severity.',
            expectedImprovement: 'More uniform support distribution, lower peak support height',
            difficulty: 'easy',
          });
        } else if (reason.includes('Very difficult') || reason.includes('Difficult support') || reason.includes('Moderate support')) {
          suggestions.push({
            type: 'support_addition',
            priority: reason.includes('Very difficult') ? 'critical' : reason.includes('Difficult') ? 'high' : 'medium',
            description: reason,
            implementation: 'Enable tree/organic supports in slicer (PrusaSlicer organic, Orca tree). Set overhang threshold to 50°. Use support blockers where not needed.',
            expectedImprovement: 'Reduces sagging and support failure risk',
            difficulty: 'easy',
          });
        }
      }
    }

    const maxDim = Math.max(metrics.size.x, metrics.size.y, metrics.size.z);
    const minDim = Math.min(metrics.size.x, metrics.size.y, metrics.size.z);
    if (maxDim / Math.max(0.001, minDim) > 8) {
      suggestions.push({
        type: 'bridging_redesign',
        priority: 'medium',
        description: `Extreme aspect ratio (${(maxDim / minDim).toFixed(1)}:1)`,
        implementation: 'Consider splitting model into parts and assembling post-print. Or print at 45° angle to reduce Z-height.',
        expectedImprovement: 'Eliminates tall-print failure modes',
        difficulty: 'moderate',
      });
    }

    if (metrics.triangleCount < 100) {
      suggestions.push({
        type: 'hole_fill',
        priority: 'medium',
        description: `Low polygon count (${metrics.triangleCount} triangles) — model may have holes or non-manifold edges`,
        implementation: 'Run mesh repair (Netfabb, PrusaSlicer repair, or Meshmixer). Simplify3D and Windows 3D Builder have free repair tools.',
        expectedImprovement: 'Ensures watertight model for reliable slicing',
        difficulty: 'easy',
      });
    }

    return suggestions;
  }

  private recommendMaterials(
    analysis: { wallThickness: { status: string; minThickness: number } },
    metrics: { size: { x: number; y: number; z: number } },
  ): MaterialRecommendation[] {
    const volume = metrics.size.x * metrics.size.y * metrics.size.z;
    const maxDim = Math.max(metrics.size.x, metrics.size.y, metrics.size.z);
    const isLarge = volume > 500000;
    const isSmall = volume < 50000;
    const isThin = analysis.wallThickness.status !== 'good';

    if (isLarge) {
      return [
        { material: 'PLA+', process: 'FDM', reason: 'Best for large parts — low cost, easy printing, good layer adhesion', confidence: 0.9, layerHeight: '0.2mm', infill: '15-20%', supports: 'Minimal' },
        { material: 'PETG', process: 'FDM', reason: 'Stronger than PLA, better layer adhesion, slightly harder to print', confidence: 0.7, layerHeight: '0.2mm', infill: '20-25%', supports: 'Standard' },
      ];
    }

    if (isSmall && isThin) {
      return [
        { material: 'SLA Resin', process: 'SLA', reason: 'Perfect for fine details and thin walls — much higher resolution than FDM', confidence: 0.85, layerHeight: '0.05mm', infill: '100%', supports: 'Required' },
        { material: 'PLA (0.4mm nozzle)', process: 'FDM', reason: 'If using FDM, use smallest nozzle (0.2mm) for thin walls', confidence: 0.6, layerHeight: '0.12mm', infill: '30%', supports: 'Standard' },
      ];
    }

    return [
      { material: 'PLA', process: 'FDM', reason: 'Versatile, easy to print, good strength for general parts', confidence: 0.85, layerHeight: '0.2mm', infill: '20%', supports: 'As needed' },
      { material: 'PETG', process: 'FDM', reason: 'Better for functional parts — stronger, more durable', confidence: 0.7, layerHeight: '0.2mm', infill: '25%', supports: 'Standard' },
      { material: 'ABS/ASA', process: 'FDM (enclosed)', reason: 'For outdoor/heat-resistant applications', confidence: 0.5, layerHeight: '0.2mm', infill: '30%', supports: 'Standard' },
    ];
  }

  private suggestOrientation(analysis: { overhang: { status: string } }, metrics: { size: { x: number; y: number; z: number } }): string {
    if (analysis.overhang.status !== 'good') {
      return 'Rotate model to minimize overhangs facing downward. Print flat faces parallel to build plate. Consider tilting 15-20° to reduce stair-stepping on curved surfaces.';
    }
    return 'Model can be printed in current orientation. For best surface finish, orient the most visible face upward.';
  }

  private computeOptimizationScore(suggestions: OptimizedGeometrySuggestion[], materialCount: number): number {
    const criticalCount = suggestions.filter(s => s.priority === 'critical').length;
    const highCount = suggestions.filter(s => s.priority === 'high').length;

    if (criticalCount === 0 && highCount === 0) return 90;
    if (criticalCount === 0) return 70;
    return Math.max(20, 70 - criticalCount * 20 - highCount * 5);
  }

  private estimateImprovement(suggestions: OptimizedGeometrySuggestion[]): number {
    if (suggestions.length === 0) return 0;
    const priorityValues: Record<string, number> = { critical: 30, high: 20, medium: 10, low: 5 };
    let total = 0;
    for (const s of suggestions) {
      total += priorityValues[s.priority] ?? 5;
    }
    return Math.min(95, total);
  }

  private buildExplanation(
    suggestions: OptimizedGeometrySuggestion[],
    materials: MaterialRecommendation[],
    orientation: string,
    score: number,
  ): string {
    const lines = [
      `Optimization Report (Score: ${score}/100)`,
      ``,
      `Orientation: ${orientation}`,
      ``,
      `Recommended Process & Materials:`,
      ...materials.map(m => `  \u2022 ${m.material} (${m.process}): ${m.reason}`),
      ``,
    ];

    if (suggestions.length > 0) {
      lines.push(`Suggested Improvements (${suggestions.length}):`);
      for (const s of suggestions) {
        lines.push(`  [${s.priority.toUpperCase()}] ${s.description}`);
        lines.push(`    \u2192 ${s.implementation}`);
        lines.push(`    \u2192 Expected: ${s.expectedImprovement}`);
        lines.push('');
      }
    } else {
      lines.push('No improvements needed — model is well-optimized for printing.');
    }

    return lines.join('\n');
  }
}
