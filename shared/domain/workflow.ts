export type WorkflowStageId =
  | 'ingest'
  | 'parse_mesh'
  | 'analyze_geometry'
  | 'evaluate_printability'
  | 'generate_report'
  | 'advisor_response'
  | 'slice_model';

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StageError {
  code: string;
  message: string;
}

export interface WorkflowStageResult<TOutput = unknown> {
  id: WorkflowStageId;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  output?: TOutput;
  error?: StageError;
}

export function createPendingStage<TOutput = unknown>(
  id: WorkflowStageId,
): WorkflowStageResult<TOutput> {
  return {
    id,
    status: 'pending',
  };
}

export function startStage<TOutput>(
  stage: WorkflowStageResult<TOutput>,
  startedAt: string,
): WorkflowStageResult<TOutput> {
  return {
    id: stage.id,
    status: 'running',
    startedAt,
  };
}

export function completeStage<TOutput>(
  stage: WorkflowStageResult<TOutput>,
  output: TOutput,
  completedAt: string,
): WorkflowStageResult<TOutput> {
  return {
    id: stage.id,
    status: 'completed',
    startedAt: stage.startedAt,
    completedAt,
    durationMs: calculateDurationMs(stage.startedAt, completedAt),
    output,
  };
}

export function failStage<TOutput>(
  stage: WorkflowStageResult<TOutput>,
  error: StageError,
  completedAt: string,
): WorkflowStageResult<TOutput> {
  return {
    id: stage.id,
    status: 'failed',
    startedAt: stage.startedAt,
    completedAt,
    durationMs: calculateDurationMs(stage.startedAt, completedAt),
    error,
  };
}

export function skipStage<TOutput>(
  stage: WorkflowStageResult<TOutput>,
  completedAt: string,
): WorkflowStageResult<TOutput> {
  return {
    id: stage.id,
    status: 'skipped',
    startedAt: stage.startedAt,
    completedAt,
    durationMs: calculateDurationMs(stage.startedAt, completedAt),
  };
}

function calculateDurationMs(startedAt: string | undefined, completedAt: string): number | undefined {
  if (!startedAt) return undefined;
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}
