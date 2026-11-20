/**
 * Analysis Run Recorder — one AnalysisRecord per analysis RUN.
 *
 * The upload handler and every re-analysis path call this so the report on
 * screen always has a record id to attach an observed outcome to. A new run
 * (material change, units change, repair) gets a new id; nothing is merged
 * into a previous record.
 *
 * Persistence is local-only (IndexedDB via analysisHistory). A storage failure
 * returns null and never fails the analysis itself.
 */

import type { UnifiedAnalysis } from '@/analysis/types';
import type { Material } from '@shared/domain/material';
import type { LengthUnit } from '@shared/domain/geometry';
import {
  buildAnalysisRecord,
  type AnalysisRecord,
  type SlicerProvenance,
} from './analysisRecord';
import { getAnalysisHistory, type RecordStore } from './analysisHistory';

export interface SaveAnalysisRunInput {
  analysis: UnifiedAnalysis;
  fileName: string;
  /** SHA-256 hex of the uploaded bytes. Empty/missing → not recordable. */
  fileHash: string;
  fileSizeBytes?: number | null;
  units?: LengthUnit | null;
  material?: Material | null;
  materialFamily?: string | null;
  printerId?: string | null;
  layerHeightMm?: number | null;
  process?: string | null;
  slicer?: SlicerProvenance | null;
  repair?: {
    derivedFromRecordId: string | null;
    note: string;
    before: UnifiedAnalysis;
  } | null;
  /** Injectable for tests. */
  store?: RecordStore;
  id?: string;
  createdAt?: string;
}

export interface SavedAnalysisRun {
  id: string;
  record: AnalysisRecord;
}

/**
 * Build and persist a record for this analysis run. Returns null when the run
 * cannot be identified (no fingerprint) or persistence is unavailable — the
 * caller must then show the honest "not recordable" state, never invent an id.
 */
export async function saveAnalysisRun(
  input: SaveAnalysisRunInput,
): Promise<SavedAnalysisRun | null> {
  if (!input.fileHash) return null;
  try {
    const record = buildAnalysisRecord({
      analysis: input.analysis,
      fileName: input.fileName,
      fileHash: input.fileHash,
      fileSizeBytes: input.fileSizeBytes ?? null,
      units: input.units ?? null,
      context: {
        material: input.material?.name ?? null,
        materialFamily: input.materialFamily ?? input.material?.technology ?? null,
        printerId: input.printerId ?? null,
        layerHeightMm: input.layerHeightMm ?? null,
        process: input.process ?? null,
      },
      slicer: input.slicer ?? null,
      repair: input.repair ?? null,
      id: input.id,
      createdAt: input.createdAt,
    });
    const store = input.store ?? getAnalysisHistory();
    await store.save(record);
    // Verify the write landed: the record id is only useful if the outcome
    // card can later read it back. A swallowed storage failure must surface as
    // "not recordable", never as a dangling id.
    const persisted = await store.get(record.id);
    if (!persisted) return null;
    return { id: record.id, record };
  } catch {
    return null;
  }
}
