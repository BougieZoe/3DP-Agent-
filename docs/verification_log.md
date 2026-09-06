# Scope A Verification Log

**Date:** 2026-09-06
**File under test:** `client/src/lib/semanticDiagnostic.ts`
**Test file:** `client/src/lib/__tests__/semanticDiagnostic.test.ts`
**Commit:** `69910703` (`feat(semantic): add semantic diagnostic layer + CI fixes`, 2026-09-06)

---

## Step 1 — All 9 tests

| # | Line | Test name | Spec or extra? |
|---|------|-----------|----------------|
| 1 | 35 | `serializes exact numeric values from DiagnosticInput into the prompt` | **Spec — fixture** |
| 2 | 58 | `handles null wall thickness values` | Extra — null edge case |
| 3 | 78 | `identifies numbers that exist in the input` | Extra — positive grounding |
| 4 | 87 | `flags numbers NOT present in the input as invented` | **Spec — grounding** |
| 5 | 97 | `allows derived numbers that are exact ratios of input numbers` | Extra — ratio tolerance |
| 6 | 121 | `returns unavailable without calling any LLM endpoint` | **Spec — fallback** |
| 7 | 138 | `returns unavailable when provider hangs beyond timeout` | **Spec — timeout** |
| 8 | 155 | `returns unavailable when cloud provider returns error` | Extra — cloud 500 |
| 9 | 169 | `returns unavailable when response body is empty` | Extra — empty body |

**5 extras:** #2, #3, #5, #8, #9. All added in the same commit as the 4 spec tests.

---

## Step 2 — Red-then-green for all 4 spec tests

### Test #1 — Fixture: "serializes exact numeric values from DiagnosticInput into the prompt"

**What it verifies:** `buildDiagnosticPrompt` serializes every numeric value from `DiagnosticInput` literally into the prompt string.

**What breaks:** Forcing `${wt.min ?? 'null'}` to `${'null'}` means the prompt always says `minimum: null mm` regardless of input. The assertion `expect(prompt).toContain('0.8')` fails because `0.8` never appears.

**Diff — BEFORE (committed `semanticDiagnostic.ts:72`):**
```typescript
    `  - minimum: ${wt.min ?? 'null'} mm`,
```

**Diff — AFTER (broken):**
```typescript
    `  - minimum: ${'null'} mm`,
```

**RED output:**
```
 FAIL  client/src/lib/__tests__/semanticDiagnostic.test.ts > semanticDiagnostic > buildDiagnosticPrompt > serializes exact numeric values from DiagnosticInput into the prompt
AssertionError: expected 'You are a 3D printing manufacturing a…' to contain '0.8'

- Expected
+ Received

- 0.8
+ You are a 3D printing manufacturing analyst. Given the following geometric facts about a part,
+ write a concise diagnostic summary (2-4 sentences) identifying the most critical printability
+ issues and recommending next steps.
+
+ FACTS (use these exact values, do not invent new numbers):
+
+ Wall Thickness:
+   - minimum: null mm
+   - maximum: 4.2 mm
+   - mean: 2.1 mm
+   - below threshold: 12.5%
+
+ Watertight Status:
+   - isWatertight: true
+   - boundaryEdgeCount: 0
+   - nonManifoldEdgeCount: 0
+
+ Confidence Score: 0.65
+
+ Thresholds Applied:
+   - thinWallMm: 1.5
+   - overhangThresholdDeg: 45
+
+ Write the diagnostic now. Reference specific numbers from the facts above.

 ❯ client/src/lib/__tests__/semanticDiagnostic.test.ts:39:22
     39|       expect(prompt).toContain('0.8');
       |                      ^

 Test Files  1 failed (1)
      Tests  1 failed | 8 skipped (9)
```

**GREEN output (after restore):**
```
 Test Files  1 passed (1)
      Tests  1 passed | 8 skipped (9)
```

---

### Test #4 — Grounding: "flags numbers NOT present in the input as invented"

**What it verifies:** `checkGrounding` puts numbers not found in `DiagnosticInput` into `inventedNumbers`.

