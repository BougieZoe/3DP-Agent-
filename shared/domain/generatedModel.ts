/**
 * GeneratedModel — metadata contract for models produced by the CAD
 * generation skill (earthtojake/text-to-cad, local skill `cad`).
 *
 * Shared between the CAD bridge backend (server/cadBridge.ts) and the
 * frontend design layer (client/src/design/). The analysis pipeline never
 * sees this type — it only sees GeometryModel — so this contract is free
 * to evolve without touching client/src/analysis/.
 *
 * Invariants:
 * - `artifacts` always contains at least one entry with kind 'stl'.
 * - All artifact geometry is in millimeters (`units: 'mm'`). The bridge is
 *   responsible for guaranteeing this; consumers assert, never rescale.
 */

export interface GeneratedArtifact {
  kind: 'step' | 'stl' | 'glb' | '3mf';
  /** Skill convention: STEP is the primary validated artifact, meshes are sidecars. */
  role: 'primary' | 'sidecar';
  format: 'step-ap214' | 'binary-stl' | 'gltf-binary' | '3mf';
  units: 'mm';
  location: ArtifactLocation;
  sizeBytes?: number;
  sha256?: string;
}

export type ArtifactLocation =
  /** Bytes travel inline in the generation response (base64 on the wire). */
  | { type: 'inline-bytes' }
  /** Temporary download URL exposed by a remote worker. */
  | { type: 'http-url'; url: string }
  /** Local filesystem path — dev bridge only, for display/debugging. */
  | { type: 'local-path'; path: string };

export interface GenerationParams {
  /** Original natural-language prompt, kept verbatim for the audit chain. */
  prompt: string;
  /** Explicit assumptions recorded during generation (skill workflow). */
  assumptions: string[];
  /** Bounding box reported by post-generation inspection, when run. */
  boundingBoxMm?: { x: number; y: number; z: number };
  /** Mesh deflection used for the STL sidecar (scripts/step defaults: 0.02 / 0.05). */
  meshTolerance?: { linear: number; angular: number };
  /** Part-specific parameters are passed through without a fixed schema. */
  [partParam: string]: unknown;
}

export interface GenerationValidation {
  /** Whether scripts/inspect actually ran. False means "not checked", not "failed". */
  ran: boolean;
  isSolid?: boolean;
  volumeMm3?: number;
  /** Human-readable check lines, passed through verbatim. */
  checks: string[];
}

export interface GeneratedModel {
  /** Generation run id — also used for report provenance and edit lineage. */
  id: string;
  origin: 'cad-generation';
  prompt: string;
  /** One-line description for UI titles / report headers. */
  summary: string;
  params: GenerationParams;
  artifacts: GeneratedArtifact[];
  validation?: GenerationValidation;
  provenance: {
    skill: string;
    generator: 'build123d';
    cadpyVersion?: string;
    executedBy: 'local-bridge' | 'remote-proxy';
  };
  /**
   * Set when this model was derived from a previous generation (iterative
   * edit). Points at the parent GeneratedModel.id; absent for fresh designs.
   */
  parentModelId?: string;
  createdAt: string; // ISO 8601
  durationMs: number;
  warnings: string[];
}
