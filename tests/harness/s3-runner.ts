/**
 * S3 — Validation Runner
 *
 * Executes test cases against the analysis pipeline and compares results.
 */

import type {
  S3TestCase,
  S3TestCaseInput,
  S3TestCaseResult,
  ModuleComparison,
} from "./s3-schema";
import type {
  UnifiedAnalysis,
  Confidence,
} from "../../client/src/analysis/types";
import { generateMesh } from "./fixtures/generators";
import { compareModule, compareConfidence } from "./s3-compare";
import { runAnalysisPipeline } from "../../client/src/analysis/pipeline";
import type { PipelineOptions } from "../../client/src/analysis/pipeline";

export interface RunOptions {
  /** Skip modules not in this list (optional) */
  skipModules?: string[];
  /** Run with performance profiling */
  profile?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

export interface RunAllOptions extends RunOptions {
  /** Filter by tags */
  tags?: string[];
  /** Filter by case ID prefix */
  prefix?: string;
  /** Max concurrent runs */
  concurrency?: number;
}

/**
 * Run a single test case against the analysis pipeline.
 */
export async function runSingleCase(
  testCase: S3TestCase,
  options: RunOptions = {}
): Promise<S3TestCaseResult> {
  const startTime = performance.now();
  const failures: string[] = [];

  if (options.verbose) {
    console.log(`\n▶ Running case: ${testCase.id} — ${testCase.label}`);
  }

  // Generate mesh from params
  const geometryModel = generateMesh(testCase.input.mesh);

  // Configure analysis options
  const pipelineOptions: PipelineOptions = {
    material: testCase.input.material.material,
    printerId: testCase.input.material.printerId,
    layerHeightMm: testCase.input.material.layerHeightMm,
    thresholds: testCase.input.thresholds,
  };

  // Run analysis pipeline
  let analysis: UnifiedAnalysis;
  try {
    analysis = runAnalysisPipeline(geometryModel, pipelineOptions);
  } catch (error) {
    const duration = performance.now() - startTime;
    return {
      caseId: testCase.id,
      passed: false,
      modules: [],
      overallConfidence: {
        actual: 0,
        passed: false,
        message: `Pipeline error: ${error}`,
      },
      totalDurationMs: duration,
      failures: [`Pipeline error: ${error}`],
    };
  }

  const duration = performance.now() - startTime;

  // Compare each expected module
  const moduleComparisons: ModuleComparison[] = [];
  for (const [moduleName, expectation] of Object.entries(
    testCase.expected.modules
  )) {
    if (!expectation) continue;
    if (options.skipModules?.includes(moduleName)) continue;

    const comparison = compareModule(moduleName, expectation, analysis);
    moduleComparisons.push(comparison);

    if (!comparison.passed) {
      const failedFields = comparison.fields.filter(f => !f.passed);
      for (const field of failedFields) {
        failures.push(
          `${moduleName}.${field.field}: ${field.message || "failed"}`
        );
      }
    }
  }

  // Compare overall confidence
  const confidenceComparison = compareConfidence(
    testCase.expected.overallConfidence,
    analysis.overallConfidence as Confidence
  );
  if (!confidenceComparison.passed) {
    failures.push(confidenceComparison.message);
  }

  // Check stability constraints
  if (testCase.expected.stability?.maxTotalDurationMs) {
    if (duration > testCase.expected.stability.maxTotalDurationMs) {
      failures.push(
        `Duration ${duration.toFixed(0)}ms exceeded max ${testCase.expected.stability.maxTotalDurationMs}ms`
      );
    }
  }

  const allPassed = failures.length === 0;

  if (options.verbose) {
    console.log(
      `  ${allPassed ? "✅" : "❌"} ${allPassed ? "PASSED" : "FAILED"} in ${duration.toFixed(0)}ms`
    );
    if (!allPassed) {
      for (const f of failures) {
        console.log(`    - ${f}`);
      }
    }
  }

  return {
    caseId: testCase.id,
    passed: allPassed,
    modules: moduleComparisons,
    overallConfidence: confidenceComparison,
    totalDurationMs: duration,
    failures,
  };
}

/**
 * Run multiple test cases with optional filtering.
 */
export async function runAllCases(
  testCases: S3TestCase[],
  options: RunAllOptions = {}
): Promise<S3TestCaseResult[]> {
  let filtered = [...testCases];

  // Apply tag filter
  if (options.tags && options.tags.length > 0) {
    filtered = filtered.filter(tc =>
      tc.tags.some(t => options.tags!.includes(t))
    );
  }

  // Apply prefix filter
  if (options.prefix) {
    filtered = filtered.filter(tc => tc.id.startsWith(options.prefix!));
  }

  if (options.verbose) {
    console.log(`\nRunning ${filtered.length} test cases...`);
  }

  const results: S3TestCaseResult[] = [];
  const concurrency = options.concurrency ?? 1;

  if (concurrency <= 1) {
    // Sequential execution
    for (const testCase of filtered) {
      const result = await runSingleCase(testCase, options);
      results.push(result);
    }
  } else {
    // Concurrent execution (limited concurrency)
    const chunks: S3TestCase[][] = [];
    for (let i = 0; i < filtered.length; i += concurrency) {
      chunks.push(filtered.slice(i, i + concurrency));
    }
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(tc => runSingleCase(tc, options))
      );
      results.push(...chunkResults);
    }
  }

  return results;
}

/**
 * Run stability test (multiple runs of same case).
 */
export async function runStabilityTest(
  testCase: S3TestCase,
  runs: number = 3,
  options: RunOptions = {}
): Promise<{
  results: S3TestCaseResult[];
  allPassed: boolean;
  deterministicFields: string[];
}> {
  const results: S3TestCaseResult[] = [];

  for (let i = 0; i < runs; i++) {
    const result = await runSingleCase(testCase, options);
    results.push(result);
  }

  const allPassed = results.every(r => r.passed);
  const deterministicFields: string[] = [];

  // Check deterministic fields
  if (testCase.expected.stability?.deterministicFields) {
    for (const fieldPath of testCase.expected.stability.deterministicFields) {
      const parts = fieldPath.split(".");
      const moduleName = parts[0];
      const fieldName = parts.slice(1).join(".");

      const values = results.map(r => {
        const moduleComp = r.modules.find(m => m.moduleName === moduleName);
        const fieldComp = moduleComp?.fields.find(f => f.field === fieldName);
        return fieldComp?.actual;
      });

      const allSame = values.every(
        v => JSON.stringify(v) === JSON.stringify(values[0])
      );
      if (allSame) {
        deterministicFields.push(fieldPath);
      }
    }
  }

  return {
    results,
    allPassed,
    deterministicFields,
  };
}
