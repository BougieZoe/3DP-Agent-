/**
 * Anonymous outcome upload boundary tests.
 *
 * Rules under test:
 *  1. The payload never contains the file name, notes, free-text failure mode,
 *     actual settings, or engineer decision.
 *  2. The default uploader performs no network I/O and reports local-only.
 *  3. A caller-supplied uploader receives the same sanitized payload.
 *  4. Uploader errors are reported, never thrown into the save flow.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { UnifiedAnalysis } from '@/analysis/types';
import { buildAnalysisRecord, type AnalysisRecord } from '../analysisRecord';
import {
  localOnlyOutcomeUploader,
  toAnonymousOutcome,
  uploadOutcomeAnonymous,
  type AnonymousOutcomePayload,
  type OutcomeUploader,
} from '../outcomeUpload';

const HASH = 'c'.repeat(64);

function record(over: Partial<AnalysisRecord['outcome']> = {}): AnalysisRecord {
  const r = buildAnalysisRecord({
    id: 'run-1',
    createdAt: '2026-11-16T00:00:00.000Z',
    analysis: {
      timestamp: '2026-11-16T00:00:00.000Z',
      modelFileName: 'confidential-part.stl',
      overallConfidence: 0.8,
    } as unknown as UnifiedAnalysis,
    fileName: 'confidential-part.stl',
    fileHash: HASH,
    fileSizeBytes: 999,
    units: 'mm',
    context: { material: 'PLA', materialFamily: 'fdm' },
  });
  return {
    ...r,
    outcome: {
      ...r.outcome,
      status: 'failure',
      recordedAt: '2026-11-17T00:00:00.000Z',
      failureLayer: 12,
      failureType: 'warping',
      failureMode: 'corner lifted at 12',
      actualSettings: '0.2mm / brim',
      notes: 'printed at Acme Corp, contact jane@example.com',
      ...over,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toAnonymousOutcome', () => {
  it('keeps structured facts and drops all free text and the file name', () => {
    const payload = toAnonymousOutcome(record());

    expect(payload.fileHash).toBe(HASH);
    expect(payload.outcome).toEqual({
      status: 'failure',
      failureLayer: 12,
      failureType: 'warping',
      recordedAt: '2026-11-17T00:00:00.000Z',
    });
    expect(payload.context.material).toBe('PLA');
    expect(payload.repair).toBeNull();

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('confidential-part');
    expect(serialized).not.toContain('Acme');
    expect(serialized).not.toContain('jane@example.com');
    expect(serialized).not.toContain('corner lifted');
    expect(serialized).not.toContain('0.2mm / brim');
    expect('fileName' in payload).toBe(false);
  });
});

describe('uploadOutcomeAnonymous', () => {
  it('is local-only by default and never touches fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await uploadOutcomeAnonymous(record());
    expect(result).toEqual({ ok: false, reason: 'local-only' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hands the sanitized payload to an opt-in uploader', async () => {
    const upload = vi.fn<OutcomeUploader['upload']>(async () => ({
      ok: true,
      remoteId: 'remote-1',
    }));
    const result = await uploadOutcomeAnonymous(record(), { upload });

    expect(result).toEqual({ ok: true, remoteId: 'remote-1' });
    expect(upload).toHaveBeenCalledTimes(1);
    const payload = upload.mock.calls[0]?.[0] as AnonymousOutcomePayload;
    expect(payload.fileHash).toBe(HASH);
    expect(payload.outcome.failureType).toBe('warping');
    expect(JSON.stringify(payload)).not.toContain('Acme');
  });

  it('reports an uploader failure instead of throwing', async () => {
    const uploader: OutcomeUploader = {
      async upload() {
        throw new Error('offline');
      },
    };
    await expect(uploadOutcomeAnonymous(record(), uploader)).resolves.toEqual({
      ok: false,
      reason: 'network',
      detail: 'offline',
    });
  });

  it('exposes a no-op local uploader that says so honestly', async () => {
    await expect(localOnlyOutcomeUploader.upload(toAnonymousOutcome(record()))).resolves.toEqual({
      ok: false,
      reason: 'local-only',
    });
  });
});
