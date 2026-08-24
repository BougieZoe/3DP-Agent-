/**
 * S3 — Validation Corpus Harness Schema
 *
 * Type definitions for the synthetic→expected-result validation framework.
 * Defines input generation params, expected outputs with tolerances, and
 * comparison result structures.
 */

import type { Confidence } from "../../client/src/analysis/types";
import type { Material } from "../../shared/domain/material";
import type { PrinterProfileId } from "../../client/src/analysis/types";
import type { SlicerBackedMetrics } from "../../client/src/analysis/types";
import type { ThresholdsOverride } from "../../client/src/analysis/thresholds";

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

/** Synthetic mesh generation parameters */
export interface MeshGenerationParams {
  /** Geometry type identifier */
  type:
    | "watertight-cube"
    | "open-cube"
    | "inverted-normals"
    | "disconnected-shells"
    | "non-manifold-edge"
    | "thin-wall"
    | "overhang-plate"
    | "large-flat-plate"
    | "icosphere"
    | "terrain-grid"
    | "single-triangle"
    | "thin-walled-tube"
    | "thin-plate"
    | "suspended-ceiling"
    | "welded-box"
    | "box3"
    | "noisy"
    | "degenerate"
    | "empty";
  /** Type-specific parameters */
  params: Record<string, number>;
  /** Coordinate system */
  coordinateSystem: "z-up";
  /** Expected unit */
  expectedUnit: "mm";
}

/** Material configuration */
export interface MaterialConfig {
  /** Technology family */
  materialFamily:
    | "fdm"
    | "sla"
    | "fgf"
    | "sls"
    | "slm"
    | "mjf"
    | "concrete"
    | "eco";
  /** Material object (or reference by key) */
  material?: Material;
  /** Printer profile */
  printerId?: PrinterProfileId;
  /** Layer height */
  layerHeightMm?: number;
}

/** S3 test case input */
export interface S3TestCaseInput {
  /** Unique case ID */
  id: string;
  /** Human-readable label */
  label: string;
  /** Mesh generation parameters */
  mesh: MeshGenerationParams;
  /** Material/printer configuration */
  material: MaterialConfig;
  /** Optional threshold overrides */
  thresholds?: ThresholdsOverride;
  /** Optional slicer ground truth */
  slicer?: SlicerBackedMetrics;
}

// ---------------------------------------------------------------------------
// Expected Output Schema
// ---------------------------------------------------------------------------

/** Tolerance configuration */
export interface Tolerance {
  /** Absolute tolerance (for values near 0) */
  absolute?: number;
  /** Relative tolerance (for larger values) */
  relative?: number;
  /** Exact match (no tolerance) */
  exact?: boolean;
}

/** Field-level expectation */
export interface FieldExpectation {
  /** Exact value */
  value?: unknown;
  /** Range [min, max] */
  range?: [number, number];
  /** Tolerance configuration */
  tolerance?: Tolerance;
  /** Check existence only (for nullable fields) */
  exists?: boolean;
  /** Custom predicate name */
  satisfies?: string;
}

/** Module-level expectation */
export interface ModuleExpectation {
  moduleName: string;
  /** Whether this module should exist */
  shouldExist: boolean;
  /** Field expectations */
  fields: Record<string, FieldExpectation>;
  /** Module-level constraints */
  constraints?: Array<{
    field: string;
    op: ">=" | "<=" | ">" | "<" | "==" | "!=";
    value: number;
  }>;
}

/** Complete expected output */
export interface S3TestCaseExpected {
  /** Module expectations */
  modules: {
    topology?: ModuleExpectation;
    validation?: ModuleExpectation;
    metrics?: ModuleExpectation;
    bedFit?: ModuleExpectation;
    support?: ModuleExpectation;
    printTime?: ModuleExpectation;
    resin?: ModuleExpectation;
    fgf?: ModuleExpectation;
    pbf?: ModuleExpectation;
    concrete?: ModuleExpectation;
    eco?: ModuleExpectation;
    thermal?: ModuleExpectation;
  };
  /** overallConfidence expected range */
  overallConfidence: {
    min: Confidence;
    max: Confidence;
  };
  /** Stability assertions */
  stability?: {
    /** Fields that must be identical across multiple runs */
    deterministicFields?: string[];
    /** Maximum total duration (ms) */
    maxTotalDurationMs?: number;
  };
}

/** Complete S3 test case */
export interface S3TestCase {
  id: string;
  label: string;
  description?: string;
  input: S3TestCaseInput;
  expected: S3TestCaseExpected;
  /** Case classification tags */
  tags: Array<
    "regression" | "boundary" | "stress" | "perf" | "material-specific"
  >;
}

// ---------------------------------------------------------------------------
// Comparison Result Schema
// ---------------------------------------------------------------------------

/** Single field comparison result */
export interface FieldComparison {
  field: string;
  actual: unknown;
  expected: unknown;
  passed: boolean;
  /** Failure message */
  message?: string;
}

/** Module-level comparison result */
export interface ModuleComparison {
  moduleName: string;
  passed: boolean;
  fields: FieldComparison[];
  /** Module duration (ms) from profiling */
  durationMs?: number;
}

/** S3 test case comparison result */
export interface S3TestCaseResult {
  caseId: string;
  passed: boolean;
  modules: ModuleComparison[];
  overallConfidence: {
    actual: number;
    passed: boolean;
    message: string;
  };
  /** Total duration (ms) */
  totalDurationMs: number;
  /** Summary of all failures */
  failures: string[];
}
