import type { AgentOutput, AgentVerdict, RiskMarker } from '@shared/domain/agent';
import { BaseAgent, type AgentContext } from './baseAgent';
import { deriveOhStatus, deriveSupportStatus, deriveWtStatus } from '@/analysis/metrics';

interface PredictedRisk {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  description: string;
  affectedFaces: number;
  recommendation: string;
}

interface FailurePredictorDetails {
  risks: PredictedRisk[];
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskCount: number;
  criticalRiskCount: number;
  predictedFailureRate: number;
}

export class FailurePredictor extends BaseAgent {
  private _overallRiskLevel: string = 'low';

  constructor() {
    super('failure_predictor', { supportsVision: true, requiresVision: false, timeoutMs: 15000 });
  }

  public override computeVerdict(score: number): AgentVerdict {
    if (this._overallRiskLevel === 'critical') return 'fail';
    if (this._overallRiskLevel === 'high') return 'warning';
    return super.computeVerdict(score);
  }

  protected async analyze(ctx: AgentContext): Promise<AgentOutput> {
    const { unifiedAnalysis, modelSize, vertexPositions, vertexNormals, material } = ctx;
    const metrics = unifiedAnalysis.metrics.result;
    const topology = unifiedAnalysis.topology.result;
    const support = unifiedAnalysis.support?.result;
    const triCount = topology?.triangleCount ?? 0;
    const oh = metrics?.overhang;
    const overhangFaces = oh?.faceCount ?? 0;
    const overhangRatio = oh?.ratio ?? 0;
    const p5Thickness = metrics?.p5WallThicknessMm;
    const thinWallRatio = (metrics?.thinWallRatio ?? 0);
    const avgConfidence = (metrics?.averageConfidence ?? 0);
    const minThickness = p5Thickness ?? (Math.min(modelSize.x, modelSize.y, modelSize.z) * 0.5);
    const wtStatus = deriveWtStatus(thinWallRatio, p5Thickness);
    const thinWallRatioRaw = thinWallRatio;
    const ohStatus = deriveOhStatus(overhangRatio);

    const analysisInput = {
      wallThickness: { status: wtStatus, minThickness, thinWallRatio, confidence: avgConfidence, p5Thickness },
      overhang: { status: ohStatus, areas: overhangFaces, ratio: overhangRatio },
    };
    const metricsInput = {
      triangleCount: triCount,
      size: modelSize,
    };

    const risks: PredictedRisk[] = [];
    const markers: RiskMarker[] = [];

    const overhangRisk = this.predictOverhangFailure(analysisInput, metricsInput, material.overhangThreshold);
    if (overhangRisk) {
      risks.push(overhangRisk);
      markers.push(...this.generateOverhangMarkers(ctx, overhangRisk.severity, material.overhangThreshold));
    }

    const wallRisk = this.predictWallFailure(analysisInput);
    if (wallRisk) {
      risks.push(wallRisk);
      markers.push(...this.generateWallMarkers(ctx, wallRisk.severity));
    }

    const warpingRisk = this.predictWarping(analysisInput, metricsInput);
    if (warpingRisk) risks.push(warpingRisk);

    const bridgingRisk = this.predictBridgingIssues(analysisInput);
    if (bridgingRisk) risks.push(bridgingRisk);

    const delaminationRisk = this.predictDelamination(analysisInput, metricsInput);
    if (delaminationRisk) risks.push(delaminationRisk);

    const supportDecision = support ? deriveSupportStatus(support) : null;
    if (supportDecision) {
      risks.push(...this.deriveSupportRisks(supportDecision));
    }

    const overallRiskLevel = this.computeOverallRisk(risks);
    this._overallRiskLevel = overallRiskLevel;
    const score = this.computeScore(risks);
    const confidence = 0.75;

    const details: FailurePredictorDetails = {
      risks,
      overallRiskLevel,
      riskCount: risks.length,
      criticalRiskCount: risks.filter(r => r.severity === 'high' || r.severity === 'critical').length,
      predictedFailureRate: this.computeFailureRate(risks),
    };

    const explanation = this.buildExplanation(risks, overallRiskLevel);

    return this.makeOutput(score, confidence, this.computeVerdict(score), explanation, details as unknown as Record<string, unknown>, markers);
  }