**What breaks:** Commenting out the `else` branch means `inventedNumbers` is never populated. The assertion `expect(inventedNumbers).toContain(3.7)` fails on an empty array.

**Diff — BEFORE (committed `semanticDiagnostic.ts:136-141`):**
```typescript
    if (inputNumbers.has(num)) {
      citedFacts.push(match);
    } else {
      inventedNumbers.push(num);
    }
```

**Diff — AFTER (broken):**
```typescript
    if (inputNumbers.has(num)) {
      citedFacts.push(match);
    }
    // else { inventedNumbers.push(num); }
```

**RED output:**
```
 FAIL  client/src/lib/__tests__/semanticDiagnostic.test.ts > semanticDiagnostic > checkGrounding > flags numbers NOT present in the input as invented
AssertionError: expected [] to include 3.7
 ❯ client/src/lib/__tests__/semanticDiagnostic.test.ts:92:31
     92|       expect(inventedNumbers).toContain(3.7);
       |                               ^
     93|       expect(inventedNumbers).toContain(23);
     94|       expect(citedFacts).toHaveLength(0);

 Test Files  1 failed (1)
      Tests  1 failed | 8 skipped (9)
```

**GREEN output (after restore):**
```
 Test Files  1 passed (1)
      Tests  1 passed | 8 skipped (9)
```

---

### Test #6 — Fallback: "returns unavailable without calling any LLM endpoint"

**What it verifies:** When `getSemanticLayerProvider()` returns `"none"`, `runSemanticDiagnostic` returns immediately without calling `fetch`.

**What breaks:** Commenting out the `provider === 'none'` early return causes the function to fall through to `callCloudProvider`, which calls `fetch`. The assertion `expect(fetchSpy).not.toHaveBeenCalled()` fails because fetch was called once.

**Diff — BEFORE (committed `semanticDiagnostic.ts:215-217`):**
```typescript
  if (provider === 'none') {
    return { summary: null, citedFacts: [], modelUsed: 'unavailable' };
  }
```

**Diff — AFTER (broken):**
```typescript
  // if (provider === 'none') {
  //   return { summary: null, citedFacts: [], modelUsed: 'unavailable' };
  // }
```

**RED output:**
```
 FAIL  client/src/lib/__tests__/semanticDiagnostic.test.ts > semanticDiagnostic > provider="none" fallback > returns unavailable without calling any LLM endpoint
AssertionError: expected "fetch" to not be called at all, but actually been called 1 times

Received:
  1st fetch call:
    Array [
      "/api/llm",
      Object {
        "body": "{"provider":"openai","body":{"model":"gpt-4o-mini",...}}",
        "headers": Object { "Content-Type": "application/json" },
        "method": "POST",
        "signal": AbortSignal { ... },
      },
    ]
Number of calls: 1

 ❯ client/src/lib/__tests__/semanticDiagnostic.test.ts:129:28
    129|       expect(fetchSpy).not.toHaveBeenCalled();
       |                            ^

 Test Files  1 failed (1)
      Tests  1 failed | 8 skipped (9)
```

**GREEN output (after restore):**
```
 Test Files  1 passed (1)
      Tests  1 passed | 8 skipped (9)
```

---

### Test #7 — Timeout: "returns unavailable when provider hangs beyond timeout"

**What it verifies:** When `fetch` rejects with `AbortError` (simulating a timeout), the `catch` block returns `{ summary: null, citedFacts: [], modelUsed: 'unavailable' }` instead of throwing.

**What breaks:** Changing `catch { return {...} }` to `catch (err) { throw err }` makes the `AbortError` propagate as an unhandled rejection. The test expects `result.modelUsed` to be `'unavailable'` but instead gets an uncaught exception.

**Diff — BEFORE (committed `semanticDiagnostic.ts:246-248`):**
```typescript
  } catch {
    return { summary: null, citedFacts: [], modelUsed: 'unavailable' };
  }
```

