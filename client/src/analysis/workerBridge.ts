/**
 * Worker Bridge - Backward Compatible API
 * 
 * This module provides the same API as before but uses the new worker pool
 * under the hood for better performance.
 * 
 * For new code, prefer using workerPool.ts directly for more control.
 */

import { runAnalysisInWorker as runInWorkerPool, type WorkerPoolOptions } from './workerPool';
import { runAnalysisPipeline } from './pipeline';
import type { PipelineOptions } from './pipeline';
import type { GeometryModel } from './geometryModel';
import type { UnifiedAnalysis } from './types';

/**
 * Run analysis in a worker with automatic fallback to main thread
 * 
 * This is a backward-compatible wrapper around the worker pool.
 * For new code, consider using workerPool.ts directly for:
 * - Progress reporting
 * - Cancellation support
 * - Pool statistics
 */
export function runAnalysisInWorker(
  model: GeometryModel,
  options: PipelineOptions = {},
): Promise<UnifiedAnalysis> {
  return runInWorkerPool(model, options);
}

/**
 * Create a reusable analysis function with pre-configured options
 * 
 * Useful when you need to run multiple analyses with the same settings.
 */
export function createAnalysisRunner(
  defaultOptions: PipelineOptions = {},
  poolOptions?: WorkerPoolOptions
) {
  return async (
    model: GeometryModel,
    options: PipelineOptions = {}
  ): Promise<UnifiedAnalysis> => {
    const mergedOptions = { ...defaultOptions, ...options };
    return runInWorkerPool(model, mergedOptions, undefined);
  };
}

/**
 * Check if Web Workers are available
 */
export function isWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Get worker pool statistics
 */
export function getWorkerStats() {
  const { getWorkerPool } = require('./workerPool');
  return getWorkerPool().getStats();
}
