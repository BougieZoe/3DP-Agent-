// shared/domain/artifacts.ts
// Artifact semantics: what can move where, and how.

export type ArtifactKind =
  | 'model-analysis'      // serializable, cacheable, portable
  | 'geometry-buffer'     // runtime-only, worker-safe, NOT serializable as-is
  | 'mesh-object'         // rendering-only, main thread only
  | 'workflow-state'      // transient, runtime-bound
  | 'advisor-message';    // serializable, replayable

export interface ArtifactSemantics {
  readonly kind: ArtifactKind;
  readonly serializable: boolean;   // can JSON.stringify safely
  readonly workerSafe: boolean;     // can postMessage to Worker
  readonly cacheable: boolean;      // safe to store and reuse
  readonly replayable: boolean;     // same input → same output
  readonly renderingOnly: boolean;  // must stay on main thread
}

export const ARTIFACT_SEMANTICS: Record<ArtifactKind, ArtifactSemantics> = {
  'model-analysis': {
    kind: 'model-analysis',
    serializable: true,
    workerSafe: true,
    cacheable: true,
    replayable: true,
    renderingOnly: false,
  },
  'geometry-buffer': {
    kind: 'geometry-buffer',
    serializable: false,
    workerSafe: true,         // transferable via ArrayBuffer
    cacheable: false,
    replayable: true,
    renderingOnly: false,
  },
  'mesh-object': {
    kind: 'mesh-object',
    serializable: false,
    workerSafe: false,        // Three.js — main thread only
    cacheable: false,
    replayable: false,
    renderingOnly: true,
  },
  'workflow-state': {
    kind: 'workflow-state',
    serializable: true,
    workerSafe: false,
    cacheable: false,
    replayable: false,
    renderingOnly: false,
  },
  'advisor-message': {
    kind: 'advisor-message',
    serializable: true,
    workerSafe: true,
    cacheable: true,
    replayable: true,
    renderingOnly: false,
  },
};