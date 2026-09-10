# Reflections

## 2026-09-10 — estimate fixes + auto-orient coplanarity (wall_tower)

**Commits:** `ea8729e4` fix(estimate), `beb521ec` fix(auto-orient). Human reviewed the full diff before commit; new tests were additionally verified bidirectional (fail on stashed old code, pass on new).

### Checkpoint 1: "autoOrient doesn't fire" (wrong)

**Claimed:** After reading `autoOrientGeometry` and hand-computing face areas, I ran a node repro (three.js STLLoader + autoOrient on wall_tower.stl) showing BEFORE (60,20,28) → AFTER (60,20,28), and concluded the rotation must happen elsewhere.

**Reality:** The repro was unfaithful — the app parses via its own indexed `parseSTL` + `computeVertexNormals` smoothing, while STLLoader yields non-indexed geometry with face normals. The flatness sampling reads vertex normals, so the two paths diverge. The faithful repro (project `parseSTL` → `normalizeModelGeometry` → `autoOrientGeometry`) showed (60,20,28) → (28,20,60), confirming autoOrient as the culprit.

**Root cause:** I optimized for a quick repro over a faithful one, even though the suspect code's input (smoothed indexed normals) was the entire point. A negative result from a shortcut repro was treated as exoneration.

**Prevention:** When a repro contradicts production behavior, distrust the repro first — replicate the exact production call chain (imports included) before looking elsewhere.

### Checkpoint 2: first coplanarity version over-rotated plain boxes

**Claimed:** "Largest coplanar patch wins" fix complete with 5 new tests.

**Diff/tests showed:** 2 of 5 new tests failed — a flat 60×20×28 box was tipped onto its 60×28 side (largest face down is "more stable" but gratuitous churn that breaks CAD-dim agreement, the exact complaint class being fixed).

**Root cause:** Maximizing without a no-op guard; no control case (already-flat input) in the first test run.

**Prevention:** Any rotation/orientation logic ships with no-op control cases (flat box, cube) from the first iteration, not added after failures — caught here by my own tests, but only because I wrote them before declaring done.

### Checkpoint 3: numpy stride bug in raw-STL ground-truth script

**Claimed (implicitly):** Throwaway verification script output.

**Reality:** First version mis-sliced the binary STL (ignored the 2-byte attribute + normal prefix), printing absurd ±1e30 ranges. Caught immediately because the numbers were physically impossible; rewrote with `struct`.

**Root cause:** None deep — but worth logging: sanity-check throwaway script output against known truth (CAD says 60×20×28) before reasoning from it.

### Summary

Three gaps, all self-caught before commit (one by contradiction, one by new tests, one by physical plausibility). The pattern across all three: acting on unchecked intermediate outputs. The bidirectional stash/pop test gate worked as designed — 9 estimate tests + 2 auto-orient tests fail on old code, pass on new.

## 2026-08-29 — bbox-merge consolidation

**Files changed:** geometryGraph.ts, geometryData.ts, wallThickness.ts, metrics.ts, pipeline.ts

### Checkpoint 1: "4 steps done" after initial implementation

**Claimed:** All 4 bbox-merge steps complete — graph exports diagonal, wallThickness reads from graph, extractVertexData accepts graph, pipeline uses metrics.result.

**Diff showed:**
- `metrics.ts` L323-326 still computed `dimX`/`dimY`/`dimZ` from `g.boundingBox` fields and then manually squared-and-rooted to get `bboxDiagonal` — exactly the redundant computation the task was supposed to eliminate. `geometryGraph.ts` already exported `g.boundingBoxDiagonal` but `metrics.ts` never read it.
- `sampleWallThickness` was called with both `maxRayDist = bboxDiagonal * factor` and `graph = g`. Since `maxRayDist` was always provided, the `??` fallback inside `sampleWallThickness` that uses `graph.boundingBoxDiagonal` was dead code. The `graph` parameter was added but never exercised on the main code path.

**Root cause:** I focused on the four explicit steps in the task description and treated "pass graph to sampleWallThickness" as equivalent to "eliminate the redundant computation." I did not trace the actual data flow to verify that the graph parameter would be reached. Type check passing was treated as proof of correctness.

**Prevention:** After adding a parameter to a function, trace at least one concrete call site to confirm the new parameter is actually consumed, not just forwarded past an already-satisfied conditional.

### Checkpoint 2: "两处都该改" but only one fixed

**Claimed:** Both issues fixed — manual bbox diagonal replaced with `g.boundingBoxDiagonal`, and `maxRayDist` argument removed from sampleWallThickness call.

**Diff showed:**
- The `maxRayDist` argument was changed from `bboxDiagonal * factor` to `undefined` — correct.
- But `const bboxDiagonal = g.boundingBoxDiagonal` (the now-unused variable) was still declared on the line above. I removed the old 5-line block but left behind the variable I had just added two edits earlier.
- The second fix (removing `maxRayDist`) was correct. The missed cleanup (dead `bboxDiagonal` variable) was a minor but real gap.

**Root cause:** I treated "fix the logic" and "clean up the dead variable" as separate mental steps, then stopped after the logic fix without verifying the surrounding code for orphaned declarations.

**Prevention:** After any edit, re-read the 10-line neighborhood of the changed region and remove any declarations that no longer have readers.

### Summary

Two gaps in a 5-file task. Both were caught by the human, not by self-review. The type check passing (`pnpm run check` clean) provided false confidence — it validates type compatibility, not whether a parameter is actually used or a variable is actually read.
