import type { AgentOutput, RiskMarker } from '@shared/domain/agent';
import { BaseAgent, type AgentContext } from './baseAgent';

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
  constructor() {
    super('failure_predictor', { supportsVision: true, requiresVision: false, timeoutMs: 15000 });
  }

  protected async analyze(ctx: AgentContext): Promise<AgentOutput> {
    const { unifiedAnalysis, modelSize, vertexPositions, vertexNormals } = ctx;
    const metrics = unifiedAnalysis.metrics.result;
    const topology = unifiedAnalysis.topology.result;
    const triCount = topology?.triangleCount ?? 0;
    const oh = metrics?.overhang;
    const overhangFaces = oh?.faceCount ?? 0;
    const minThickness = metrics?.minWallThicknessMm ?? (Math.min(modelSize.x, modelSize.y, modelSize.z) * 0.5);
    const wtStatus = minThickness < 1 ? 'critical' : minThickness < 2 ? 'warning' : 'good';
    const ohStatus = overhangFaces > Math.max(1, triCount * 0.1) ? 'warning' : 'good';

    const analysisInput = {
      wallThickness: { status: wtStatus, minThickness },
      overhang: { status: ohStatus, areas: overhangFaces },
    };
    const metricsInput = {
      triangleCount: triCount,
      size: modelSize,
    };

    const risks: PredictedRisk[] = [];
    const markers: RiskMarker[] = [];

    const overhangRisk = this.predictOverhangFailure(analysisInput, metricsInput);
    if (overhangRisk) {
      risks.push(overhangRisk);
      markers.push(...this.generateOverhangMarkers(ctx, overhangRisk.severity));
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

    const overallRiskLevel = this.computeOverallRisk(risks);
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

  private predictOverhangFailure(analysis: { overhang: { status: string; areas: number } }, metrics: { triangleCount: number }): PredictedRisk | null {
    if (analysis.overhang.status === 'good') return null;

    const ratio = metrics.triangleCount > 0 ? analysis.overhang.areas / metrics.triangleCount : 0;
    const severity: PredictedRisk['severity'] =
      ratio > 0.3 ? 'critical' :
      ratio > 0.15 ? 'high' :
      ratio > 0.05 ? 'medium' : 'low';

    return {
      type: 'overhang_failure',
      severity,
      confidence: 0.8,
      description: `${analysis.overhang.areas} faces exceed 45° overhang angle — supports required to prevent sagging`,
      affectedFaces: analysis.overhang.areas,
      recommendation: severity === 'critical' || severity === 'high'
        ? 'Add supports in slicer or redesign overhangs to be <45°'
        : 'Standard supports recommended in slicer',
    };
  }

  private predictWallFailure(analysis: { wallThickness: { status: string; minThickness: number } }): PredictedRisk | null {
    if (analysis.wallThickness.status === 'good') return null;

    const mt = analysis.wallThickness.minThickness;
    const severity: PredictedRisk['severity'] =
      mt < 0.5 ? 'critical' :
      mt < 1 ? 'high' :
      mt < 2 ? 'medium' : 'low';

    return {
      type: 'wall_failure',
      severity,
      confidence: 0.85,
      description: `Estimated min wall thickness ${mt.toFixed(2)}mm — risk of collapse or gaps during printing`,
      affectedFaces: 0,
      recommendation: severity === 'critical' || severity === 'high'
        ? 'Increase wall thickness to at least 2mm. Consider 3+ perimeters in slicer.'
        : 'Use 3 perimeters and consider thickening if structural integrity is needed',
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

  private predictBridgingIssues(analysis: { overhang: { areas: number; status: string } }): PredictedRisk | null {
    if (analysis.overhang.areas < 50) return null;

    const severity: PredictedRisk['severity'] =
      analysis.overhang.areas > 200 ? 'high' :
      analysis.overhang.areas > 100 ? 'medium' : 'low';

    return {
      type: 'bridging',
      severity,
      confidence: 0.6,
      description: `Large overhang area with ${analysis.overhang.areas} affected faces — bridging may cause sagging`,
      affectedFaces: analysis.overhang.areas,
      recommendation: 'Enable bridging calibration in slicer, increase part cooling fan speed',
    };
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

  private generateOverhangMarkers(ctx: AgentContext, severity: string): RiskMarker[] {
    if (severity === 'low') return [];
    const markers: RiskMarker[] = [];
    const positions = ctx.vertexPositions;
    const normals = ctx.vertexNormals;
    let count = 0;

    for (let i = 0; i < Math.min(normals.length, 600); i += 3) {
      const ny = normals[i + 1];
      const angle = Math.acos(Math.max(-1, Math.min(1, ny))) * (180 / Math.PI);
      if (angle > 50 && i + 2 < positions.length) {
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
    const minThickness = ctx.unifiedAnalysis.metrics.result?.minWallThicknessMm ?? 1;

    for (let i = 0; i < count; i++) {
      const idx = i * 30;
      if (idx + 2 < positions.length) {
        markers.push({
          position: { x: positions[idx], y: positions[idx + 1], z: positions[idx + 2] },
          type: 'thin_wall',
          severity: severity === 'critical' ? 0.9 : 0.6,
          description: `Thin wall — estimated ${minThickness.toFixed(2)}mm`,
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
