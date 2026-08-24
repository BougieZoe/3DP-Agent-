/**
 * S3 — Comparison Engine
 *
 * Field-level comparison with tolerance handling, range checks,
 * and custom predicates for validation corpus harness.
 */

import type {
  FieldExpectation,
  FieldComparison,
  ModuleExpectation,
  ModuleComparison,
  Tolerance,
} from "./s3-schema";
import type {
  UnifiedAnalysis,
  Confidence,
} from "../../client/src/analysis/types";

// ---------------------------------------------------------------------------
// Value comparison
// ---------------------------------------------------------------------------

function compareValue(
  actual: unknown,
  expectation: FieldExpectation
): { passed: boolean; message?: string } {
  // Existence check
  if (expectation.exists !== undefined) {
    const exists = actual !== null && actual !== undefined;
    if (exists !== expectation.exists) {
      return {
        passed: false,
        message: `expected ${expectation.exists ? "exist" : "null"}, got ${actual}`,
      };
    }
    if (!expectation.exists) return { passed: true };
  }

  // Exact match
  if (expectation.exact) {
    if (actual !== expectation.value) {
      return {
        passed: false,
        message: `expected exact ${JSON.stringify(expectation.value)}, got ${JSON.stringify(actual)}`,
      };
    }
    return { passed: true };
  }

  // Range check
  if (expectation.range) {
    const [min, max] = expectation.range;
    if (typeof actual === "number" && (actual < min || actual > max)) {
      return {
        passed: false,
        message: `expected [${min}, ${max}], got ${actual}`,
      };
    }
    return { passed: true };
  }

  // Tolerance check
  if (
    expectation.tolerance &&
    typeof actual === "number" &&
    typeof expectation.value === "number"
  ) {
    return compareWithTolerance(
      actual,
      expectation.value,
      expectation.tolerance
    );
  }

  // Exact value (no tolerance specified)
  if (expectation.value !== undefined && actual !== expectation.value) {
    return {
      passed: false,
      message: `expected ${JSON.stringify(expectation.value)}, got ${JSON.stringify(actual)}`,
    };
  }

  return { passed: true };
}

function compareWithTolerance(
  actual: number,
  expected: number,
  tolerance: Tolerance
): { passed: boolean; message?: string } {
  if (tolerance.exact) {
    if (actual !== expected) {
      return {
        passed: false,
        message: `expected exact ${expected}, got ${actual}`,
      };
    }
    return { passed: true };
  }

  const absDiff = Math.abs(actual - expected);
  const relDiff = expected !== 0 ? absDiff / Math.abs(expected) : Infinity;

  const absThreshold = tolerance.absolute ?? Infinity;
  const relThreshold = tolerance.relative ?? Infinity;

  if (absDiff > absThreshold && relDiff > relThreshold) {
    return {
      passed: false,
      message: `expected ${expected} ± (abs:${absThreshold}, rel:${relThreshold}), got ${actual} (diff=${absDiff})`,
    };
  }

  return { passed: true };
}

// ---------------------------------------------------------------------------
// Module comparison
// ---------------------------------------------------------------------------

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function compareModule(
  moduleName: string,
  expectation: ModuleExpectation,
  result: UnifiedAnalysis
): ModuleComparison {
  const moduleResult = getNestedValue(result, moduleName) as {
    result?: unknown;
    confidence?: number;
  } | null;

  const fields: FieldComparison[] = [];

  // Check existence
  if (!expectation.shouldExist) {
    if (moduleResult !== null && moduleResult !== undefined) {
      fields.push({
        field: "__existence__",
        actual: "exists",
        expected: "null",
        passed: false,
        message: `module ${moduleName} should not exist but does`,
      });
    }
    return { moduleName, passed: fields.length === 0, fields };
  }

  if (moduleResult === null || moduleResult === undefined) {
    fields.push({
      field: "__existence__",
      actual: "null",
      expected: "exists",
      passed: false,
      message: `module ${moduleName} should exist but is null`,
    });
    return { moduleName, passed: false, fields };
  }

  // Get the actual result data (nested under .result)
  const actualResult = moduleResult.result;

  // Compare each field
  for (const [fieldPath, fieldExpectation] of Object.entries(expectation.fields)) {
    const actual = getNestedValue(actualResult, fieldPath);
    const comparison = compareValue(actual, fieldExpectation);
    fields.push({
      field: fieldPath,
      actual,
      expected: fieldExpectation.value ?? fieldExpectation.range ?? fieldExpectation.exists,
      passed: comparison.passed,
      message: comparison.message,
    });
  }

  // Check constraints
  if (expectation.constraints) {
    for (const constraint of expectation.constraints) {
      const actual = getNestedValue(
        constraint.field === "confidence" ? moduleResult : moduleResult.result,
        constraint.field
      );

      let passed = false;
      switch (constraint.op) {
        case ">=":
          passed = actual >= constraint.value;
          break;
        case "<=":
          passed = actual <= constraint.value;
          break;
        case ">":
          passed = actual > constraint.value;
          break;
        case "<":
          passed = actual < constraint.value;
          break;
        case "==":
          passed = actual === constraint.value;
          break;
        case "!=":
          passed = actual !== constraint.value;
          break;
      }

      if (!passed) {
        fields.push({
          field: constraint.field,
          actual,
          expected: `constraint: ${constraint.field} ${constraint.op} ${constraint.value}`,
          passed: false,
          message: `expected ${constraint.field} ${constraint.op} ${constraint.value}, got ${actual}`,
        });
      }
    }
  }

  const allPassed = fields.every(f => f.passed);
  return { moduleName, passed: allPassed, fields };
}

// ---------------------------------------------------------------------------
// Confidence comparison
// ---------------------------------------------------------------------------

export function compareConfidence(
  expected: { min: Confidence; max: Confidence },
  actual: Confidence
): { actual: number; passed: boolean; message: string } {
  const passed = actual >= expected.min && actual <= expected.max;
  return {
    actual,
    passed,
    message: passed
      ? ""
      : `expected confidence in [${expected.min}, ${expected.max}], got ${actual}`,
  };
}
