/**
 * Tiered repair flow — extracted from Home.tsx (Agent Contract rule 4).
 *
 * Tier 1: server bridge (pymeshfix, closes holes). Tier 2: browser WASM
 * thin-wall offset, no server. Tier 3: honest stop. A repair that regresses
 * min wall thickness is discarded, never committed.
 *
 * Rule 5 exception (explicit): Home keeps a tiny ref-mirror of the
 * counterfactual suggestions because the handler is declared before the memo.
 * The mirror is 3 lines + 1 effect and is the only Home-side repair code left.
 */
import * as THREE from 'three';
import { fromThreeBufferGeometry, runAnalysisInWorker } from '@/analysis';
import type { UnifiedAnalysis } from '@/analysis/types';
import type { PipelineOptions } from '@/analysis/pipeline';
import type { GeometrySuggestion } from '@/components/causality/counterfactualEngine';
import { processMesh } from './meshProcessClient';
import { applyRepairAsync } from './meshRepair';
import { geometryToStl } from './meshOps';
import { parseSTL } from './stlParser';
import { classifyBridgeError, pickWasmSuggestion } from './repairTiers';

export interface RepairOutcome {
  geometry: THREE.BufferGeometry;
  analysis: UnifiedAnalysis;
  note: string;
}

export async function runTieredRepair(
  geometry: THREE.BufferGeometry,
  fileName: string,
  material: PipelineOptions['material'],
  suggestions: GeometrySuggestion[],
  beforeMin: number | null,
): Promise<RepairOutcome> {
  const analyze = (geo: THREE.BufferGeometry) =>
    runAnalysisInWorker(fromThreeBufferGeometry(geo), { fileName, material });

  try {
    const result = await processMesh(geometryToStl(geometry), {});
    const processed = parseSTL(result.stlBytes);
    processed.computeVertexNormals();
    processed.computeBoundingBox();
    const d = result.diagnostics;
    return {
      geometry: processed,
      analysis: await analyze(processed),
      note: d.repaired
        ? `repaired to watertight · ${d.bodyCount ?? 1} bodies`
        : d.watertight
          ? `mesh OK · ${d.bodyCount ?? 1} bodies`
          : 'processed · repair unavailable',
    };
  } catch (err) {
    if (classifyBridgeError(err) !== 'bridge-absent') throw err;
    const sug = pickWasmSuggestion(suggestions);
    if (!sug) {
      throw new Error(
        'bridge unavailable here — thin-wall-only WASM found nothing to apply; open shells need desktop/server repair',
      );
    }
    const repaired = await applyRepairAsync(geometry, sug);
    const check = await analyze(repaired);
    const afterMin = check.metrics?.result?.minWallThicknessMm ?? null;
    // Guardrail: never hand back a repair that made walls thinner.
    if (beforeMin != null && afterMin != null && afterMin < beforeMin) {
      throw new Error(
        `wasm repair regressed (${beforeMin.toFixed(3)}→${afterMin.toFixed(3)}mm) — discarded, use desktop/server repair`,
      );
    }
    return { geometry: repaired, analysis: check, note: 'wasm thin-wall repair applied · re-analyzed' };
  }
}
