/**
 * S3 — Validation Harness Entry Point
 *
 * Provides unified API for running validation corpus tests.
 */

export {
  type S3TestCase,
  type S3TestCaseInput,
  type S3TestCaseExpected,
  type S3TestCaseResult,
  type MeshGenerationParams,
  type MaterialConfig,
  type ModuleExpectation,
  type FieldExpectation,
  type Tolerance,
} from "./s3-schema";

export { compareModule, compareConfidence } from "./s3-compare";
export { generateMesh } from "./fixtures/generators";
export { testCases } from "./fixtures/useCases";
export { goldenBaselines } from "./fixtures/goldenBaseline";

export {
  runSingleCase,
  runAllCases,
  runStabilityTest,
  type RunOptions,
  type RunAllOptions,
} from "./s3-runner";

export {
  generateReport,
  formatTextReport,
  formatJsonReport,
  formatMarkdownReport,
  type ValidationReport,
  type ReportOptions,
} from "./s3-reporter";
