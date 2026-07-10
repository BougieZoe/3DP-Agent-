import type { AgentOutput, RiskMarker } from '@shared/domain/agent';
import { BaseAgent, type AgentContext } from './baseAgent';

interface GeometryAnalystDetails {
  triangleCount: number;
  surfaceAreaMm2: number;
  boundingBoxVolumeMm3: number;
  dimensions: { x: number; y: number; z: number };
  wallThickness: {
    minEstimated: number;
    status: string;
  };
  overhang: {
    faceCount: number;
    totalFaces: number;
    ratio: number;
    status: string;
  };
  aspectRatio: number;
  featureDetail: 'high' | 'medium' | 'low';
  isManifold: boolean;
}

export class GeometryAnalyst extends BaseAgent {
  constructor() {
    super('geometry_analyst', { supportsVision: true, requiresVision: false, timeoutMs: 15000 });
  }

  protected async analyze(ctx: AgentContext): Promise<AgentOutput> {
    const { unifiedAnalysis, vertexPositions, modelSize } = ctx;
    const metrics = unifiedAnalysis.metrics.result;
    const validation = unifiedAnalysis.validation.result;
    const topology = unifiedAnalysis.topology.result;
    const triCount = topology?.triangleCount ?? 0;
    const surfaceArea = metrics?.surfaceAreaMm2 ?? 0;
    const volume = metrics?.meshVolumeMm3 ?? metrics?.boundingBoxVolumeMm3 ?? 0;

    const aspectRatio = this.computeAspectRatio(modelSize);
    const overhangFaces = metrics?.overhang.faceCount ?? 0;
    const overhangRatio = metrics?.overhang.ratio ?? 0;
    const overhangStatus = metrics?.overhang.severity ?? 'none';
    const p5Thickness = metrics?.p5WallThicknessMm;
    const thinWallRatio = (metrics?.thinWallRatio ?? 0);
    const avgConfidence = (metrics?.averageConfidence ?? 0);
    const estimatedMinWall = p5Thickness ?? (Math.min(modelSize.x, modelSize.y, modelSize.z) * 0.5);
    const featureDetail = this.computeFeatureDetail(triCount, volume);

    const wtStatus = thinWallRatio > 0.15 ? 'critical' : thinWallRatio > 0.05 ? 'warning' : 'good';
    const hasOverhangIssue = overhangFaces > 0;
    const isManifold = topology?.isManifold ?? true;

    const markers: RiskMarker[] = [];

    if (hasOverhangIssue) {
      markers.push(...this.collectOverhangMarkers(ctx));
    }
    if (wtStatus !== 'good') {
      markers.push(...this.collectWallThicknessMarkers(ctx));
    }

    const issues: string[] = [];
    if (wtStatus === 'critical') {
      const pct = (thinWallRatio * 100).toFixed(1);
      issues.push(`Widespread thin walls detected — ${pct}% of sampled regions below FDM threshold`);
    } else if (wtStatus === 'warning') {
      issues.push('Some walls thinner than recommended — consider thickening');
    }
    if (hasOverhangIssue) {
      issues.push(`${overhangFaces} faces exceed 45° overhang — support required`);
    }
    if (aspectRatio > 5) {
      issues.push('Extreme aspect ratio — model may be fragile');
    }
    if (triCount < 100) {
      issues.push('Very low triangle count — model may lack detail');
    }

    const score = this.computeScore(wtStatus, hasOverhangIssue ? 'warning' : 'good', overhangFaces, aspectRatio, triCount);
    const confidence = Math.min(1, triCount / 10000 + 0.3);

    const details: GeometryAnalystDetails = {
      triangleCount: triCount,
      surfaceAreaMm2: surfaceArea,
      boundingBoxVolumeMm3: volume,
      dimensions: { x: modelSize.x, y: modelSize.y, z: modelSize.z },
      wallThickness: {
        minEstimated: estimatedMinWall,
        status: wtStatus,
      },
      overhang: {
        faceCount: overhangFaces,
        totalFaces: triCount,
        ratio: overhangRatio,
        status: overhangStatus,
      },
      aspectRatio,
      featureDetail,
      isManifold,
    };

    const explanation = issues.length > 0
      ? `Geometry analysis found ${issues.length} area(s) of concern:\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}`
      : 'Geometry analysis passed — no significant issues detected';

    return this.makeOutput(score, confidence, this.computeVerdict(score), explanation, details as unknown as Record<string, unknown>, markers);
  }

  private computeScore(wtStatus: string, ohStatus: string, overhangFaces: number, aspectRatio: number, triCount: number): number {
    let score = 100;

    if (wtStatus === 'critical') score -= 30;
    else if (wtStatus === 'warning') score -= 15;

    if (ohStatus === 'warning') score -= Math.min(20, overhangFaces * 2);
    else if (ohStatus === 'critical') score -= 30;

    if (aspectRatio > 10) score -= 15;
    else if (aspectRatio > 5) score -= 5;

    if (triCount < 50) score -= 10;
    else if (triCount < 200) score -= 5;

    return Math.max(0, score);
  }

  private computeAspectRatio(size: { x: number; y: number; z: number }): number {
    const dims = [size.x, size.y, size.z].filter(d => d > 0);
    if (dims.length === 0) return 1;
    const max = Math.max(...dims);
    const min = Math.min(...dims);
    return max / Math.max(0.001, min);
  }

  private computeFeatureDetail(triCount: number, volume: number): 'high' | 'medium' | 'low' {
    const density = volume > 0 ? triCount / volume : 0;
    if (density > 0.01) return 'high';
    if (density > 0.001) return 'medium';
    return 'low';
  }

  private collectOverhangMarkers(ctx: AgentContext): RiskMarker[] {
    const markers: RiskMarker[] = [];
    const normals = ctx.vertexNormals;
    const positions = ctx.vertexPositions;
    const step = 9;

    for (let i = 0; i < Math.min(normals.length, 300); i += 3) {
      const ny = normals[i + 1];
      const angle = Math.acos(Math.max(-1, Math.min(1, ny))) * (180 / Math.PI);
      if (angle > 45 && i * 3 + 2 < positions.length) {
        const idx = Math.min(Math.floor(i / 3) * step, positions.length - 3);
        markers.push({
          position: { x: positions[idx], y: positions[idx + 1], z: positions[idx + 2] },
          type: 'overhang',
          severity: Math.min(1, (angle - 45) / 45),
          description: `Overhang face at ${angle.toFixed(1)}°`,
        });
        if (markers.length >= 20) break;
      }
    }
    return markers;
  }

  private collectWallThicknessMarkers(ctx: AgentContext): RiskMarker[] {
    const markers: RiskMarker[] = [];
    const positions = ctx.vertexPositions;
    const step = 9;
    const p5Thickness = ctx.unifiedAnalysis.metrics.result?.p5WallThicknessMm;
    const minThickness = p5Thickness ?? ctx.unifiedAnalysis.metrics.result?.minWallThicknessMm ?? 1;

    for (let i = 0; i < Math.min(positions.length, 300); i += step) {
      if (i + 2 < positions.length) {
        const wtStatus = p5Thickness != null && p5Thickness < 1 ? 'critical' : 'warning';
        markers.push({
          position: { x: positions[i], y: positions[i + 1], z: positions[i + 2] },
          type: 'thin_wall',
          severity: wtStatus === 'critical' ? 0.9 : 0.5,
          description: `Thin wall area (est. ${minThickness.toFixed(2)}mm)`,
        });
        if (markers.length >= 15) break;
      }
    }
    return markers;
  }
}