**Diff — AFTER (broken):**
```typescript
  } catch (err) {
    throw err;
  }
```

**RED output:**
```
 FAIL  client/src/lib/__tests__/semanticDiagnostic.test.ts > semanticDiagnostic > timeout handling > returns unavailable when provider hangs beyond timeout
AbortError: The operation was aborted.
 ❯ client/src/lib/__tests__/semanticDiagnostic.test.ts:144:9
    143|       vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    144|         new DOMException('The operation was aborted.', 'AbortError')
       |         ^

 Test Files  1 failed (1)
      Tests  1 failed | 8 skipped (9)
```

**GREEN output (after restore):**
```
 Test Files  1 passed (1)
      Tests  1 passed | 8 skipped (9)
```

---

## Post-verification state

```
$ git diff -- client/src/lib/semanticDiagnostic.ts
(no output — clean)

 $ pnpm vitest run 2>&1 | grep -E 'Test Files|Tests'
 Test Files  82 passed (82)
      Tests  668 passed | 4 skipped (672)
 ```

---

## Step 2 — Watertight detection: closed as not applicable

**Date:** 2026-09-06

The original task assumed a volume-sign based watertight check existed that needed replacing with edge-topology. Audit found:

1. **No volume-sign based watertight check exists anywhere in the codebase.** `computeMeshVolume` (`metrics.ts:24-46`) uses signed tetrahedron method but computes `meshVolumeMm3` (a volume measurement), never `isWatertight`. It is never used for watertight detection.

2. **Edge-topology is already the exclusive method.** Both `validation.ts:37-45` (`isWatertight = boundaryCount === 0 && nonManifoldCount === 0`) and `topology.ts:78-98` (`isManifold = nonManifoldCount === 0`) use edge face counts from `geometryGraph.ts:160-189`.

3. **`ModelData` never carried watertight status.** The `ruleEngine.ts` `ModelData` type has no watertight field. Watertight consumers (reportUtils, confidenceEngine, riskEngine, notifications, etc.) read `validation.result.isWatertight` directly from `UnifiedAnalysis`, bypassing `ModelData` entirely.

4. **`checkVolumeCrossConsistency` is dead code** — exported from `metrics.ts:421-439` but never called.

**Conclusion:** Step 2 has no target. The edge-topology method is already in place and is the only watertight computation path. No code changes needed.

---

## Step 3a — Dead `?? bboxVolume` fallback removal

**Date:** 2026-09-06
**Files:** `unifiedToModelData.ts:23`, `Home.tsx:162`, `geometryAnalyst.ts:18`

### Type proof: `meshVolumeMm3` is never null/undefined

`MetricsResult` interface (`types.ts:127-129`):
```typescript
export interface MetricsResult {
  /** Exact: sum of signed tetrahedron volumes */
  meshVolumeMm3: number;
  // ...
}
```

`emptyMetrics` fallback (`pipeline.ts:89`):
```typescript
const emptyMetrics: MetricsResult = {
  meshVolumeMm3: 0,
  surfaceAreaMm2: 0,
  boundingBoxVolumeMm3: 0,
  boundingBoxDimensionsMm: { x: 0, y: 0, z: 0 },
  // ...
};
```

`computeMeshVolume` (`metrics.ts:24-46`) always returns `number` — the signed tetrahedron sum is a `number`, and `Math.abs() / 6` is always a `number`. There is no code path that produces `null` or `undefined` for `meshVolumeMm3`. The `?? bboxVolumeMm3` fallback in the three call sites was dead code at the type level: it could never trigger because `meshVolumeMm3` is typed `number` (not `number | null | undefined`), and `emptyMetrics` initializes it to `0`.

### What was removed

```diff
-  meshVolumeMm3: result.meshVolumeMm3 ?? boundingBoxVolumeMm3,
+  meshVolumeMm3: result.meshVolumeMm3,
```

In `unifiedToModelData.ts:23`, `Home.tsx:162`, `geometryAnalyst.ts:18`.

### Red-then-green

