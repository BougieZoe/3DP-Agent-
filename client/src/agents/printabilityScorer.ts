import type { AgentOutput } from '@shared/domain/agent';
import { BaseAgent, type AgentContext } from './baseAgent';

interface ScoringBreakdown {
  wallThicknessScore: number;
  overhangScore: number;
  aspectRatioScore: number;
  volumeScore: number;
  featureDetailScore: number;
  wallThicknessWeight: number;
  overhangWeight: number;
  aspectRatioWeight: number;
  volumeWeight: number;
  featureDetailWeight: number;
  weightedTotal: number;
  category: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
}

export class PrintabilityScorer extends BaseAgent {
  private readonly WEIGHTS = {
    wallThickness: 0.35,
    overhang: 0.25,
    aspectRatio: 0.15,
    volume: 0.10,
    featureDetail: 0.15,
  };

  constructor() {
    super('printability_scorer', { supportsVision: false, requiresVision: false, timeoutMs: 10000 });
  }

  protected async analyze(ctx: AgentContext): Promise<AgentOutput> {
    const { unifiedAnalysis, modelSize, previousOutputs } = ctx;
    const metrics = unifiedAnalysis.metrics.result;
    const topology = unifiedAnalysis.topology.result;
    const triCount = topology?.triangleCount ?? 0;
    const oh = metrics?.overhang;
    const overhangFaces = oh?.faceCount ?? 0;
    const p5Thickness = metrics?.p5WallThicknessMm;
    const thinWallRatio = (metrics?.thinWallRatio ?? 0);
    const minThickness = p5Thickness ?? (Math.min(modelSize.x, modelSize.y, modelSize.z) * 0.5);
    const wtStatus = thinWallRatio > 0.15 ? 'critical' : thinWallRatio > 0.05 ? 'warning' : 'good';
    const ohStatus = overhangFaces > Math.max(1, triCount * 0.1) ? 'warning' : 'good';

    const gaOutput = previousOutputs.get('geometry_analyst');
    const gaDetails = gaOutput?.details as Record<string, unknown> | undefined;
    const gaAspectRatio = (gaDetails?.aspectRatio as number) ?? this.computeAspectRatio(modelSize);
    const gaFeatureDetail = (gaDetails?.featureDetail as string) ?? 'medium';

    const analysisInput = {
      wallThickness: { status: wtStatus },
      overhang: { status: ohStatus, areas: overhangFaces },
    };

    const breakdown = this.computeBreakdown(analysisInput, gaAspectRatio, gaFeatureDetail);

    const explanation = this.buildExplanation(breakdown, {
      wallThickness: { status: wtStatus, minThickness, thinWallRatio },
      overhang: { status: ohStatus, areas: overhangFaces },
    });

    const markers = [
      ...this.scoreToMarkers(breakdown.wallThicknessScore, 'thin_wall', 'Wall thickness score'),
      ...this.scoreToMarkers(breakdown.overhangScore, 'overhang', 'Overhang score'),
    ];

    const score = Math.round(breakdown.weightedTotal);

    return this.makeOutput(
      score,
      0.85,
      this.computeVerdict(score),
      explanation,
      breakdown as unknown as Record<string, unknown>,
      markers,
    );
  }

  review(ctx: AgentContext, otherOutputs: AgentOutput[]): { scoreAdjustment: number; notes: string } {
    let adjustment = 0;
    const notes: string[] = [];

    for (const output of otherOutputs) {
      if (output.agentId === 'failure_predictor') {
        const details = output.details as Record<string, unknown> | undefined;
        const riskCount = (details?.risks as unknown[])?.length ?? 0;
        if (riskCount > 3) {
          adjustment -= 10;
          notes.push('Failure predictor found significant risks — adjusted score down');
        }
      }
      if (output.agentId === 'geometry_analyst') {
        if (output.score < 40) {
          adjustment -= 5;
          notes.push('Geometry analyst flagged critical issues — adjusted score down');
        }
      }
    }

    return {
      scoreAdjustment: adjustment,
      notes: notes.join('; ') || 'No significant adjustments from peer review',
    };
  }

