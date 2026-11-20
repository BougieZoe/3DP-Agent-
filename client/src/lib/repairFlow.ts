/**
 * Tiered repair flow — extracted from Home.tsx (Agent Contract rule 4).
 *
 * Tier 1: server bridge (pymeshfix, closes holes). Tier 2: browser WASM
 * thin-wall offset (manifold solid offset, with a normal-offset fallback).
 * Tier 3: honest stop. Any measured regression discards the repair; a
 * fallback is never trusted without the same re-measurement gate.
 *
 * Rule 5 exception (explicit): Home keeps a tiny ref-mirror of the
 * counterfactual suggestions because the handler is declared before the memo.
 * The mirror is 3 lines + 1 effect and is the only Home-side repair code left.
 */
import * as THREE from 'three';
import { fromThreeBufferGeometry } from '@/analysis';
import { analyzeWithTelemetry } from './analysisProfiling';
import type { UnifiedAnalysis } from '@/analysis/types';
import type { PipelineOptions } from '@/analysis/pipeline';
import type { GeometrySuggestion } from '@/components/causality/counterfactualEngine';
import { processMesh } from './meshProcessClient';
import { applyRepairWithMethodAsync, type RepairMethod } from './meshRepair';
import { geometryToStl } from './meshOps';
import { parseSTL } from './stlParser';
import { classifyBridgeError, pickWasmSuggestion } from './repairTiers';
import { verifyRepair, type RepairVerification } from './repairVerification';

export interface RepairOutcome {
  /** Geometry to commit. On a rejected repair this is the ORIGINAL geometry. */
  geometry: THREE.BufferGeometry;
  /** Analysis matching the returned geometry (original when rejected). */
  analysis: UnifiedAnalysis;
  note: string;
  accepted: boolean;
  verification: RepairVerification;
  tier: 'server' | 'wasm';
  /** Which WASM implementation produced the candidate; null for server tier. */
  repairMethod: RepairMethod | null;
}

function rejected(
  original: THREE.BufferGeometry,
  before: UnifiedAnalysis,
  verification: RepairVerification,
  tier: RepairOutcome['tier'],
  repairMethod: RepairMethod | null = null,
): RepairOutcome {
  return {
    geometry: original,
    analysis: before,
    note: verification.summary,
    accepted: false,
    verification,
    tier,
    repairMethod,
  };
}

export async function runTieredRepair(
  geometry: THREE.BufferGeometry,
  fileName: string,
  material: PipelineOptions['material'],
  suggestions: GeometrySuggestion[],
  beforeAnalysis: UnifiedAnalysis,
): Promise<RepairOutcome> {
  const analyze = (geo: THREE.BufferGeometry) =>
    analyzeWithTelemetry(fromThreeBufferGeometry(geo), { fileName, material });

  try {
    const result = await processMesh(geometryToStl(geometry), {});
    const processed = parseSTL(result.stlBytes);
    processed.computeVertexNormals();
    processed.computeBoundingBox();
    const d = result.diagnostics;
    const analysis = await analyze(processed);
    const verification = verifyRepair(beforeAnalysis, analysis);
    if (!verification.accepted) {
      return rejected(geometry, beforeAnalysis, verification, 'server');
    }
    const baseNote = d.repaired
      ? `repaired to watertight · ${d.bodyCount ?? 1} bodies`
      : d.watertight
        ? `mesh OK · ${d.bodyCount ?? 1} bodies`
        : 'processed · repair unavailable';
    return {
      geometry: processed,
      analysis,
      note: `${baseNote} · ${verification.summary}`,
      accepted: true,
      verification,
      tier: 'server',
      repairMethod: null,
    };
  } catch (err) {
    if (classifyBridgeError(err) !== 'bridge-absent') throw err;
    const sug = pickWasmSuggestion(suggestions);
    if (!sug) {
      throw new Error(
        'bridge unavailable here — thin-wall-only WASM found nothing to apply; open shells need desktop/server repair',
      );
    }
    const { geometry: repaired, method } = await applyRepairWithMethodAsync(geometry, sug);
    const analysis = await analyze(repaired);
    const verification = verifyRepair(beforeAnalysis, analysis);
    if (!verification.accepted) {
      return rejected(geometry, beforeAnalysis, verification, 'wasm', method);
    }
    const methodLabel = method === 'manifold-offset' ? 'manifold offset' : 'normal fallback';
    return {
      geometry: repaired,
      analysis,
      note: `wasm thin-wall repair applied (${methodLabel}) · ${verification.summary}`,
      accepted: true,
      verification,
      tier: 'wasm',
      repairMethod: method,
    };
  }
}