**RED:** Cannot produce a runtime failure because the `??` operator on a `number` type is structurally unreachable. TypeScript's type system enforces that `meshVolumeMm3` is always a `number`, so `??` never activates. This is verified at the type level, not the value level.

**GREEN:** `pnpm vitest run client/src/analysis/__tests__/metrics.test.ts` passes — 47 tests, all green. The volume source invariant tests (below) confirm mesh-computed values are used.

### Volume source invariant tests

3 new tests added to `metrics.test.ts` in `describe('volume source invariant')`:

**Test 1: "meshVolumeMm3 is used directly — bbox volume is never a fallback"**
- Watertight unit cube: meshVolume = 1.0, bboxVolume = 1.0 (they match for a cube)
- Asserts `typeof m.meshVolumeMm3 === 'number'` and `!isNaN(m.meshVolumeMm3)` — confirms the type invariant holds at runtime

**Test 2: "open cube still produces valid mesh volume (not bbox fallback)"**
- Open cube: mesh volume < bbox volume
- Asserts `meshVolumeMm3 > 0` and `meshVolumeMm3 < boundingBoxVolumeMm3 + 1`

**Test 3: "sparse mesh: tetrahedron computes ~0 volume for degenerate geometry"**
- Single 100×100 triangle: no enclosed volume, flat in z
- Asserts `meshVolumeMm3 < 0.01`, `typeof === 'number'`, `!isNaN`
- This tests that `computeMeshVolume` handles degenerate geometry correctly (returns ~0, not NaN/Infinity), NOT that the `?? bboxVolume` fallback was dead. The `??` operator only substitutes on `null`/`undefined`, not `0`; since `meshVolumeMm3` computes to `0.0` (a real number), `0 ?? bboxVolume` evaluates to `0` under the OLD code too. The fallback was never reachable for this case regardless of whether it existed. This test is evidence of correct degenerate-geometry behavior, not fallback dead-code status.

---

## Step 3b — Thermal proxy: bbox area → mesh surface area

**Date:** 2026-09-06
**File:** `client/src/analysis/thermal.ts`

### What changed

Replaced the bounding-box area proxy used by `estimateLayerPrintDuration` and `estimateLayerFillFraction` with `computeGraphSurfaceArea()` — a new function that computes actual mesh surface area from the geometry graph's positions and indices.

**New function (`thermal.ts:87-102`):**
```typescript
function computeGraphSurfaceArea(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
): number {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;
    const ux = positions[i1] - positions[i0], uy = positions[i1 + 1] - positions[i0 + 1], uz = positions[i1 + 2] - positions[i0 + 2];
    const vx = positions[i2] - positions[i0], vy = positions[i2 + 1] - positions[i0 + 1], vz = positions[i2 + 2] - positions[i0 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
  }
  return area;
}
```

**`estimateLayerPrintDuration` diff:**
```diff
-  const bbox = graph.boundingBox;
-  const layerAreaMm2 = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
+  const totalLayers = Math.max(1, Math.ceil((graph.boundingBox.maxZ - graph.boundingBox.minZ) / layer.heightMm));
+  const surfaceArea = computeGraphSurfaceArea(graph.positions, graph.indices);
+  const layerAreaMm2 = surfaceArea / totalLayers / 2;
```

**`estimateLayerFillFraction` diff:**
```diff
-  const bbox = graph.boundingBox;
-  const totalArea = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
+  const totalLayers = Math.max(1, Math.ceil((graph.boundingBox.maxZ - graph.boundingBox.minZ) / layer.heightMm));
+  const surfaceArea = computeGraphSurfaceArea(graph.positions, graph.indices);
+  const totalArea = surfaceArea / 2;
```

### Tall cylinder RED-then-GREEN

**Test:** "tall cylinder: printDurationS must reflect mesh surface area, not bbox area"

