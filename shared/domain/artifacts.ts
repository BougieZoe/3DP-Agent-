export type ArtifactMutability = 'immutable' | 'mutable';

export type ArtifactSerialization =
  | 'json_serializable'
  | 'non_serializable'
  | 'output_dependent';

export type ArtifactCacheability = 'cacheable' | 'transient';

export type ArtifactReplayability = 'replayable' | 'runtime_bound';

export type ExecutionBoundary =
  | 'main_thread'
  | 'worker'
  | 'backend'
  | 'orchestration'
  | 'rendering';

export type ArtifactStability = 'foundational' | 'transitional';

export type OperationalArtifactKind =
  | 'geometry_metrics'
  | 'printability_finding'
  | 'model_analysis'
  | 'analysis_report'
  | 'advisor_context'
  | 'workflow_stage_result'
  | 'stl_analysis_result'
  | 'render_geometry'
  | 'render_mesh';

export interface ArtifactSemantics {
  kind: OperationalArtifactKind;
  stability: ArtifactStability;
  mutability: ArtifactMutability;
  serialization: ArtifactSerialization;
  cacheability: ArtifactCacheability;
  replayability: ArtifactReplayability;
  boundaries: readonly ExecutionBoundary[];
  description: string;
}

export const ARTIFACT_SEMANTICS: Record<OperationalArtifactKind, ArtifactSemantics> = {
  geometry_metrics: {
    kind: 'geometry_metrics',
    stability: 'foundational',
    mutability: 'immutable',
    serialization: 'json_serializable',
    cacheability: 'cacheable',
    replayability: 'replayable',
    boundaries: ['main_thread', 'worker', 'backend', 'orchestration'],
    description: 'Plain numeric geometry measurements for operational decisions.',
  },
  printability_finding: {
    kind: 'printability_finding',
    stability: 'foundational',
    mutability: 'immutable',
    serialization: 'json_serializable',
    cacheability: 'cacheable',
    replayability: 'replayable',
    boundaries: ['main_thread', 'worker', 'backend', 'orchestration'],
    description: 'Plain manufacturability finding derived from analysis, slicer, or advisor stages.',
  },
  model_analysis: {
    kind: 'model_analysis',
    stability: 'foundational',
    mutability: 'immutable',
    serialization: 'json_serializable',
    cacheability: 'cacheable',
    replayability: 'replayable',
    boundaries: ['main_thread', 'worker', 'backend', 'orchestration'],
    description: 'Canonical operational analysis artifact for a model.',
  },
  analysis_report: {
    kind: 'analysis_report',
    stability: 'foundational',
    mutability: 'immutable',
    serialization: 'json_serializable',
    cacheability: 'cacheable',
    replayability: 'replayable',
    boundaries: ['main_thread', 'worker', 'backend', 'orchestration'],
    description: 'Generated report content tied to a model source.',
  },
  advisor_context: {
    kind: 'advisor_context',
    stability: 'foundational',
    mutability: 'immutable',
    serialization: 'json_serializable',
    cacheability: 'transient',
    replayability: 'replayable',
    boundaries: ['main_thread', 'worker', 'backend', 'orchestration'],
    description: 'Serializable context assembled for local or AI advisor responses.',
  },
  workflow_stage_result: {
    kind: 'workflow_stage_result',
    stability: 'foundational',
    mutability: 'immutable',
    serialization: 'output_dependent',
    cacheability: 'cacheable',
    replayability: 'replayable',
    boundaries: ['main_thread', 'worker', 'backend', 'orchestration'],
    description: 'Future stage result wrapper; safety depends on the output artifact.',
  },
  stl_analysis_result: {
    kind: 'stl_analysis_result',
    stability: 'transitional',
    mutability: 'mutable',
    serialization: 'non_serializable',
    cacheability: 'transient',
    replayability: 'runtime_bound',
    boundaries: ['main_thread'],
    description: 'Current runtime analysis shape that still contains Three.js vector objects.',
  },
  render_geometry: {
    kind: 'render_geometry',
    stability: 'transitional',
    mutability: 'mutable',
    serialization: 'non_serializable',
    cacheability: 'transient',
    replayability: 'runtime_bound',
    boundaries: ['main_thread', 'rendering'],
    description: 'Three.js BufferGeometry used for rendering and local geometry processing.',
  },
  render_mesh: {
    kind: 'render_mesh',
    stability: 'transitional',
    mutability: 'mutable',
    serialization: 'non_serializable',
    cacheability: 'transient',
    replayability: 'runtime_bound',
    boundaries: ['main_thread', 'rendering'],
    description: 'Three.js Mesh used only for viewport rendering.',
  },
};

export function getArtifactSemantics(kind: OperationalArtifactKind): ArtifactSemantics {
  return ARTIFACT_SEMANTICS[kind];
}

export function isSerializableArtifact(kind: OperationalArtifactKind): boolean {
  return ARTIFACT_SEMANTICS[kind].serialization === 'json_serializable';
}

export function isWorkerSafeArtifact(kind: OperationalArtifactKind): boolean {
  return ARTIFACT_SEMANTICS[kind].boundaries.includes('worker');
}

export function isRenderingOnlyArtifact(kind: OperationalArtifactKind): boolean {
  const boundaries = ARTIFACT_SEMANTICS[kind].boundaries;
  return boundaries.includes('rendering') && !boundaries.includes('worker');
}
