import * as THREE from 'three';
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
    const { metrics, analysis } = ctx;
    const size = metrics.size;
    const triCount = metrics.triangleCount;
    const surfaceArea = metrics.surfaceArea;
    const volume = metrics.boundingBoxVolume;

    const aspectRatio = this.computeAspectRatio(size);
    const overhangRatio = analysis.overhang.areas / Math.max(1, triCount);
    const estimatedMinWall = analysis.wallThickness.minThickness;
    const featureDetail = this.computeFeatureDetail(triCount, volume);
    const isManifold = true;

    const markers: RiskMarker[] = [];

    if (analysis.overhang.status !== 'good') {
      markers.push(...this.collectOverhangMarkers(ctx));
    }
    if (analysis.wallThickness.status !== 'good') {
      markers.push(...this.collectWallThicknessMarkers(ctx));
    }

    const issues: string[] = [];
    if (analysis.wallThickness.status === 'critical') {
      issues.push('Critically thin walls detected — high failure risk');
    } else if (analysis.wallThickness.status === 'warning') {
      issues.push('Walls thinner than recommended — consider thickening');
    }
    if (analysis.overhang.status === 'warning' || analysis.overhang.status === 'critical') {
      issues.push(`${analysis.overhang.areas} faces exceed 45° overhang — support required`);
    }
    if (aspectRatio > 5) {
      issues.push('Extreme aspect ratio — model may be fragile');
    }
    if (triCount < 100) {
      issues.push('Very low triangle count — model may lack detail');
    }

    const score = this.computeScore(analysis, aspectRatio, triCount);
    const confidence = Math.min(1, triCount / 10000 + 0.3);

    const details: GeometryAnalystDetails = {
      triangleCount: triCount,
      surfaceAreaMm2: surfaceArea,
      boundingBoxVolumeMm3: volume,
      dimensions: { x: size.x, y: size.y, z: size.z },
      wallThickness: {
        minEstimated: estimatedMinWall,
        status: analysis.wallThickness.status,
      },
      overhang: {
        faceCount: analysis.overhang.areas,
        totalFaces: triCount,
        ratio: overhangRatio,
        status: analysis.overhang.status,
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

  private computeScore(analysis: { wallThickness: { status: string }; overhang: { status: string; areas: number } }, aspectRatio: number, triCount: number): number {
    let score = 100;

    if (analysis.wallThickness.status === 'critical') score -= 30;
    else if (analysis.wallThickness.status === 'warning') score -= 15;

    if (analysis.overhang.status === 'warning') score -= Math.min(20, analysis.overhang.areas * 2);
    else if (analysis.overhang.status === 'critical') score -= 30;

    if (aspectRatio > 10) score -= 15;
    else if (aspectRatio > 5) score -= 5;

    if (triCount < 50) score -= 10;
    else if (triCount < 200) score -= 5;

    return Math.max(0, score);
  }

  private computeAspectRatio(size: THREE.Vector3): number {
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
    const normals = ctx.metrics.normals;
    const positions = ctx.metrics.positions;
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
    const positions = ctx.metrics.positions;
    const step = 9;

    for (let i = 0; i < Math.min(positions.length, 300); i += step) {
      if (i + 2 < positions.length) {
        markers.push({
          position: { x: positions[i], y: positions[i + 1], z: positions[i + 2] },
          type: 'thin_wall',
          severity: ctx.analysis.wallThickness.status === 'critical' ? 0.9 : 0.5,
          description: `Thin wall area (est. ${ctx.analysis.wallThickness.minThickness.toFixed(2)}mm)`,
        });
        if (markers.length >= 15) break;
      }
    }
    return markers;
  }
}