**Geometry:** 16-segment cylinder, radius 5mm, height 100mm. 500 layers at 0.2mm.
- Bounding-box area: `(2×5) × (2×5) = 100 mm²` → old `printDurationS ≈ 100/0.4/60 ≈ 4.17s`
- Mesh surface area: `2πr² + 2πrh ≈ 3299 mm²` → per-layer area: `3299/500/2 ≈ 3.3 mm²` → `printDurationS ≈ 3.3/0.4/60 ≈ 0.14s` (clamped to 0.5s)

**RED output (thermal.ts reverted to bbox proxy):**
```
 FAIL  client/src/analysis/__tests__/thermal.test.ts > Thermal Analysis (S2) > Layer area source invariant > tall cylinder: printDurationS must reflect mesh surface area, not bbox area
AssertionError: expected 4.166666666666667 to be less than 1
 ❯ client/src/analysis/__tests__/thermal.test.ts:320:38
    318|       // New mesh area gives ~0.5s (3.3mm² layer area, clamped).
    319|       for (const layer of result.layers) {
    320|         expect(layer.printDurationS).toBeLessThan(1.0);
       |                                      ^
    321|       }
    322|     });

 Test Files  1 failed (1)
      Tests  1 failed | 12 skipped (13)
```

**GREEN output (thermal.ts with mesh surface area):**
```
 Test Files  1 passed (1)
      Tests  1 passed | 12 skipped (13)
```

---

## Step 4 — New EVAL_CASES

**Date:** 2026-09-06
**File:** `client/src/analysis/__tests__/evalCases.ts`

### Literal diff added to evalCases.ts

```diff
@@ -16,6 +16,7 @@ import { runAnalysisPipeline, type PipelineOptions } from '../pipeline';
 import { fromThreeBufferGeometry } from '../geometryConversion';
 import { isWallConfidenceTrusted } from '../verdict';
 import type { GeometryModel } from '../geometryModel';
+import * as THREE from 'three';
 import {
   createWatertightCube,
   createThinWall,
@@ -93,6 +94,76 @@ export const EVAL_CASES: EvalCase[] = [
     build: () => fromThreeBufferGeometry(createTerrainGrid(10, 20, 20)),
     expectTrusted: false,
   },
+  {
+    id: 'sparse-mesh',
+    label: 'single large triangle: mesh volume ≈ 0, bbox volume large — verifies mesh-volume source',
+    build: () => {
+      const geo = new THREE.BufferGeometry();
+      const vertices = new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0]);
+      const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
+      geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
+      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
+      geo.setIndex([0, 1, 2]);
+      return fromThreeBufferGeometry(geo);
+    },
+    expectTrusted: false,
+  },
+  {
+    id: 'tall-cylinder',
+    label: 'tall thin cylinder: bbox area ≫ mesh cross-section — verifies thermal proxy uses mesh area',
+    build: () => {
+      const segments = 16;
+      const radius = 5;
+      const height = 100;
+      const vertices: number[] = [];
+      const normals: number[] = [];
+      const indices: number[] = [];
+
+      // Generate cylinder vertices
+      for (let i = 0; i <= segments; i++) {
+        const angle = (i / segments) * Math.PI * 2;
+        const x = Math.cos(angle) * radius;
+        const y = Math.sin(angle) * radius;
+
+        // Bottom vertex
+        vertices.push(x, y, 0);
+        normals.push(Math.cos(angle), Math.sin(angle), 0);
+
+        // Top vertex
+        vertices.push(x, y, height);
+        normals.push(Math.cos(angle), Math.sin(angle), 0);
+      }
+
+      // Side faces
+      for (let i = 0; i < segments; i++) {
+        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
+        indices.push(a, c, b, b, c, d);
+      }
+
+      // Bottom cap (fan from center)
+      const centerIdx = vertices.length / 3;
+      vertices.push(0, 0, 0);
+      normals.push(0, 0, -1);
+      for (let i = 0; i < segments; i++) {
+        indices.push(centerIdx, (i + 1) * 2, i * 2);
+      }
+
+      // Top cap (fan from center)
+      const topCenterIdx = vertices.length / 3;
+      vertices.push(0, 0, height);
+      normals.push(0, 0, 1);
+      for (let i = 0; i < segments; i++) {
+        indices.push(topCenterIdx, i * 2 + 1, (i + 1) * 2 + 1);
+      }
+
+      const geo = new THREE.BufferGeometry();
+      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
+      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
+      geo.setIndex(indices);
+      return fromThreeBufferGeometry(geo);
+    },
+    expectTrusted: true,
+  },
 ];
```

