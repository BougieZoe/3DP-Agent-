import type { AgentOutput, OptimizedGeometrySuggestion, MaterialRecommendation, OptimizationAdvisorDetails } from '@shared/domain/agent';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import { BaseAgent, type AgentContext } from './baseAgent';
import { deriveOhStatus, deriveSupportStatus, deriveWtStatus } from '@/analysis/metrics';
import type { VendorCapacityAdapter } from '@/lib/vendorCapacity';

export class OptimizationAdvisor extends BaseAgent {
  constructor() {
    super('optimization_advisor', { supportsVision: true, requiresVision: false, timeoutMs: 20000 });
  }

  protected async analyze(ctx: AgentContext): Promise<AgentOutput<any>> {
    const { unifiedAnalysis, modelSize, previousOutputs, material } = ctx;
    const metrics = unifiedAnalysis.metrics.result;
    const topology = unifiedAnalysis.topology.result;
    const support = unifiedAnalysis.support?.result;
    const triCount = topology?.triangleCount ?? 0;
    const oh = metrics?.overhang;
    const overhangFaces = oh?.faceCount ?? 0;
    const overhangRatio = oh?.ratio ?? 0;
    const p5Thickness = metrics?.p5WallThicknessMm;
    const thinWallRatio = (metrics?.thinWallRatio ?? 0);
    const minThickness = p5Thickness ?? metrics?.minWallThicknessMm ?? null;
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
    const supportDecision = support ? deriveSupportStatus(support, ctx.language) : null;

    const geometryOutput = previousOutputs.get('geometry_analyst');
    const scorerOutput = previousOutputs.get('printability_scorer');
    const failureOutput = previousOutputs.get('failure_predictor');

    const suggestions = this.generateSuggestions(analysisInput, metricsInput, supportDecision, geometryOutput, scorerOutput, failureOutput, material.overhangThreshold, ctx.language);
    const recommendedMaterials = await this.recommendMaterials(analysisInput, metricsInput, ctx.language, ctx.vendorCapacityAdapter);
    const optimalOrientation = this.suggestOrientation(analysisInput, metricsInput, ctx.language);

    const score = Math.round(this.computeOptimizationScore(suggestions, recommendedMaterials.length));
    const confidence = 0.7;

    const details: OptimizationAdvisorDetails = {
      suggestions,
      recommendedMaterials,
      optimalOrientation,
      estimatedImprovement: this.estimateImprovement(suggestions),
    };

    const explanation = this.buildExplanation(suggestions, recommendedMaterials, optimalOrientation, score, ctx.language);

    return this.makeOutput(score, confidence, this.computeVerdict(score), explanation, details);
  }

