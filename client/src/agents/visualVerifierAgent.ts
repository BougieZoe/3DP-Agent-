import type { AgentOutput, RiskMarker } from '@shared/domain/agent';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import { BaseAgent, type AgentContext, type AgentCapabilities } from './baseAgent';

export interface VisualFinding {
  category: string;
  severity: 'ok' | 'warning' | 'critical';
  description: string;
  viewAngle?: string;
}

export interface VisualVerifierDetails {
  findings: VisualFinding[];
  viewsRendered: number;
  modelUsed: string;
  overallVerdict: string;
  summary: string;
}

const CAPABILITIES: AgentCapabilities = {
  supportsVision: true,
  requiresVision: false,
  timeoutMs: 30000,
};

export class VisualVerifierAgent extends BaseAgent {
  constructor() {
    super('visual_verifier', CAPABILITIES);
  }

  protected async analyze(ctx: AgentContext): Promise<AgentOutput<VisualVerifierDetails>> {
    const { language } = ctx;

    // Try server-side Blender multi-view verification first
    const blenderResult = await this.tryBlenderVerification(ctx);
    if (blenderResult) {
      return blenderResult;
    }

    // Fall back to client-side vision analysis (existing VisionProvider)
    const clientResult = await this.tryClientVisionAnalysis(ctx);
    if (clientResult) {
      return clientResult;
    }

    // No verification possible
    return this.makeOutput(
      50,
      0.1,
      'inconclusive',
      translate(CONTENT, 'visualVerifier.unavailable', language),
      { findings: [], viewsRendered: 0, modelUsed: 'none', overallVerdict: 'inconclusive', summary: '' },
      [],
    );
  }

  private async tryBlenderVerification(ctx: AgentContext): Promise<AgentOutput<VisualVerifierDetails> | null> {
    try {
      // Check if Blender is available
      const healthResp = await fetch('/api/blender/health', { method: 'GET' });
      const health = await healthResp.json() as { ok: boolean };
      if (!health.ok) return null;

      // Need STL bytes to upload
      if (!ctx.stlBytes) return null;

      // Upload STL to server
      const uploadResp = await fetch(`/api/blender/upload?fileName=${encodeURIComponent(ctx.fileName)}`, {
        method: 'POST',
        body: new Blob([ctx.stlBytes]),
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      const uploadData = await uploadResp.json() as { ok: boolean; filePath?: string; error?: string };
      if (!uploadData.ok || !uploadData.filePath) return null;

      // Run multi-angle visual verification
      const verifyResp = await fetch('/api/blender/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: uploadData.filePath,
          provider: 'mock', // Use mock for now; switch to 'glm' when ready
        }),
      });
      const verifyData = await verifyResp.json() as {
        ok: boolean;
        result?: {
          findings: Array<{ category: string; severity: string; description: string; viewAngle?: string }>;
          overallVerdict: string;
          viewsRendered: number;
          modelUsed: string;
          summary: string;
        };
      };
      if (!verifyData.ok || !verifyData.result) return null;

      const { result } = verifyData;
      const findings: VisualFinding[] = result.findings.map(f => ({
        category: f.category,
        severity: f.severity as 'ok' | 'warning' | 'critical',
        description: f.description,
        viewAngle: f.viewAngle,
      }));

      const score = this.computeScoreFromFindings(findings);
      const verdict = this.computeVerdict(score);

      return this.makeOutput(
        score,
        0.8,
        verdict,
        this.buildExplanation(findings, result.summary, ctx.language),
        {
          findings,
          viewsRendered: result.viewsRendered,
          modelUsed: result.modelUsed,
          overallVerdict: result.overallVerdict,
          summary: result.summary,
        },
        [],
      );
    } catch {
      return null;
    }
  }

  private async tryClientVisionAnalysis(ctx: AgentContext): Promise<AgentOutput<VisualVerifierDetails> | null> {
    // Use existing vision result if available from VisionProvider
    if (ctx.visionResult && ctx.visionResult.observedIssues.length > 0) {
      const findings: VisualFinding[] = ctx.visionResult.observedIssues.map(issue => ({
        category: issue.category,
        severity: this.mapSeverity(issue.category),
        description: issue.description,
        viewAngle: 'front',
      }));

      const score = this.computeScoreFromFindings(findings);
      const verdict = this.computeVerdict(score);

      return this.makeOutput(
        score,
        ctx.visionResult.confidence,
        verdict,
        this.buildExplanation(findings, ctx.visionResult.qualitativeAssessment, ctx.language),
        {
          findings,
          viewsRendered: 1,
          modelUsed: 'client-vision',
          overallVerdict: verdict,
          summary: ctx.visionResult.qualitativeAssessment,
        },
        [],
      );
    }

    return null;
  }

  private mapSeverity(category: string): 'ok' | 'warning' | 'critical' {
    const criticalCategories = ['structural_damage', 'hole_or_void'];
    const warningCategories = ['thin_wall', 'overhang', 'deformation', 'asymmetry', 'missing_feature'];
    if (criticalCategories.includes(category)) return 'critical';
    if (warningCategories.includes(category)) return 'warning';
    return 'ok';
  }

  private computeScoreFromFindings(findings: VisualFinding[]): number {
    if (findings.length === 0) return 85;

    let score = 85;
    for (const f of findings) {
      if (f.severity === 'critical') score -= 25;
      else if (f.severity === 'warning') score -= 10;
    }
    return Math.max(0, Math.min(100, score));
  }

  private buildExplanation(findings: VisualFinding[], assessment: string, language: ContentLang): string {
    const critical = findings.filter(f => f.severity === 'critical');
    const warnings = findings.filter(f => f.severity === 'warning');

    const parts: string[] = [];
    if (assessment) parts.push(assessment);

    if (critical.length > 0) {
      parts.push(translate(CONTENT, 'visualVerifier.criticalIssues', language, { count: critical.length }));
    }
    if (warnings.length > 0) {
      parts.push(translate(CONTENT, 'visualVerifier.warnings', language, { count: warnings.length }));
    }
    if (findings.length === 0) {
      parts.push(translate(CONTENT, 'visualVerifier.noIssues', language));
    }

    return parts.join('\n');
  }
}
