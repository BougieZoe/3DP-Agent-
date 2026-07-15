# Telemetry Analysis Report — "When Should BVH Be Enabled?"

Generated: 2026-07-15

## Methodology

Analysis pipeline profiling data is captured via `client/src/lib/telemetry.ts` for every
`runAnalysisInWorker` call with `enableProfiling: true`. The key metric is
`sampleWallThickness` as a share of total pipeline time — this is the only module
that BVH acceleration can materially improve (O(N) → O(log N) for ray-triangle testing).

## Baseline Profiling (Synthetic Benchmarks)

These measurements were collected from benchmark tests with known synthetic geometries
(icosphere at varying subdivision levels). They represent the *upper bound* of expected
real-world model complexity.

| Triangles | WallThickness | % of Total | GraphBuild | Total Time |
|-----------|---------------|-----------|------------|------------|
| 1,000     | 12.2 ms       | 41.4%     | 2.4 ms     | 29.4 ms    |
| 10,000    | 105.8 ms      | 35.6%     | 61.7 ms    | 297.1 ms   |
| 100,000   | 454.9 ms      | 38.2%     | 216.6 ms   | 1,191.7 ms |

## When Does BVH Pay Off?

BVH replaces the inner `for (let j = 0; j < indices.length; j += 3)` loop in
`sampleWallThickness` (wallThickness.ts:141) with an O(log N) tree traversal.
Current implementation performs up to 200 sample points × N triangle checks =
~20M ray-triangle tests at 100K triangles.

Projected speedup: ~20× on wall thickness, costing ~50ms one-time BVH build at 100K.

### Decision Matrix

| Model Size Range | Wall Time | BVH Time (est.) | Time Saved | User-Perceptible? | ROI |
|-----------------|-----------|-----------------|------------|-------------------|-----|
| < 1K tri        | < 15 ms   | < 5 ms          | < 10 ms    | No                | None |
| 1K–10K tri      | 15–100 ms | 5–20 ms         | 10–80 ms   | Borderline        | Low |
| 10K–50K tri     | 100–250 ms| 10–30 ms        | 90–220 ms  | Yes (noticeable)  | Medium |
| 50K–100K tri    | 250–450 ms| 15–45 ms        | 235–405 ms | Yes (annoying)    | High |
| > 100K tri      | > 450 ms  | < 60 ms         | > 390 ms   | Yes (blocking)    | Strong |

### Trigger Logic

Based on the data above, the recommended BVH enablement rule is:

```
ENABLE_BVH_IF = p95_triangle_count > 10_000
```

Rationale:
- At p50 (typical model), most users see < 50K tri. Wall thickness at 10K tri is ~100ms —
  fast enough inside a Worker that the user doesn't perceive it.
- At p95 (95th percentile), the heaviest 5% of models drive the worst-case experience.
  If p95 > 10K tri, those users are waiting > 300ms on wall thickness alone.
- At p99, the top 1% of models may be > 100K tri — time savings are absolutely critical.

### How to Assess After Real-World Collection

After the telemetry infrastructure has collected data from real user sessions:

1. Run `getTelemetryAggregation()` to get current p50/p95 values.
2. If `p95AnalysisDuration > 300ms` → BVH is needed now (users are waiting).
3. If `p95TriangleCount < 10_000 && p50AnalysisDuration < 100ms` → defer BVH.
4. If `averageWallThicknessShare > 30%` → BVH is targeting the right bottleneck
   regardless of absolute duration.

### Risk of Not Having BVH

| Metric | Impact |
|--------|--------|
| UI blocked | 0% (Worker solved this) |
| Slow analysis result | 100% — user stares at spinner |
| Battery (mobile) | Moderate — extra CPU burn for O(N²) loop |
| Large-part abandonment | Likely — users drop models > 50K tri |

## Telemetry Infrastructure

All functions in `client/src/lib/telemetry.ts`:

- `captureTelemetry(triCount, profiling)` — called from `printReviewWorkflow.ts:84`
- `getTelemetryAggregation()` → { p50Tri, p95Tri, p50Duration, p95Duration, eventCount }
- `getTelemetryDashboard(limit)` → { totalRuns, avgTri, avgWallShare, slowestAnalyses }
- `getTelemetrySummary()` — human-readable report for console
- `clearTelemetry()` — reset for testing

## Implementation Path

1. **Collect real data** — deploy current build; let telemetry accumulate.
2. **Review after N events** — check `getTelemetryAggregation()` to decide.
3. **Thresholds** (proposed):
   - `p95Duration > 300ms` → BVH (Option A: three-mesh-bvh, ~2 days).
   - `p95Tri > 10_000` → BVH.
   - Otherwise → defer, re-evaluate after N more events.

## Appendix: Wall Thickness Algorithm Complexity

```
sampleWallThickness(positions, indices, maxSamples=200):
  for each sample triangle i (up to 200):
    compute face normal at centroid
    for each triangle j (0..N):          ← O(N) — BVH target
      rayTriangleIntersection(i, j)
```

BVH replaces the inner loop with `bvh.intersectRay(origin, direction)` → O(log N).
