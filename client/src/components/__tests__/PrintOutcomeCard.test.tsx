/**
 * PrintOutcomeCard tests — actual-print-outcome editing and persistence (Phase 1 D2).
 *
 * Rules under test:
 *  1. Outcomes attach to the exact record id passed in — never to a
 *     fingerprint-matched guess (the second same-hash record stays untouched).
 *  2. All five schema statuses persist through updateOutcome unchanged.
 *  3. A save that silently fails to reach storage is reported, never shown
 *     as success (the card re-reads after saving).
 *  4. Detail fields the card does not edit (failureMode, actualSettings)
 *     survive an edit unchanged.
 *  5. No record id → honest "not recordable" notice, no controls.
 *
 * Uses the in-memory RecordStore — no IndexedDB, no fetch.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { UnifiedAnalysis } from '@/analysis/types';
import { buildAnalysisRecord } from '@/lib/analysisRecord';
import {
  createMemoryStore,
  updateOutcome,
  type RecordStore,
} from '@/lib/analysisHistory';
import { PrintOutcomeCard } from '../PrintOutcomeCard';
import type { AnonymousOutcomePayload } from '@/lib/outcomeUpload';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

/** Minimal analysis: builder/metric extractors tolerate missing optional modules. */
function makeAnalysis(over: Partial<Record<string, unknown>> = {}): UnifiedAnalysis {
  return {
    timestamp: '2026-10-16T00:00:00.000Z',
    modelFileName: 'part.stl',
    overallConfidence: 0.9,
    ...over,
  } as unknown as UnifiedAnalysis;
}

function makeRecord(id: string, fileHash = HASH_A) {
  return buildAnalysisRecord({
    id,
    analysis: makeAnalysis(),
    fileName: 'part.stl',
    fileHash,
    fileSizeBytes: 1234,
    units: 'mm',
    context: { material: 'PLA', materialFamily: 'fdm' },
  });
}

async function seed(store: RecordStore, id: string, fileHash = HASH_A) {
  await store.save(makeRecord(id, fileHash));
}

beforeEach(() => {
  cleanup();
});
afterEach(() => {
  cleanup();
});

