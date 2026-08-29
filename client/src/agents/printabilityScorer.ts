import type { AgentOutput, ScoringBreakdown } from '@shared/domain/agent';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import { BaseAgent, type AgentContext } from './baseAgent';
import { deriveOhStatus, deriveWtStatus } from '@/analysis/metrics';

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

  protected async analyze(ctx: AgentContext): Promise<AgentOutput<any>> {
    const { unifiedAnalysis, modelSize, previousOutputs } = ctx;
    const metrics = unifiedAnalysis.metrics.result;
    const topology = unifiedAnalysis.topology.result;
    const triCount = topology?.triangleCount ?? 0;
    const oh = metrics?.overhang;
    const overhangFaces = oh?.faceCount ?? 0;
    const overhangRatio = oh?.ratio ?? 0;
    const p5Thickness = metrics?.p5WallThicknessMm;
    const thinWallRatio = (metrics?.thinWallRatio ?? 0);
    const minThickness = p5Thickness ?? metrics?.minWallThicknessMm ?? null;
    const wtStatus = deriveWtStatus(thinWallRatio, p5Thickness);
    const ohStatus = deriveOhStatus(overhangRatio);

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
    }, ctx.language);

    const markers = [
      ...this.scoreToMarkers(breakdown.wallThicknessScore, 'thin_wall', 'printabilityScorer.marker.wallThickness', ctx.language),
      ...this.scoreToMarkers(breakdown.overhangScore, 'overhang', 'printabilityScorer.marker.overhang', ctx.language),
    ];

    const score = Math.round(breakdown.weightedTotal);

    return this.makeOutput(
      score,
      0.85,
      this.computeVerdict(score),
      explanation,
      breakdown,
      markers,
    );
  }

  review(ctx: AgentContext, otherOutputs: AgentOutput[]): { scoreAdjustment: number; notes: string } {
    let adjustment = 0;
    const notes: string[] = [];
    const lang = ctx.language;

    for (const output of otherOutputs) {
      if (output.agentId === 'failure_predictor') {
        const details = output.details as Record<string, unknown> | undefined;
        const riskCount = (details?.risks as unknown[])?.length ?? 0;
        if (riskCount > 3) {
          adjustment -= 10;
          notes.push(translate(CONTENT, 'printabilityScorer.review.failureRisks', lang));
        }
      }
      if (output.agentId === 'geometry_analyst') {
        if (output.score < 40) {
          adjustment -= 5;
          notes.push(translate(CONTENT, 'printabilityScorer.review.geometryCritical', lang));
        }
      }
    }

    return {
      scoreAdjustment: adjustment,
      notes: notes.join('; ') || translate(CONTENT, 'printabilityScorer.review.noAdjustments', lang),
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

  private buildExplanation(
    breakdown: ScoringBreakdown,
    analysis: { wallThickness: { status: string; minThickness: number | null; thinWallRatio?: number }; overhang: { status: string; areas: number } },
    language: ContentLang = 'en',
  ): string {
    const lines = [
      translate(CONTENT, 'printabilityScorer.score', language, { score: Math.round(breakdown.weightedTotal), category: breakdown.category.toUpperCase() }),
      ``,
      translate(CONTENT, 'printabilityScorer.breakdown', language),
      translate(CONTENT, 'printabilityScorer.wallThicknessLine', language, {
        weight: (breakdown.wallThicknessWeight * 100).toFixed(0),
        score: breakdown.wallThicknessScore,
        status: analysis.wallThickness.status,
      }),
      translate(CONTENT, 'printabilityScorer.overhangLine', language, {
        weight: (breakdown.overhangWeight * 100).toFixed(0),
        score: breakdown.overhangScore,
        status: analysis.overhang.status,
      }),
      translate(CONTENT, 'printabilityScorer.aspectRatioLine', language, {
        weight: (breakdown.aspectRatioWeight * 100).toFixed(0),
        score: breakdown.aspectRatioScore,
      }),
      translate(CONTENT, 'printabilityScorer.volumeLine', language, {
        weight: (breakdown.volumeWeight * 100).toFixed(0),
        score: breakdown.volumeScore,
      }),
      translate(CONTENT, 'printabilityScorer.featureDetailLine', language, {
        weight: (breakdown.featureDetailWeight * 100).toFixed(0),
        score: breakdown.featureDetailScore,
      }),
    ];

    if (breakdown.wallThicknessScore < 50) {
      const twr = analysis.wallThickness.thinWallRatio;
      const minLabel = analysis.wallThickness.minThickness != null
        ? analysis.wallThickness.minThickness.toFixed(2)
        : translate(CONTENT, 'notMeasured', language);
      if (twr != null && twr > 0) {
        lines.push(``, translate(CONTENT, 'printabilityScorer.thinWalls', language, { pct: (twr * 100).toFixed(1), minLabel }));
      } else {
        lines.push(``, translate(CONTENT, 'printabilityScorer.primaryConcern', language, { minLabel }));
      }
    }
    if (breakdown.overhangScore < 50) {
      lines.push(translate(CONTENT, 'printabilityScorer.secondaryConcern', language, { areas: analysis.overhang.areas }));
    }

    return lines.join('\n');
  }

  private scoreToMarkers(score: number, type: 'thin_wall' | 'overhang', key: string, language: ContentLang) {
    if (score >= 50) return [];
    return [{
      position: { x: 0, y: 0, z: 0 },
      type: type as 'thin_wall' | 'overhang',
      severity: 1 - score / 100,
      description: translate(CONTENT, key, language, { score: Math.round(score) }),
    }];
  }

  private computeAspectRatio(size: { x: number; y: number; z: number }): number {
    const dims = [size.x, size.y, size.z].filter(d => d > 0);
    if (dims.length === 0) return 1;
    return Math.max(...dims) / Math.max(0.001, Math.min(...dims));
  }
}
