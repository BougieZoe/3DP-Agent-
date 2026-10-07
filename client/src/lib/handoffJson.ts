/**
 * handoff.json — one machine-readable artifact for the whole handoff:
 * params + geometry + materials + constraints + verdict + audit + next step.
 * Optimizers, solvers, factory systems and the Notion MCP can all read it.
 */
import type { UnifiedAnalysis } from '../analysis/types';
import { isVolumeReportable } from './volumeDisplay';
import { buildAuditTrail } from './auditTrail';

export interface HandoffJson {
  schema: 'handoff/1';
  fileName: string;
  exportedAt: string;
  params: { process: string; material: string; layerHeightMm: number; infill: number };
  geometry: {
    sizeMm: [number, number, number] | null;
    volumeCm3: number | null;
    watertight: boolean | null;
    triangles: number | null;
  };
  estimates: { weightG: number | null; timeMin: number | null; blocked: boolean };
  verdict: { score: number; light: string };
  audit: ReturnType<typeof buildAuditTrail>;
  cheapestStep: 'repair' | 'scale' | 'support' | 'none';
}

export function buildHandoffJson(
  analysis: UnifiedAnalysis,
  fileName: string,
  opts: { process: string; material: string; layerHeightMm?: number; infill?: number },
): HandoffJson {
  const metrics = analysis.metrics?.result;
  const dims = metrics?.boundingBoxDimensionsMm;
  const pt = analysis.printTime?.result;
  const v = analysis.validation?.result;
  const audit = buildAuditTrail(analysis);

  const blocked =
    !metrics || !isVolumeReportable(metrics) ||
    pt?.materialWeightGrams == null || pt.materialWeightGrams <= 0;
  const twr = metrics?.thinWallRatio ?? 0;
  const cheapestStep =
    audit.light === 'green' ? 'none'
    : v && !v.isWatertight ? 'repair'
    : twr >= 0.2 ? 'scale' : 'support';

  return {
    schema: 'handoff/1',
    fileName,
    exportedAt: new Date().toISOString(),
    params: {
      process: opts.process, material: opts.material,
      layerHeightMm: opts.layerHeightMm ?? 0.2, infill: opts.infill ?? 20,
    },
    geometry: {
      sizeMm: dims ? [dims.x, dims.y, dims.z] : null,
      volumeCm3: metrics && isVolumeReportable(metrics) ? metrics.meshVolumeMm3 / 1000 : null,
      watertight: v ? v.isWatertight : null,
      triangles: analysis.topology?.result.triangleCount ?? null,
    },
    estimates: {
      weightG: pt?.materialWeightGrams != null && pt.materialWeightGrams > 0 ? pt.materialWeightGrams : null,
      timeMin: pt?.estimatedPrintTimeMinutes != null && pt.estimatedPrintTimeMinutes > 0 ? pt.estimatedPrintTimeMinutes : null,
      blocked,
    },
    verdict: { score: audit.score, light: audit.light },
    audit,
    cheapestStep,
  };
}

export function downloadHandoffJson(analysis: UnifiedAnalysis, fileName: string, opts: { process: string; material: string }): void {
  const blob = new Blob([JSON.stringify(buildHandoffJson(analysis, fileName, opts), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.replace(/\.(stl|obj|3mf)$/i, '') + '.handoff.json';
  a.click();
  URL.revokeObjectURL(url);
}
