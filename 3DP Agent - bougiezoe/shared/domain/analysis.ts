// shared/domain/analysis.ts
// ModelAnalysis is the serialization-safe operational artifact.
// It must never contain: Three.js objects, ArrayBuffers, DOM refs, functions.

import type { GeometryMetrics } from './geometry';
import type { PrintabilitySummary } from './printability';

export type AnalysisStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ModelAnalysis {
  // Identity
  readonly id: string;
  readonly fileName: string;
  readonly fileSize: number;        // bytes
  readonly analyzedAt: string;      // ISO 8601

  // Status
  readonly status: AnalysisStatus;
  readonly errorMessage?: string;

  // Payload (present when status === 'completed')
  readonly geometry?: GeometryMetrics;
  readonly printability?: PrintabilitySummary;

  // Provenance
  readonly analysisVersion: string;
}

export interface WorkflowStageResult<T = unknown> {
  readonly stage: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly output?: T;
  readonly error?: string;
}

/** Construct a fresh pending analysis shell */
export function createAnalysis(
  id: string,
  fileName: string,
  fileSize: number
): ModelAnalysis {
  return {
    id,
    fileName,
    fileSize,
    analyzedAt: new Date().toISOString(),
    status: 'pending',
    analysisVersion: '1.0.0',
  };
}

/** Type-guard: is the analysis complete and usable? */
export function isComplete(
  a: ModelAnalysis
): a is ModelAnalysis & Required<Pick<ModelAnalysis, 'geometry' | 'printability'>> {
  return a.status === 'completed' && !!a.geometry && !!a.printability;
}