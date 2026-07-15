import { runAnalysisPipeline } from './pipeline';
import type { PipelineOptions } from './pipeline';
import type { GeometryModel } from './geometryModel';
import type { UnifiedAnalysis } from './types';

export function runAnalysisInWorker(
  model: GeometryModel,
  options: PipelineOptions = {},
): Promise<UnifiedAnalysis> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(runAnalysisPipeline(model, options));
  }

  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL('./analysis.worker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch {
      resolve(runAnalysisPipeline(model, options));
      return;
    }

    worker.onmessage = (e: MessageEvent<UnifiedAnalysis>) => {
      resolve(e.data);
      worker.terminate();
    };

    worker.onerror = (e) => {
      reject(new Error(`Worker error: ${e.message}`));
      worker.terminate();
    };

    worker.postMessage({ model, options });
  });
}
