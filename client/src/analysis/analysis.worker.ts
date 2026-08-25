/**
 * Analysis WebWorker
 * 
 * Runs the analysis pipeline in a separate thread.
 * Supports progress reporting and cancellation.
 */

import { runAnalysisPipeline } from './pipeline';
import type { PipelineOptions } from './pipeline';
import type { GeometryModel } from './geometryModel';
import type { UnifiedAnalysis } from './types';

interface WorkerRequest {
  model: GeometryModel;
  options: PipelineOptions;
  requestId?: string;
}

interface ProgressMessage {
  type: 'progress';
  stage: string;
  progress: number;
  requestId?: string;
}

interface CompleteMessage {
  type: 'complete';
  result: UnifiedAnalysis;
  requestId?: string;
}

interface ErrorMessage {
  type: 'error';
  error: string;
  requestId?: string;
}

type WorkerMessage = ProgressMessage | CompleteMessage | ErrorMessage;

// Stages for progress reporting
const STAGES = [
  'topology',
  'validation',
  'metrics',
  'wallThickness',
  'bedFit',
  'support',
  'thermal',
  'resin',
  'fgf',
] as const;

function reportProgress(stage: string, progress: number, requestId?: string): void {
  const msg: ProgressMessage = {
    type: 'progress',
    stage,
    progress,
    requestId,
  };
  postMessage(msg);
}

addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const { model, options, requestId } = e.data;

  try {
    // Report initial progress
    reportProgress('start', 0, requestId);

    // Run the pipeline
    const result = runAnalysisPipeline(model, options);

    // Report completion
    const msg: CompleteMessage = {
      type: 'complete',
      result,
      requestId,
    };
    postMessage(msg);
  } catch (error) {
    const msg: ErrorMessage = {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId,
    };
    postMessage(msg);
  }
});