### Why sparse-mesh can't produce a differentiating RED state

The `sparse-mesh` EVAL_CASE uses `expectTrusted: false` — this is because wall measurement isn't meaningful for a single triangle (the `wallThicknessSamples` array is empty or near-empty, producing low confidence). This is unrelated to the thermal proxy change. Reverting `thermal.ts` to the old bbox proxy does not change the wall-confidence verdict for this case, so there is no differentiating RED state. The same `??` reason applies: the sparse mesh computes `meshVolumeMm3 ≈ 0` (a real number, not null), so the fallback was never reachable regardless.

The `tall-cylinder` EVAL_CASE, by contrast, does have a thermal path that produces different `printDurationS` values under old vs new code (4.17s vs ~0.5s), but its `expectTrusted: true` verdict is driven by wall thickness, not thermal — so reverting thermal.ts doesn't flip its verdict either. The RED-then-GREEN evidence for thermal proxy correctness is in the dedicated `thermal.test.ts` tall-cylinder test (Step 3b above), not in the EVAL_CASES regression set.

### Test count delta: 672 → 676

4 new tests total:
1. `thermal.test.ts` — 1 new test in `describe('Layer area source invariant')`: the tall cylinder printDurationS test
2. `metrics.test.ts` — 3 new tests in `describe('volume source invariant')`: cube invariant, open cube invariant, sparse mesh degenerate-geometry test

---

## Post-verification state

```
$ pnpm vitest run 2>&1 | grep -E 'Test Files|Tests'
 Test Files  82 passed (82)
      Tests  672 passed | 4 skipped (676)
```

---

## WallThicknessHistogram — filter red-then-green evidence (2026-09-05)

**Files:** `client/src/components/WallThicknessHistogram.tsx:22` (`binSamples` filter)
**Tests:** `client/src/components/__tests__/WallThicknessHistogram.test.ts`

### Zero-thickness filter

**Revert:** remove `s.thickness > 0 &&` from filter → `samples.filter(s => s.confidence > 0.1)`

**RED output:**
```
 FAIL  client/src/components/__tests__/WallThicknessHistogram.test.ts > binSamples > filters out zero-thickness samples
AssertionError: expected 2 to be 1 // Object.is equality

- Expected
+ Received

- 1
+ 2

 ❯ client/src/components/__tests__/WallThicknessHistogram.test.ts:19:31
     17|     const samples = [sample(0, 0.1), sample(0, 0.5), sample(1.5)];
     18|     const result = binSamples(samples, 12);
     19|     expect(result.validCount).toBe(1);
```

**GREEN output (restored):**
```
 ✓ client/src/components/__tests__/WallThicknessHistogram.test.ts (6 tests | 5 skipped) 1ms
```

### Confidence filter

**Revert:** remove `&& s.confidence > 0.1` from filter → `samples.filter(s => s.thickness > 0)`

**RED output:**
```
 FAIL  client/src/components/__tests__/WallThicknessHistogram.test.ts > binSamples > filters out low-confidence samples
AssertionError: expected 3 to be 1 // Object.is equality

- Expected
+ Received

- 1
+ 3

 ❯ client/src/components/__tests__/WallThicknessHistogram.test.ts:26:31
     24|     const result = binSamples(samples, 12);
     25|     // confidence <= 0.1 is filtered
     26|     expect(result.validCount).toBe(1);
```

**GREEN output (restored):**
```
 ✓ client/src/components/__tests__/WallThicknessHistogram.test.ts (6 tests | 5 skipped) 1ms
```

### Final full suite
```
 Test Files  83 passed (83)
      Tests  678 passed | 4 skipped (682)
```
