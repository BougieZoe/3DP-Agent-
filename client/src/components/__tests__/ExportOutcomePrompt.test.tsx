/**
 * ExportOutcomePrompt tests — lightweight entry after export.
 *
 * Rules under test:
 *  1. No linked record → no entry at all (never guess an association).
 *  2. The entry is closed by default and opens the canonical outcome form.
 *  3. The saved outcome attaches to the exact exported record id.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { UnifiedAnalysis } from '@/analysis/types';
import { buildAnalysisRecord } from '@/lib/analysisRecord';
import { createMemoryStore } from '@/lib/analysisHistory';
import { ExportOutcomePrompt } from '../ExportOutcomePrompt';

const HASH_A = 'a'.repeat(64);

function makeRecord(id: string) {
  return buildAnalysisRecord({
    id,
    analysis: {
      timestamp: '2026-10-16T00:00:00.000Z',
      modelFileName: 'part.stl',
      overallConfidence: 0.9,
    } as unknown as UnifiedAnalysis,
    fileName: 'part.stl',
    fileHash: HASH_A,
    fileSizeBytes: 1234,
    units: 'mm',
    context: { material: 'PLA', materialFamily: 'fdm' },
  });
}

beforeEach(() => {
  cleanup();
});
afterEach(() => {
  cleanup();
});

describe('ExportOutcomePrompt', () => {
  it('renders nothing without a record id', () => {
    const store = createMemoryStore();
    const { container } = render(
      <ExportOutcomePrompt recordId={null} language="en" store={store} />,
    );
    expect(container.textContent).toBe('');
  });

  it('opens the outcome form and saves to the exact exported record', async () => {
    const store = createMemoryStore();
    await store.save(makeRecord('exported-run'));

    render(<ExportOutcomePrompt recordId="exported-run" language="en" store={store} />);

    const details = screen.getByTestId('export-outcome-prompt') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    fireEvent.click(screen.getByText(/RECORD OUTCOME/i));
    expect(details.open).toBe(true);

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Successful print/ })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('radio', { name: /Successful print/ }));
    fireEvent.click(screen.getByRole('button', { name: /SAVE OUTCOME/i }));

    await waitFor(() => expect(screen.getByText(/✓ Saved to local history/i)).toBeDefined());
    expect((await store.get('exported-run'))?.outcome.status).toBe('success');
  });
});
