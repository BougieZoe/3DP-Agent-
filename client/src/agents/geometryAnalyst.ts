import type { AgentOutput, RiskMarker } from '@shared/domain/agent';
import { CONTENT, translate } from '@shared/i18n/content';
import { BaseAgent, type AgentContext } from './baseAgent';
import { deriveOhStatus, deriveWtStatus } from '@/analysis/metrics';

interface GeometryAnalystDetails {
  triangleCount: number;
  surfaceAreaMm2: number;
  boundingBoxVolumeMm3: number;
  dimensions: { x: number; y: number; z: number };
  wallThickness: {
    minEstimated: number | null;
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

  protected async analyze(ctx: AgentContext): Promise<AgentOutput<any>> {
    const { unifiedAnalysis, vertexPositions, modelSize, material } = ctx;
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
    // Never fabricate a wall thickness from the bounding box: if the raycast
    // produced no measurement, surface the honest null (confidence 0).
    const estimatedMinWall = p5Thickness ?? metrics?.minWallThicknessMm ?? null;
    const featureDetail = this.computeFeatureDetail(triCount, volume);

    const wtStatus = deriveWtStatus(thinWallRatio, p5Thickness);
    const ohStatus = deriveOhStatus(overhangRatio);
    const hasOverhangIssue = ohStatus !== 'good';
    const isManifold = topology?.isManifold ?? true;

    const markers: RiskMarker[] = [];

    if (hasOverhangIssue) {
      markers.push(...this.collectOverhangMarkers(ctx));
    }
    if (wtStatus !== 'good') {
      markers.push(...this.collectWallThicknessMarkers(ctx));
    }

    const lang = ctx.language;
    const issues: string[] = [];
    if (wtStatus === 'critical') {
      const pct = (thinWallRatio * 100).toFixed(1);
      issues.push(translate(CONTENT, 'geometryAnalyst.widespreadThinWalls', lang, { pct }));
    } else if (wtStatus === 'warning') {
      issues.push(translate(CONTENT, 'geometryAnalyst.someThinWalls', lang));
    }
    if (hasOverhangIssue) {
      issues.push(translate(CONTENT, 'geometryAnalyst.overhangSupport', lang, {
        faces: overhangFaces,
        threshold: material.overhangThreshold,
      }));
    }
    if (aspectRatio > 5) {
      issues.push(translate(CONTENT, 'geometryAnalyst.extremeAspectRatio', lang));
    }
    if (triCount < 100) {
      issues.push(translate(CONTENT, 'geometryAnalyst.lowTriangles', lang));
    }

    // Vision layer: the LLM looks at the actual rendering and may spot things
    // the raycasts cannot (visible asymmetry, surface artifacts, orientation
    // problems). Only issues that do NOT duplicate the deterministic checks
    // above are surfaced, prefixed so users know the source.
    const vision = ctx.visionResult;
    let visionScorePenalty = 0;
    if (vision && vision.confidence > 0.3 && vision.observedIssues.length > 0) {
      for (const issue of vision.observedIssues) {
        const duplicatesRule = issue.category === 'thin_wall' || issue.category === 'overhang';
        if (!duplicatesRule) {
          issues.push(`[Vision] ${issue.description}`);
          visionScorePenalty += 3;
        }
      }
    }

    const score = Math.max(0, this.computeScore(wtStatus, ohStatus, overhangRatio, aspectRatio, triCount) - visionScorePenalty);
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

    let explanation = issues.length > 0
      ? `${translate(CONTENT, 'geometryAnalyst.concernsFound', lang, { count: issues.length })}\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}`
      : translate(CONTENT, 'geometryAnalyst.passed', lang);

    if (vision && vision.confidence > 0.3 && vision.qualitativeAssessment) {
      explanation += `\n\n[Vision] ${vision.qualitativeAssessment}`;
    }

    return this.makeOutput(score, confidence, this.computeVerdict(score), explanation, details, markers);
  }

  private computeScore(wtStatus: string, ohStatus: string, overhangRatio: number, aspectRatio: number, triCount: number): number {
    let score = 100;

    if (wtStatus === 'critical') score -= 30;
    else if (wtStatus === 'warning') score -= 15;

    if (ohStatus === 'warning') score -= Math.min(20, overhangRatio * 100);
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
    const threshold = ctx.material.overhangThreshold;

    for (let i = 0; i < Math.min(normals.length, 300); i += 3) {
      const ny = normals[i + 1];
      const angle = Math.acos(Math.max(-1, Math.min(1, ny))) * (180 / Math.PI);
      if (angle > threshold && i * 3 + 2 < positions.length) {
        const idx = Math.min(Math.floor(i / 3) * step, positions.length - 3);
        markers.push({
          position: { x: positions[idx], y: positions[idx + 1], z: positions[idx + 2] },
          type: 'overhang',
          severity: Math.min(1, (angle - threshold) / (90 - threshold) * 2),
          description: translate(CONTENT, 'geometryAnalyst.markerOverhang', ctx.language, { angle: angle.toFixed(1) }),
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
    const twr = ctx.unifiedAnalysis.metrics.result?.thinWallRatio ?? 0;
    const markerWtStatus = deriveWtStatus(twr, p5Thickness);

    for (let i = 0; i < Math.min(positions.length, 300); i += step) {
      if (i + 2 < positions.length) {
        markers.push({
          position: { x: positions[i], y: positions[i + 1], z: positions[i + 2] },
          type: 'thin_wall',
          severity: markerWtStatus === 'critical' ? 0.9 : 0.5,
          description: translate(CONTENT, 'geometryAnalyst.markerThinWall', ctx.language, { t: minThickness.toFixed(2) }),
        });
        if (markers.length >= 15) break;
      }
    }
    return markers;
  }
}