  private computeBreakdown(
    analysis: { wallThickness: { status: string }; overhang: { status: string; areas: number } },
    aspectRatio: number,
    featureDetail: string,
  ): ScoringBreakdown {
    const wallScores: Record<string, number> = { good: 100, warning: 50, critical: 10 };
    const wallThicknessScore = wallScores[analysis.wallThickness.status] ?? 50;

    const overhangScores: Record<string, number> = { good: 100, warning: 50, critical: 10 };
    const overhangScore = overhangScores[analysis.overhang.status] ?? 50;

    const aspectRatioScore = aspectRatio > 10 ? 30 : aspectRatio > 5 ? 60 : aspectRatio > 2 ? 85 : 100;

    const volumeScore = 80;

    const featureScores: Record<string, number> = { high: 100, medium: 70, low: 40 };
    const featureDetailScore = featureScores[featureDetail] ?? 70;

    const weightedTotal =
      wallThicknessScore * this.WEIGHTS.wallThickness +
      overhangScore * this.WEIGHTS.overhang +
      aspectRatioScore * this.WEIGHTS.aspectRatio +
      volumeScore * this.WEIGHTS.volume +
      featureDetailScore * this.WEIGHTS.featureDetail;

    const category: ScoringBreakdown['category'] =
      weightedTotal >= 80 ? 'excellent' :
      weightedTotal >= 60 ? 'good' :
      weightedTotal >= 40 ? 'fair' :
      weightedTotal >= 20 ? 'poor' :
      'critical';

    return {
      wallThicknessScore,
      overhangScore,
      aspectRatioScore,
      volumeScore,
      featureDetailScore,
      wallThicknessWeight: this.WEIGHTS.wallThickness,
      overhangWeight: this.WEIGHTS.overhang,
      aspectRatioWeight: this.WEIGHTS.aspectRatio,
      volumeWeight: this.WEIGHTS.volume,
      featureDetailWeight: this.WEIGHTS.featureDetail,
      weightedTotal,
      category,
    };
  }

  private buildExplanation(breakdown: ScoringBreakdown, analysis: { wallThickness: { status: string; minThickness: number; thinWallRatio?: number }; overhang: { status: string; areas: number } }): string {
    const lines = [
      `Printability Score: ${Math.round(breakdown.weightedTotal)}/100 (${breakdown.category.toUpperCase()})`,
      ``,
      `Breakdown:`,
      `  Wall Thickness (${(breakdown.wallThicknessWeight * 100).toFixed(0)}%): ${breakdown.wallThicknessScore}/100 — ${analysis.wallThickness.status}`,
      `  Overhang (${(breakdown.overhangWeight * 100).toFixed(0)}%): ${breakdown.overhangScore}/100 — ${analysis.overhang.status}`,
      `  Aspect Ratio (${(breakdown.aspectRatioWeight * 100).toFixed(0)}%): ${breakdown.aspectRatioScore}/100`,
      `  Volume (${(breakdown.volumeWeight * 100).toFixed(0)}%): ${breakdown.volumeScore}/100`,
      `  Feature Detail (${(breakdown.featureDetailWeight * 100).toFixed(0)}%): ${breakdown.featureDetailScore}/100`,
    ];

    if (breakdown.wallThicknessScore < 50) {
      const twr = analysis.wallThickness.thinWallRatio;
      if (twr != null && twr > 0) {
        lines.push(``, `\u26a0 Thin walls: ${(twr * 100).toFixed(1)}% of sampled regions below FDM threshold (p5=${analysis.wallThickness.minThickness.toFixed(2)}mm). Consider thickening.`);
      } else {
        lines.push(``, `\u26a0 Primary concern: wall thickness (${analysis.wallThickness.minThickness.toFixed(2)}mm). Consider thickening to 2mm+ for reliable printing.`);
      }
    }
    if (breakdown.overhangScore < 50) {
      lines.push(`\u26a0 Secondary concern: ${analysis.overhang.areas} overhang faces need support.`);
    }

    return lines.join('\n');
  }

  private scoreToMarkers(score: number, type: 'thin_wall' | 'overhang', prefix: string) {
    if (score >= 50) return [];
    return [{
      position: { x: 0, y: 0, z: 0 },
      type: type as 'thin_wall' | 'overhang',
      severity: 1 - score / 100,
      description: `${prefix}: ${Math.round(score)}/100`,
    }];
  }

  private computeAspectRatio(size: { x: number; y: number; z: number }): number {
    const dims = [size.x, size.y, size.z].filter(d => d > 0);
    if (dims.length === 0) return 1;
    return Math.max(...dims) / Math.max(0.001, Math.min(...dims));
  }
}
