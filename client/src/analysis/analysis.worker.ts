import { runAnalysisPipeline } from './pipeline';
import type { PipelineOptions } from './pipeline';
import type { GeometryModel } from './geometryModel';
import type { UnifiedAnalysis } from './types';

interface WorkerRequest {
  model: GeometryModel;
  options: PipelineOptions;
}

addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const { model, options } = e.data;
  const result = runAnalysisPipeline(model, options);
  postMessage(result satisfies UnifiedAnalysis);
});