  private predictOverhangFailure(
    analysis: { overhang: { status: string; areas: number } },
    _metrics: { triangleCount: number },
    threshold: number,
  ): PredictedRisk | null {
    if (analysis.overhang.status === 'good') return null;

    const severity: PredictedRisk['severity'] =
      analysis.overhang.status === 'critical' ? 'critical' : 'high';

    return {
      type: 'overhang_failure',
      severity,
      confidence: 0.8,
      description: `${analysis.overhang.areas} faces exceed ${threshold}° overhang angle — supports required to prevent sagging`,
      affectedFaces: analysis.overhang.areas,
      recommendation: severity === 'critical' || severity === 'high'
        ? `Add supports in slicer or redesign overhangs to be <${threshold}°`
        : 'Standard supports recommended in slicer',
    };
  }

  private predictWallFailure(analysis: { wallThickness: { status: string; minThickness: number; thinWallRatio?: number; confidence?: number; p5Thickness?: number | null } }): PredictedRisk | null {
    if (analysis.wallThickness.status === 'good') return null;

    const twr = analysis.wallThickness.thinWallRatio ?? 0;
    const p5 = analysis.wallThickness.p5Thickness ?? analysis.wallThickness.minThickness;
    const confidence = analysis.wallThickness.confidence ?? 0.7;
    const status = analysis.wallThickness.status;

    let severity: PredictedRisk['severity'];
    let description: string;
    let recommendation: string;

    if (status === 'critical') {
      severity = 'critical';
      description = `${(twr * 100).toFixed(1)}% of sampled walls below FDM threshold — widespread thin wall failure risk`;
      recommendation = 'Increase wall thickness model-wide to at least 2mm. Use 3+ perimeters in slicer.';
    } else {
      severity = 'high';
      description = `Thin walls detected (p5=${p5.toFixed(2)}mm, ${(twr * 100).toFixed(1)}% of samples) — moderate failure risk`;
      recommendation = 'Thin areas detected. Increase wall thickness or use 3 perimeters.';
    }

    const riskConfidence = confidence > 0 ? Math.min(0.85, confidence + 0.1) : 0.7;

    return {
      type: 'wall_failure',
      severity,
      confidence: riskConfidence,
      description,
      affectedFaces: 0,
      recommendation,
    };
  }

  private predictWarping(analysis: { wallThickness: { status: string } }, metrics: { size: { x: number; y: number; z: number } }): PredictedRisk | null {
    const maxDim = Math.max(metrics.size.x, metrics.size.y, metrics.size.z);
    if (maxDim < 100) return null;

    const severity: PredictedRisk['severity'] = maxDim > 300 ? 'high' : maxDim > 200 ? 'medium' : 'low';
    const isThin = analysis.wallThickness.status !== 'good';

    return {
      type: 'warping',
      severity,
      confidence: isThin ? 0.7 : 0.5,
      description: `Large flat area (${maxDim.toFixed(0)}mm) — risk of corner warping during cooling`,
      affectedFaces: 0,
      recommendation: 'Add brim/raft in slicer, use enclosure, consider mouse ears on corners',
    };
  }

  private predictBridgingIssues(analysis: { overhang: { areas: number; status: string; ratio: number } }): PredictedRisk | null {
    if (analysis.overhang.status === 'good') return null;

    const severity: PredictedRisk['severity'] =
      analysis.overhang.status === 'critical' ? 'high' :
      analysis.overhang.status === 'warning' ? 'medium' : 'low';

    return {
      type: 'bridging',
      severity,
      confidence: 0.6,
      description: `Large overhang area with ${analysis.overhang.areas} affected faces — bridging may cause sagging`,
      affectedFaces: analysis.overhang.areas,
      recommendation: 'Enable bridging calibration in slicer, increase part cooling fan speed',
    };
  }

  private deriveSupportRisks(decision: { status: string; reasons: string[]; confidence: number }): PredictedRisk[] {
    const risks: PredictedRisk[] = [];
    const conf = decision.confidence;

    for (const reason of decision.reasons) {
      if (reason.includes('removal risk') || reason.includes('tall supports')) {
        risks.push({
          type: 'support_removal',
          severity: decision.status === 'critical' ? 'high' : 'medium',
          confidence: conf * 0.9,
          description: reason,
          affectedFaces: 0,
          recommendation: 'Use tree/organic supports for easier breakaway. Consider splitting model or adjusting orientation.',
        });
      } else if (reason.includes('Large continuous') || reason.includes('Very difficult')) {
        risks.push({
          type: 'support_collapse',
          severity: 'high',
          confidence: conf * 0.9,
          description: reason,
          affectedFaces: 0,
          recommendation: 'Add support interface brims in slicer. Consider splitting large overhang regions with support blockers.',
        });
      } else if (reason.includes('Difficult support') || reason.includes('Moderate support')) {
        risks.push({
          type: 'support_collapse',
          severity: decision.status === 'critical' ? 'high' : 'medium',
          confidence: conf * 0.85,
          description: reason,
          affectedFaces: 0,
          recommendation: 'Ensure adequate support density and interface layers in slicer. Consider tree supports.',
        });
      }
    }

    return risks;
  }

