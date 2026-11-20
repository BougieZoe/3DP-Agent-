import {
  runAnalysisInWorker,
  type UnifiedAnalysis,
} from '@/analysis';
import type { PipelineOptions } from '@/analysis/pipeline';
import type { GeometryModel } from '@/analysis/geometryModel';
import { captureTelemetry } from './telemetry';

/**
 * Single entry point for analyses that should leave a profiling record.
 *
 * The pipeline already times each module when `enableProfiling` is set; this
 * wrapper guarantees the flag and records one telemetry event per analysis.
 * It does NOT run analysis twice — the same UnifiedAnalysis is returned to
 * the caller.
 */
export async function analyzeWithTelemetry(
  model: GeometryModel,
  options: PipelineOptions = {},
): Promise<UnifiedAnalysis> {
  const result = await runAnalysisInWorker(model, {
    ...options,
    enableProfiling: true,
  });
  captureTelemetry(result.topology.result.triangleCount, result.profiling);
  return result;
}