  private generateSuggestions(
    analysis: { wallThickness: { status: string; minThickness: number | null; thinWallRatio?: number }; overhang: { status: string; areas: number } },
    metrics: { size: { x: number; y: number; z: number }; triangleCount: number },
    supportDecision?: { status: string; reasons: string[]; confidence: number } | null,
    geometryOutput?: AgentOutput,
    scorerOutput?: AgentOutput,
    failureOutput?: AgentOutput,
    overhangThreshold: number = 50,
    language: ContentLang = 'en',
  ): OptimizedGeometrySuggestion[] {
    const suggestions: OptimizedGeometrySuggestion[] = [];
    const twr = analysis.wallThickness.thinWallRatio ?? 0;
    const minLabel = analysis.wallThickness.minThickness != null
      ? analysis.wallThickness.minThickness.toFixed(2)
      : translate(CONTENT, 'notMeasured', language);

    if (analysis.wallThickness.status === 'critical') {
      suggestions.push({
        type: 'wall_thickening',
        priority: 'critical',
        description: translate(CONTENT, 'optimizationAdvisor.wallCriticalDesc', language, { pct: (twr * 100).toFixed(1), minLabel }),
        implementation: translate(CONTENT, 'optimizationAdvisor.wallCriticalImpl', language),
        expectedImprovement: translate(CONTENT, 'optimizationAdvisor.wallCriticalExp', language),
        difficulty: 'moderate',
      });
    } else if (analysis.wallThickness.status === 'warning') {
      suggestions.push({
        type: 'wall_thickening',
        priority: 'high',
        description: translate(CONTENT, 'optimizationAdvisor.wallWarningDesc', language, { pct: (twr * 100).toFixed(1), minLabel }),
        implementation: translate(CONTENT, 'optimizationAdvisor.wallWarningImpl', language),
        expectedImprovement: translate(CONTENT, 'optimizationAdvisor.wallWarningExp', language),
        difficulty: 'moderate',
      });
    }

    if (analysis.overhang.status !== 'good') {
      suggestions.push({
        type: 'orientation_change',
        priority: analysis.overhang.status === 'critical' ? 'high' : 'medium',
        description: translate(CONTENT, 'optimizationAdvisor.overhangDesc', language, { areas: analysis.overhang.areas, threshold: overhangThreshold }),
        implementation: translate(CONTENT, 'optimizationAdvisor.overhangImpl', language, { threshold: overhangThreshold }),
        expectedImprovement: translate(CONTENT, 'optimizationAdvisor.overhangExp', language),
        difficulty: 'easy',
      });

      suggestions.push({
        type: 'support_addition',
        priority: analysis.overhang.status === 'critical' ? 'critical' : 'high',
        description: translate(CONTENT, 'optimizationAdvisor.supportDesc', language, { areas: analysis.overhang.areas }),
        implementation: translate(CONTENT, 'optimizationAdvisor.supportImpl', language),
        expectedImprovement: translate(CONTENT, 'optimizationAdvisor.supportExp', language),
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
            implementation: translate(CONTENT, 'optimizationAdvisor.largeIslandImpl', language),
            expectedImprovement: translate(CONTENT, 'optimizationAdvisor.largeIslandExp', language),
            difficulty: 'moderate',
          });
        } else if (reason.includes('separate support islands')) {
          suggestions.push({
            type: 'support_addition',
            priority: 'medium',
            description: reason,
            implementation: translate(CONTENT, 'optimizationAdvisor.islandsImpl', language),
            expectedImprovement: translate(CONTENT, 'optimizationAdvisor.islandsExp', language),
            difficulty: 'moderate',
          });
        } else if (reason.includes('tall supports')) {
          suggestions.push({
            type: 'support_addition',
            priority: 'high',
            description: reason,
            implementation: translate(CONTENT, 'optimizationAdvisor.tallImpl', language),
            expectedImprovement: translate(CONTENT, 'optimizationAdvisor.tallExp', language),
            difficulty: 'moderate',
          });
        } else if (reason.includes('Directionally concentrated')) {
          suggestions.push({
            type: 'orientation_change',
            priority: 'medium',
            description: reason,
            implementation: translate(CONTENT, 'optimizationAdvisor.directionalImpl', language),
            expectedImprovement: translate(CONTENT, 'optimizationAdvisor.directionalExp', language),
            difficulty: 'easy',
          });
        } else if (reason.includes('Very difficult') || reason.includes('Difficult support') || reason.includes('Moderate support')) {
          suggestions.push({
            type: 'support_addition',
            priority: reason.includes('Very difficult') ? 'critical' : reason.includes('Difficult') ? 'high' : 'medium',
            description: reason,
            implementation: translate(CONTENT, 'optimizationAdvisor.difficultImpl', language),
            expectedImprovement: translate(CONTENT, 'optimizationAdvisor.difficultExp', language),
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
        description: translate(CONTENT, 'optimizationAdvisor.bridgeAspectDesc', language, { ratio: (maxDim / minDim).toFixed(1) }),
        implementation: translate(CONTENT, 'optimizationAdvisor.bridgeAspectImpl', language),
        expectedImprovement: translate(CONTENT, 'optimizationAdvisor.bridgeAspectExp', language),
        difficulty: 'moderate',
      });
    }

    if (metrics.triangleCount < 100) {
      suggestions.push({
        type: 'hole_fill',
        priority: 'medium',
        description: translate(CONTENT, 'optimizationAdvisor.lowPolyDesc', language, { tri: metrics.triangleCount }),
        implementation: translate(CONTENT, 'optimizationAdvisor.lowPolyImpl', language),
        expectedImprovement: translate(CONTENT, 'optimizationAdvisor.lowPolyExp', language),
        difficulty: 'easy',
      });
    }

    return suggestions;
  }

