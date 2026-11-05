import { describe, it, expect } from 'vitest';
import { projectId, shouldPersist, trimToBudget, MAX_PROJECTS, MAX_PROJECT_BYTES } from '../projectStore';

describe('projectId', () => {
  it('is stable for the same file and differs when the file changes', () => {
    const a = { name: 'part.stl', size: 1000, lastModified: 111 };
    expect(projectId(a)).toBe(projectId({ ...a }));
    expect(projectId(a)).not.toBe(projectId({ ...a, lastModified: 222 }));
    expect(projectId(a)).not.toBe(projectId({ ...a, name: 'other.stl' }));
  });
});

describe('shouldPersist', () => {
  it('accepts normal files up to the ceiling', () => {
    expect(shouldPersist(1)).toBe(true);
    expect(shouldPersist(MAX_PROJECT_BYTES)).toBe(true);
  });

  it('refuses empty, oversized or nonsense sizes', () => {
    expect(shouldPersist(0)).toBe(false);
    expect(shouldPersist(MAX_PROJECT_BYTES + 1)).toBe(false);
    expect(shouldPersist(Number.NaN)).toBe(false);
    expect(shouldPersist(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('trimToBudget', () => {
  it('keeps the newest entries in newest-first order', () => {
    const items = [
      { id: 'old', savedAt: 1 },
      { id: 'new', savedAt: 30 },
      { id: 'mid', savedAt: 20 },
      { id: 'older', savedAt: 2 },
    ];
    const kept = trimToBudget(items, 3);
    expect(kept.map((i) => i.id)).toEqual(['new', 'mid', 'older']);
  });

  it('defaults to MAX_PROJECTS and does not mutate the input', () => {
    const items = Array.from({ length: MAX_PROJECTS + 2 }, (_, i) => ({ id: String(i), savedAt: i }));
    const copy = [...items];
    expect(trimToBudget(items)).toHaveLength(MAX_PROJECTS);
    expect(items).toEqual(copy);
  });
});