describe('PrintOutcomeCard', () => {
  it('renders nothing recordable-safe without a record id', () => {
    const store = createMemoryStore();
    const { container } = render(<PrintOutcomeCard recordId={null} language="en" store={store} />);
    expect(container.textContent ?? '').toMatch(/No linked analysis record/i);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: /SAVE OUTCOME/i })).toBeNull();
  });


  it('edits status and notes and persists them to the exact record', async () => {
    const store = createMemoryStore();
    await seed(store, 'r-2');
    await seed(store, 'r-3', HASH_B); // same-ish history; must stay untouched

    render(<PrintOutcomeCard recordId="r-2" language="en" store={store} />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /Failed print/ })).toBeDefined());

    fireEvent.click(screen.getByRole('radio', { name: /Failed print/ }));
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'layer 12 detached' } });
    fireEvent.click(screen.getByRole('button', { name: /SAVE OUTCOME/i }));

    await waitFor(() => expect(screen.getByText(/✓ Saved to local history/i)).toBeDefined());

    const saved = await store.get('r-2');
    expect(saved?.outcome.status).toBe('failure');
    expect(saved?.outcome.notes).toBe('layer 12 detached');
    expect(saved?.outcome.recordedAt).toBeTruthy();
    // Requirement 5 guard: a fingerprint-neighbor record is never touched.
    expect((await store.get('r-3'))?.outcome.status).toBe('not_tested');
  });

  it('supports unknown and not_tested as honest non-success states', async () => {
    const store = createMemoryStore();
    await seed(store, 'r-4');

    render(<PrintOutcomeCard recordId="r-4" language="en" store={store} />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /Unknown/ })).toBeDefined());

    fireEvent.click(screen.getByRole('radio', { name: /Unknown/ }));
    fireEvent.click(screen.getByRole('button', { name: /SAVE OUTCOME/i }));
    await waitFor(() => expect(screen.getByText(/✓ Saved to local history/i)).toBeDefined());
    expect((await store.get('r-4'))?.outcome.status).toBe('unknown');

    fireEvent.click(screen.getByRole('radio', { name: /Not tested/ }));
    fireEvent.click(screen.getByRole('button', { name: /SAVE OUTCOME/i }));
    await waitFor(() => expect(screen.getByText(/✓ Saved to local history/i)).toBeDefined());
    expect((await store.get('r-4'))?.outcome.status).toBe('not_tested');
  });

  it('leaves untouched detail fields intact across a save', async () => {
    const store = createMemoryStore();
    await seed(store, 'r-5');
    await updateOutcome(store, 'r-5', {
      status: 'partial',
      failureMode: 'warping at corner',
      actualSettings: '0.2mm / brim',
    });

    render(<PrintOutcomeCard recordId="r-5" language="en" store={store} />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /Failed print/ })).toBeDefined());

    fireEvent.click(screen.getByRole('radio', { name: /Successful print/ }));
    fireEvent.click(screen.getByRole('button', { name: /SAVE OUTCOME/i }));
    await waitFor(() => expect(screen.getByText(/✓ Saved to local history/i)).toBeDefined());

    const saved = await store.get('r-5');
    expect(saved?.outcome.status).toBe('success');
    expect(saved?.outcome.failureMode).toBe('warping at corner');
    expect(saved?.outcome.actualSettings).toBe('0.2mm / brim');
  });

  it('reports failure when the write silently never lands', async () => {
    const store = createMemoryStore();
    await seed(store, 'r-6');

    // save() is swallowed by the storage layer (best-effort contract), so the
    // only proof of persistence is the re-read — the card must catch it.
    const dropped: RecordStore = {
      async save() {
        /* write dropped */
      },
      async get(id: string) {
        return store.get(id);
      },
      async list() {
        return store.list();
      },
      async getLatestByHash(fileHash: string) {
        return store.getLatestByHash(fileHash);
      },
    };
    render(<PrintOutcomeCard recordId="r-6" language="en" store={dropped} />);

    await waitFor(() => expect(screen.getByRole('radio', { name: /Failed print/ })).toBeDefined());
    fireEvent.click(screen.getByRole('radio', { name: /Failed print/ }));
    fireEvent.click(screen.getByRole('button', { name: /SAVE OUTCOME/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert')).toHaveTextContent(/Save failed/i);
    // The underlying store still holds the untested state — no phantom success.
    expect((await store.get('r-6'))?.outcome.status).toBe('not_tested');
  });

  it('shows a load error when the linked record is missing', async () => {
    const store = createMemoryStore();
    render(<PrintOutcomeCard recordId="no-such-record" language="en" store={store} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert')).toHaveTextContent(/No analysis record/i);
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('loads the current outcome and prefills status + notes', async () => {
    const store = createMemoryStore();
    await seed(store, 'r-1');
    await updateOutcome(store, 'r-1', { status: 'partial', notes: 'warped corner' });

    render(<PrintOutcomeCard recordId="r-1" language="en" store={store} />);

    await waitFor(() => expect(screen.getByRole('radio', { name: /Partial/ })).toBeChecked());
    expect(screen.getByLabelText(/Notes/)).toHaveValue('warped corner');
    expect(screen.getByRole('radio', { name: /Partial/ })).toBeChecked();
    expect(screen.getByLabelText(/Failed layer/)).toHaveValue(null);
    expect(screen.getByLabelText(/Failure type/)).toHaveValue('');
  });

  it('persists optional failure layer and type without inventing them', async () => {
    const store = createMemoryStore();
    await seed(store, 'r-7');

    render(<PrintOutcomeCard recordId="r-7" language="en" store={store} />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /Failed print/ })).toBeDefined());

    fireEvent.click(screen.getByRole('radio', { name: /Failed print/ }));
    fireEvent.change(screen.getByLabelText(/Failed layer/), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/Failure type/), { target: { value: 'warping' } });
    fireEvent.click(screen.getByRole('button', { name: /SAVE OUTCOME/i }));

    await waitFor(() => expect(screen.getByText(/✓ Saved to local history/i)).toBeDefined());
    const saved = await store.get('r-7');
    expect(saved?.outcome.failureLayer).toBe(12);
    expect(saved?.outcome.failureType).toBe('warping');
    expect(saved?.outcome.status).toBe('failure');
  });

  it('leaves failure details null when the user only reports success', async () => {
    const store = createMemoryStore();
    await seed(store, 'r-8');

    render(<PrintOutcomeCard recordId="r-8" language="en" store={store} />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /Successful print/ })).toBeDefined());
    fireEvent.click(screen.getByRole('radio', { name: /Successful print/ }));
    fireEvent.click(screen.getByRole('button', { name: /SAVE OUTCOME/i }));

    await waitFor(() => expect(screen.getByText(/✓ Saved to local history/i)).toBeDefined());
    const saved = await store.get('r-8');
    expect(saved?.outcome.status).toBe('success');
    expect(saved?.outcome.failureLayer).toBeNull();
    expect(saved?.outcome.failureType).toBeNull();
  });

  it('uploads only the sanitized payload through an opt-in uploader', async () => {
    const store = createMemoryStore();
    await seed(store, 'r-9');
    const uploads: AnonymousOutcomePayload[] = [];
    const uploader = {
      async upload(payload: AnonymousOutcomePayload) {
        uploads.push(payload);
        return { ok: true as const, remoteId: 'remote-9' };
      },
    };

    render(<PrintOutcomeCard recordId="r-9" language="en" store={store} uploader={uploader} />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /Failed print/ })).toBeDefined());
    fireEvent.click(screen.getByRole('radio', { name: /Failed print/ }));
    fireEvent.change(screen.getByLabelText(/Failure type/), { target: { value: 'stringing' } });
    fireEvent.change(screen.getByLabelText(/Notes/), {
      target: { value: 'secret workshop address, call 555-0100' },
    });
    fireEvent.click(screen.getByRole('button', { name: /SAVE OUTCOME/i }));

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0].fileHash).toBe(HASH_A);
    expect(uploads[0].outcome.failureType).toBe('stringing');
    expect(JSON.stringify(uploads[0])).not.toContain('secret workshop');
    expect(JSON.stringify(uploads[0])).not.toContain('555-0100');
  });
});
