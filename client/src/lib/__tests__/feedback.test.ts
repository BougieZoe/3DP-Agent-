import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureFeedback,
  getFeedbackEntries,
  getFeedbackSummary,
  clearFeedback,
} from '@/lib/feedback';

beforeEach(() => {
  localStorage.clear();
  clearFeedback();
});

describe('captureFeedback', () => {
  it('creates a feedback entry with correct fields', () => {
    const entry = captureFeedback('Test title', 'Test description', 'bug');
    expect(entry.title).toBe('Test title');
    expect(entry.description).toBe('Test description');
    expect(entry.type).toBe('bug');
    expect(entry.id).toBeTypeOf('string');
    expect(entry.timestamp).toBeTypeOf('string');
  });

  it('defaults to general type', () => {
    const entry = captureFeedback('Title', 'Desc');
    expect(entry.type).toBe('general');
  });

  it('stores context when provided', () => {
    const entry = captureFeedback('Title', 'Desc', 'bug', 'Error: something broke');
    expect(entry.context).toBe('Error: something broke');
  });

  it('persists to localStorage', () => {
    captureFeedback('Persist test', 'Should survive', 'feature');
    const raw = localStorage.getItem('3dp-agent-feedback');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Persist test');
  });
});

describe('getFeedbackEntries', () => {
  it('returns copy of all entries', () => {
    captureFeedback('One', 'First', 'bug');
    captureFeedback('Two', 'Second', 'feature');
    const all = getFeedbackEntries();
    expect(all).toHaveLength(2);
    expect(all.map(e => e.title)).toEqual(['One', 'Two']);
  });

  it('modifying returned array does not affect internal state', () => {
    captureFeedback('Original', 'Desc');
    const copy = getFeedbackEntries();
    copy.push({} as any);
    expect(getFeedbackEntries()).toHaveLength(1);
  });
});

describe('clearFeedback', () => {
  it('removes all entries', () => {
    captureFeedback('Test', 'Desc');
    clearFeedback();
    expect(getFeedbackEntries()).toHaveLength(0);
  });

  it('clears localStorage', () => {
    captureFeedback('Test', 'Desc');
    clearFeedback();
    const raw = localStorage.getItem('3dp-agent-feedback');
    expect(raw).toBe('[]');
  });
});

describe('getFeedbackSummary', () => {
  it('returns fallback when no entries', () => {
    expect(getFeedbackSummary()).toBe('No feedback collected.');
  });

  it('includes counts by type', () => {
    captureFeedback('Bug 1', 'Desc', 'bug');
    captureFeedback('Bug 2', 'Desc', 'bug');
    captureFeedback('Feature 1', 'Desc', 'feature');
    const summary = getFeedbackSummary();
    expect(summary).toContain('Feedback: 3 entry(ies)');
    expect(summary).toContain('Bugs: 2');
    expect(summary).toContain('Feature requests: 1');
  });
});
