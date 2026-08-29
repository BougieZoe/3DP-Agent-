# Reflections

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
