import type { UnifiedAnalysis } from '@/analysis';
import type { PromptMeta, SemanticCheckResult } from './types';

export function parsePromptMeta(prompt: string): PromptMeta {
  const dims: { x?: number; y?: number; z?: number } = {};
  const lower = prompt.toLowerCase();

  const boxMatch = lower.match(/(\d+)\s*x\s*(\d+)\s*x\s*(\d+)\s*mm/);
  if (boxMatch) {
    dims.x = parseInt(boxMatch[1]);
    dims.y = parseInt(boxMatch[2]);
    dims.z = parseInt(boxMatch[3]);
    return { prompt, targetDimensions: dims };
  }

  const flatMatch = lower.match(/(\d+)\s*x\s*(\d+)\s*mm/);
  if (flatMatch) {
    dims.x = parseInt(flatMatch[1]);
    dims.y = parseInt(flatMatch[2]);
  }

  for (const [re, axis] of [
    [/(\d+)\s*mm\s+(?:wide|width)\b/, 'x'],
    [/(?:\bwide|width)\s+(\d+)\s*mm\b/, 'x'],
    [/(\d+)\s*mm\s+(?:deep|depth)\b/, 'y'],
    [/(?:\bdeep|depth)\s+(\d+)\s*mm\b/, 'y'],
    [/(\d+)\s*mm\s+(?:tall|high|height)\b/, 'z'],
    [/(?:\btall|high|height)\s+(\d+)\s*mm\b/, 'z'],
    [/(\d+)\s*mm\s+(?:long|length)\b/, 'x'],
    [/(?:\blong|length)\s+(\d+)\s*mm\b/, 'x'],
  ] as [RegExp, string][]) {
    const match = lower.match(re);
    if (match) {
      const val = parseInt(match[1]);
      if (axis === 'x' && dims.x == null) dims.x = val;
      if (axis === 'y' && dims.y == null) dims.y = val;
      if (axis === 'z' && dims.z == null) dims.z = val;
    }
  }

  return { prompt, targetDimensions: Object.keys(dims).length > 0 ? dims : undefined };
}

export function runSemanticChecks(meta: PromptMeta, analysis: UnifiedAnalysis): SemanticCheckResult[] {
  const checks: SemanticCheckResult[] = [];
  const bb = analysis.metrics?.result?.boundingBoxDimensionsMm;
  if (!meta.targetDimensions || !bb) return checks;

  if (meta.targetDimensions.x != null) {
    const ratio = bb.x / meta.targetDimensions.x;
    if (ratio > 1.5) checks.push({ check: 'width', passed: false, detail: `Width ${bb.x.toFixed(0)}mm exceeds requested ${meta.targetDimensions.x}mm by ${((ratio - 1) * 100).toFixed(0)}%`, severity: 'warning' });
    else if (ratio < 0.5) checks.push({ check: 'width', passed: false, detail: `Width ${bb.x.toFixed(0)}mm is ${((1 - ratio) * 100).toFixed(0)}% smaller than requested ${meta.targetDimensions.x}mm`, severity: 'error' });
    else checks.push({ check: 'width', passed: true, detail: `Width ${bb.x.toFixed(0)}mm matches requested ${meta.targetDimensions.x}mm`, severity: 'info' });
  }
  if (meta.targetDimensions.y != null) {
    const ratio = bb.y / meta.targetDimensions.y;
    if (ratio > 1.5) checks.push({ check: 'depth', passed: false, detail: `Depth ${bb.y.toFixed(0)}mm exceeds requested ${meta.targetDimensions.y}mm by ${((ratio - 1) * 100).toFixed(0)}%`, severity: 'warning' });
    else if (ratio < 0.5) checks.push({ check: 'depth', passed: false, detail: `Depth ${bb.y.toFixed(0)}mm is ${((1 - ratio) * 100).toFixed(0)}% smaller than requested ${meta.targetDimensions.y}mm`, severity: 'error' });
    else checks.push({ check: 'depth', passed: true, detail: `Depth ${bb.y.toFixed(0)}mm matches requested ${meta.targetDimensions.y}mm`, severity: 'info' });
  }
  if (meta.targetDimensions.z != null) {
    const ratio = bb.z / meta.targetDimensions.z;
    if (ratio > 1.5) checks.push({ check: 'height', passed: false, detail: `Height ${bb.z.toFixed(0)}mm exceeds requested ${meta.targetDimensions.z}mm by ${((ratio - 1) * 100).toFixed(0)}%`, severity: 'warning' });
    else if (ratio < 0.5) checks.push({ check: 'height', passed: false, detail: `Height ${bb.z.toFixed(0)}mm is ${((1 - ratio) * 100).toFixed(0)}% smaller than requested ${meta.targetDimensions.z}mm`, severity: 'error' });
    else checks.push({ check: 'height', passed: true, detail: `Height ${bb.z.toFixed(0)}mm matches requested ${meta.targetDimensions.z}mm`, severity: 'info' });
  }

  return checks;
}