  private async recommendMaterials(
    analysis: { wallThickness: { status: string; minThickness: number | null } },
    metrics: { size: { x: number; y: number; z: number } },
    language: ContentLang = 'en',
    adapter?: VendorCapacityAdapter,
  ): Promise<MaterialRecommendation[]> {
    const volume = metrics.size.x * metrics.size.y * metrics.size.z;
    const maxDim = Math.max(metrics.size.x, metrics.size.y, metrics.size.z);
    const isLarge = volume > 500000;
    const isSmall = volume < 50000;
    const isThin = analysis.wallThickness.status !== 'good';

    const supportLabel = (key: 'minimal' | 'standard' | 'required' | 'asNeeded') =>
      translate(CONTENT, `optimizationAdvisor.matSupport.${key}`, language);

    let candidates: MaterialRecommendation[];

    if (isLarge) {
      candidates = [
        { material: 'PLA+', process: 'FDM', reason: translate(CONTENT, 'optimizationAdvisor.matReason.plaLarge', language), confidence: 0.9, layerHeight: '0.2mm', infill: '15-20%', supports: supportLabel('minimal') },
        { material: 'PETG', process: 'FDM', reason: translate(CONTENT, 'optimizationAdvisor.matReason.petgLarge', language), confidence: 0.7, layerHeight: '0.2mm', infill: '20-25%', supports: supportLabel('standard') },
      ];
    } else if (isSmall && isThin) {
      candidates = [
        { material: 'SLA Resin', process: 'SLA', reason: translate(CONTENT, 'optimizationAdvisor.matReason.slaSmall', language), confidence: 0.85, layerHeight: '0.05mm', infill: '100%', supports: supportLabel('required') },
        { material: 'PLA (0.4mm nozzle)', process: 'FDM', reason: translate(CONTENT, 'optimizationAdvisor.matReason.plaSmall', language), confidence: 0.6, layerHeight: '0.12mm', infill: '30%', supports: supportLabel('standard') },
      ];
    } else {
      candidates = [
        { material: 'PLA', process: 'FDM', reason: translate(CONTENT, 'optimizationAdvisor.matReason.plaGeneral', language), confidence: 0.85, layerHeight: '0.2mm', infill: '20%', supports: supportLabel('asNeeded') },
        { material: 'PETG', process: 'FDM', reason: translate(CONTENT, 'optimizationAdvisor.matReason.petgFunctional', language), confidence: 0.7, layerHeight: '0.2mm', infill: '25%', supports: supportLabel('standard') },
        { material: 'ABS/ASA', process: 'FDM (enclosed)', reason: translate(CONTENT, 'optimizationAdvisor.matReason.absOutdoor', language), confidence: 0.5, layerHeight: '0.2mm', infill: '30%', supports: supportLabel('standard') },
      ];
    }

    // Annotate with vendor capacity if adapter is available
    if (adapter) {
      for (const candidate of candidates) {
        try {
          const matStock = await adapter.getMaterialStock(candidate.material);
          if (matStock) {
            candidate.availability = {
              ...candidate.availability,
              materialStockKg: matStock.remainingKg,
              materialLastUpdated: matStock.lastUpdated,
            };
          }
        } catch {
          // Log and treat as "unknown availability" — don't crash the pipeline
          console.warn(`[optimizationAdvisor] Failed to query material stock for "${candidate.material}"`);
        }
      }
    }

    return candidates;
  }

  private suggestOrientation(
    analysis: { overhang: { status: string } },
    metrics: { size: { x: number; y: number; z: number } },
    language: ContentLang = 'en',
  ): string {
    if (analysis.overhang.status !== 'good') {
      return translate(CONTENT, 'optimizationAdvisor.orientationOverhang', language);
    }
    return translate(CONTENT, 'optimizationAdvisor.orientationOk', language);
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
    language: ContentLang = 'en',
  ): string {
    const lines = [
      translate(CONTENT, 'optimizationAdvisor.report', language, { score }),
      ``,
      translate(CONTENT, 'optimizationAdvisor.orientationLine', language, { orientation }),
      ``,
      translate(CONTENT, 'optimizationAdvisor.materialsHeader', language),
      ...materials.map(m => `  \u2022 ${m.material} (${m.process}): ${m.reason}`),
      ``,
    ];

    if (suggestions.length > 0) {
      lines.push(translate(CONTENT, 'optimizationAdvisor.improvementsHeader', language, { count: suggestions.length }));
      for (const s of suggestions) {
        lines.push(`  [${s.priority.toUpperCase()}] ${s.description}`);
        lines.push(`    \u2192 ${s.implementation}`);
        lines.push(`    ${translate(CONTENT, 'optimizationAdvisor.expectedLine', language, { expected: s.expectedImprovement })}`);
        lines.push('');
      }
    } else {
      lines.push(translate(CONTENT, 'optimizationAdvisor.noImprovements', language));
    }

    return lines.join('\n');
  }
}
