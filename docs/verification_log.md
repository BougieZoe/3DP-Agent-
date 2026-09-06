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