  private predictDelamination(analysis: { wallThickness: { status: string } }, metrics: { size: { z: number } }): PredictedRisk | null {
    if (metrics.size.z < 50) return null;

    const severity: PredictedRisk['severity'] =
      metrics.size.z > 200 ? 'medium' :
      metrics.size.z > 100 ? 'low' : 'low';

    return {
      type: 'delamination',
      severity,
      confidence: 0.5,
      description: `Tall model (${metrics.size.z.toFixed(0)}mm) — risk of layer delamination, especially with thin walls`,
      affectedFaces: 0,
      recommendation: 'Increase nozzle temperature by 5-10°C, reduce layer height, enable Z-hop',
    };
  }

  private computeOverallRisk(risks: PredictedRisk[]): 'low' | 'medium' | 'high' | 'critical' {
    if (risks.some(r => r.severity === 'critical')) return 'critical';
    if (risks.some(r => r.severity === 'high')) return 'high';
    if (risks.some(r => r.severity === 'medium')) return 'medium';
    return 'low';
  }

  private computeScore(risks: PredictedRisk[]): number {
    if (risks.length === 0) return 100;
    const severityPenalties: Record<string, number> = { critical: 30, high: 20, medium: 10, low: 3 };
    let penalty = 0;
    for (const risk of risks) {
      penalty += severityPenalties[risk.severity] ?? 5;
    }
    return Math.max(0, 100 - penalty);
  }

  private computeFailureRate(risks: PredictedRisk[]): number {
    if (risks.length === 0) return 0;
    const severityRates: Record<string, number> = { critical: 0.8, high: 0.5, medium: 0.25, low: 0.1 };
    let rate = 0;
    for (const risk of risks) {
      rate = Math.max(rate, severityRates[risk.severity] ?? 0);
    }
    return Math.min(1, rate + risks.length * 0.05);
  }

  private generateOverhangMarkers(ctx: AgentContext, severity: string, threshold: number): RiskMarker[] {
    if (severity === 'low') return [];
    const markers: RiskMarker[] = [];
    const positions = ctx.vertexPositions;
    const normals = ctx.vertexNormals;
    let count = 0;

    for (let i = 0; i < Math.min(normals.length, 600); i += 3) {
      const ny = normals[i + 1];
      const angle = Math.acos(Math.max(-1, Math.min(1, ny))) * (180 / Math.PI);
      if (angle > threshold && i + 2 < positions.length) {
        markers.push({
          position: { x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] },
          type: 'support_needed',
          severity: severity === 'critical' ? 0.9 : severity === 'high' ? 0.7 : 0.5,
          description: `Steep overhang (${angle.toFixed(1)}°) — support recommended`,
        });
        count++;
        if (count >= 25) break;
      }
    }
    return markers;
  }

  private generateWallMarkers(ctx: AgentContext, severity: string): RiskMarker[] {
    if (severity === 'low') return [];
    const markers: RiskMarker[] = [];
    const positions = ctx.vertexPositions;
    const count = Math.min(10, Math.floor(positions.length / 30));
    const p5Thickness = ctx.unifiedAnalysis.metrics.result?.p5WallThicknessMm;
    const avgThickness = ctx.unifiedAnalysis.metrics.result?.avgWallThicknessMm;
    const displayThickness = p5Thickness ?? avgThickness ?? ctx.unifiedAnalysis.metrics.result?.minWallThicknessMm ?? 1;

    for (let i = 0; i < count; i++) {
      const idx = i * 30;
      if (idx + 2 < positions.length) {
        markers.push({
          position: { x: positions[idx], y: positions[idx + 1], z: positions[idx + 2] },
          type: 'thin_wall',
          severity: severity === 'critical' ? 0.9 : 0.6,
          description: `Thin wall — p5 thickness ${displayThickness.toFixed(2)}mm`,
        });
      }
    }
    return markers;
  }

  private buildExplanation(risks: PredictedRisk[], overallRiskLevel: string): string {
    if (risks.length === 0) {
      return 'No significant failure risks predicted. Model appears structurally sound for printing.';
    }

    const lines = [
      `Failure Risk Assessment: ${overallRiskLevel.toUpperCase()}`,
      `${risks.length} risk(s) identified`,
      ``,
    ];

    for (const risk of risks) {
      lines.push(`[${risk.severity.toUpperCase()}] ${risk.type}: ${risk.description}`);
      lines.push(`  \u2192 ${risk.recommendation}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}
