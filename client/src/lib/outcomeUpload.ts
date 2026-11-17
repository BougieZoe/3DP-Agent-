/**
 * Anonymous outcome upload — reserved interface, local-only by default.
 *
 * This module deliberately performs NO network I/O. It defines the payload
 * boundary for a future opt-in aggregation service and a no-op uploader that
 * reports the local-only state honestly.
 *
 * Privacy boundary: the payload excludes the file name, notes, free-text
 * failure description, actual settings, and engineer decision. `fileHash` is a
 * stable pseudonymous identifier (not anonymization): the same bytes can be
 * correlated across runs, but the content itself is never uploaded. Callers
 * must treat this as pseudonymous, not anonymous, data.
 */

import type {
  AnalysisComparison,
  AnalysisRecord,
  FailureType,
  OutcomeStatus,
} from './analysisRecord';

export interface AnonymousOutcomePayload {
  schemaVersion: number;
  fileHash: string;
  format: AnalysisRecord['model']['format'];
  units: string | null;
  context: AnalysisRecord['context'];
  geometry: AnalysisRecord['geometry'];
  score: AnalysisRecord['score'];
  overallConfidence: number;
  outcome: {
    status: OutcomeStatus;
    failureLayer: number | null;
    failureType: FailureType | null;
    recordedAt: string | null;
  };
  repair: {
    derivedFromRecordId: string | null;
    geometricChange: AnalysisComparison['geometricChange'];
    claimBoundary: string;
  } | null;
}

export type OutcomeUploadResult =
  | { ok: true; remoteId?: string }
  | { ok: false; reason: 'local-only' | 'network' | 'rejected'; detail?: string };

export interface OutcomeUploader {
  upload(payload: AnonymousOutcomePayload): Promise<OutcomeUploadResult>;
}

/** Default: keep everything local. Never becomes a network call silently. */
export const localOnlyOutcomeUploader: OutcomeUploader = {
  async upload() {
    return { ok: false, reason: 'local-only' };
  },
};

/**
 * Project a full local record onto the shareable payload. Free text and the
 * file name are dropped here — this is the only place that decides what may
 * leave the device.
 */
export function toAnonymousOutcome(record: AnalysisRecord): AnonymousOutcomePayload {
  return {
    schemaVersion: record.schemaVersion,
    fileHash: record.model.fileHash,
    format: record.model.format,
    units: record.model.units,
    context: { ...record.context },
    geometry: { ...record.geometry },
    score: { ...record.score },
    overallConfidence: record.overallConfidence,
    outcome: {
      status: record.outcome.status,
      failureLayer: record.outcome.failureLayer,
      failureType: record.outcome.failureType,
      recordedAt: record.outcome.recordedAt,
    },
    repair: record.repair
      ? {
          derivedFromRecordId: record.repair.derivedFromRecordId,
          geometricChange: record.repair.comparison.geometricChange,
          claimBoundary: record.repair.comparison.claimBoundary,
        }
      : null,
  };
}

export async function uploadOutcomeAnonymous(
  record: AnalysisRecord,
  uploader: OutcomeUploader = localOnlyOutcomeUploader,
): Promise<OutcomeUploadResult> {
  try {
    return await uploader.upload(toAnonymousOutcome(record));
  } catch (err) {
    return {
      ok: false,
      reason: 'network',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
