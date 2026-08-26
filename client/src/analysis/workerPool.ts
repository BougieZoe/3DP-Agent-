/**
 * WebWorker Pool Manager
 *
 * Manages a pool of reusable workers for analysis:
 * - Reuses workers instead of creating new ones per request
 * - Supports progress reporting
 * - Supports cancellation via AbortController
 * - Handles timeouts
 * - Graceful fallback to main thread
 */

import { runAnalysisPipeline } from './pipeline';
import type { PipelineOptions } from './pipeline';
import type { GeometryModel } from './geometryModel';
import type { UnifiedAnalysis } from './types';

export interface WorkerPoolOptions {
  /** Maximum number of workers in the pool */
  maxWorkers?: number;
  /** Timeout per analysis in milliseconds */
  timeoutMs?: number;
}

interface PendingJob {
  id: string;
  workerIndex: number;
  resolve: (result: UnifiedAnalysis) => void;
  reject: (error: Error) => void;
  abortController: AbortController;
}

/** Floor for any analysis timeout — even tiny meshes get a grace period. */
const MIN_TIMEOUT_MS = 30_000;
/** Ceiling — a stuck worker must still fail eventually. */
const MAX_TIMEOUT_MS = 600_000;
/**
 * µs per triangle budget used to scale the timeout. Measured end-to-end on a
 * 1.49M-triangle model: ~16 µs/tri on desktop node (wall-thickness raycast
 * dominates), and phones run 2–4× slower — 150 µs/tri leaves generous headroom.
 */
const US_PER_TRIANGLE = 150;

class WorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private pendingJobs: PendingJob[] = [];
  private jobQueue: Array<{
    model: GeometryModel;
    options: PipelineOptions;
    job: PendingJob;
  }> = [];
  private maxWorkers: number;
  private timeoutMs: number;
  private workerIndex = 0;

  constructor(options: WorkerPoolOptions = {}) {
    // Cap workers by device memory: each worker is a full JS context (~20–40 MB
    // baseline) and shares the tab's memory budget on mobile. A 1.5M-triangle
    // analysis already needs hundreds of MB inside one worker — spawning 4 of
    // them on a 4 GB phone is what pushed the tab over the edge.
    const cores = navigator.hardwareConcurrency ?? 4;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const memCap = !mem ? 4 : mem >= 8 ? 4 : mem >= 4 ? 2 : 1;
    this.maxWorkers = options.maxWorkers ?? Math.min(cores, memCap);
    this.timeoutMs = options.timeoutMs ?? MIN_TIMEOUT_MS;
  }

  /**
   * Initialize the worker pool
   */
  init(): void {
    if (typeof Worker === 'undefined') return;

    for (let i = 0; i < this.maxWorkers; i++) {
      this.createWorker();
    }
  }

  /**
   * Create a new worker
   */
  private createWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null;

    try {
      const worker = new Worker(
        new URL('./analysis.worker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (e: MessageEvent) => {
        this.handleWorkerMessage(worker, e.data);
      };

      worker.onerror = (e) => {
        this.handleWorkerError(worker, new Error(`Worker error: ${e.message}`));
      };

      this.workers.push(worker);
      this.availableWorkers.push(worker);
      return worker;
    } catch {
      return null;
    }
  }

  /**
   * Handle message from worker
   */
  private handleWorkerMessage(worker: Worker, msg: UnifiedAnalysis | { type: string; result?: UnifiedAnalysis; error?: string; stage?: string; progress?: number }): void {
    // Progress messages — forward to console for now, keep worker active
    if (msg && typeof msg === 'object' && 'type' in msg && msg.type === 'progress') {
      return;
    }

    const workerIdx = this.workers.indexOf(worker);

    // Error from worker
    if (msg && typeof msg === 'object' && 'type' in msg && msg.type === 'error') {
      const job = this.pendingJobs.find(j => j.workerIndex === workerIdx);
      if (job) {
        clearTimeout(job.id as any);
        job.reject(new Error((msg as { error: string }).error));
        this.pendingJobs = this.pendingJobs.filter(j => j !== job);
      }
      // Replace failed worker
      this.workers = this.workers.filter(w => w !== worker);
      worker.terminate();
      this.createWorker();
      return;
    }

    // Completion — extract result from envelope
    const result = (msg && typeof msg === 'object' && 'type' in msg && msg.type === 'complete')
      ? (msg as { type: string; result: UnifiedAnalysis }).result
      : msg as UnifiedAnalysis;

    const job = this.pendingJobs.find(j => j.workerIndex === workerIdx);
    if (job) {
      clearTimeout(job.id as any);
      job.resolve(result);
      this.pendingJobs = this.pendingJobs.filter(j => j !== job);
    }

    this.availableWorkers.push(worker);
    this.processQueue();
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(worker: Worker, error: Error): void {
    const workerIdx = this.workers.indexOf(worker);
    const job = this.pendingJobs.find(j => j.workerIndex === workerIdx);
    if (job) {
      clearTimeout(job.id as any);
      job.reject(error);
      this.pendingJobs = this.pendingJobs.filter(j => j !== job);
    }

    // Replace the failed worker
    this.workers = this.workers.filter(w => w !== worker);
    worker.terminate();
    this.createWorker();
  }

  /**
   * Process queued jobs
   */
  private processQueue(): void {
    while (this.jobQueue.length > 0 && this.availableWorkers.length > 0) {
      const { model, options, job } = this.jobQueue.shift()!;
      const worker = this.availableWorkers.pop()!;
      const workerIdx = this.workers.indexOf(worker);

      // Scale the timeout with model size: the analysis pipeline is O(triangles)
      // dominated (geometry graph + wall-thickness raycast). A flat 30 s timeout
      // killed every large-mesh analysis mid-flight on slow devices.
      const jobTimeoutMs = Math.max(
        this.timeoutMs,
        Math.min(MAX_TIMEOUT_MS, model.triangleCount * US_PER_TRIANGLE),
      );

      const timeoutId = setTimeout(() => {
        job.reject(new Error('Analysis timeout'));
        this.pendingJobs = this.pendingJobs.filter(j => j !== job);
        // Terminate and replace the stuck worker
        this.workers = this.workers.filter(w => w !== worker);
        worker.terminate();
        this.createWorker();
      }, jobTimeoutMs);

      this.pendingJobs.push({ ...job, id: timeoutId as any, workerIndex: workerIdx });
      worker.postMessage({ model, options });
    }
  }

  /**
   * Run analysis in a worker from the pool
   */
  run(
    model: GeometryModel,
    options: PipelineOptions = {},
    abortController?: AbortController
  ): Promise<UnifiedAnalysis> {
    // Fallback to main thread if no workers available
    if (this.workers.length === 0) {
      return Promise.resolve(runAnalysisPipeline(model, options));
    }

    return new Promise((resolve, reject) => {
      const job: PendingJob = {
        id: '',
        workerIndex: -1, // Will be set when assigned to a worker in processQueue
        resolve,
        reject,
        abortController: abortController ?? new AbortController(),
      };

      // Check if already aborted
      if (job.abortController.signal.aborted) {
        reject(new Error('Analysis aborted'));
        return;
      }

      // Listen for abort
      job.abortController.signal.addEventListener('abort', () => {
        this.jobQueue = this.jobQueue.filter(j => j.job !== job);
        this.pendingJobs = this.pendingJobs.filter(j => j !== job);
        reject(new Error('Analysis aborted'));
      });

      this.jobQueue.push({ model, options, job });
      this.processQueue();
    });
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalWorkers: number;
    availableWorkers: number;
    pendingJobs: number;
    queuedJobs: number;
  } {
    return {
      totalWorkers: this.workers.length,
      availableWorkers: this.availableWorkers.length,
      pendingJobs: this.pendingJobs.length,
      queuedJobs: this.jobQueue.length,
    };
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.availableWorkers = [];
    this.pendingJobs = [];
    this.jobQueue = [];
  }
}

// Singleton instance
let poolInstance: WorkerPool | null = null;

/**
 * Get or create the worker pool
 */
export function getWorkerPool(options?: WorkerPoolOptions): WorkerPool {
  if (!poolInstance) {
    poolInstance = new WorkerPool(options);
    poolInstance.init();
  }
  return poolInstance;
}

/**
 * Run analysis in a worker (with pool management)
 *
 * This is the main API for running analysis in a WebWorker.
 * It automatically manages the worker pool and provides:
 * - Worker reuse for better performance
 * - Timeout handling
 * - Cancellation support via AbortController
 * - Graceful fallback to main thread
 */
export async function runAnalysisInWorker(
  model: GeometryModel,
  options: PipelineOptions = {},
  abortController?: AbortController
): Promise<UnifiedAnalysis> {
  // Check if analysis is too small to benefit from worker
  if (model.triangleCount < 1000) {
    return runAnalysisPipeline(model, options);
  }

  const pool = getWorkerPool();
  return pool.run(model, options, abortController);
}

/**
 * Cleanup worker pool (call on app unmount)
 */
export function cleanupWorkerPool(): void {
  if (poolInstance) {
    poolInstance.terminate();
    poolInstance = null;
  }
}
