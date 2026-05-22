import { describe, expect, it } from 'vitest';
import { AI_PROVIDER_METADATA, AI_PROVIDERS, type AIProviderId } from '../providers';

describe('AI provider metadata', () => {
  it('defines provider metadata for every supported provider id', () => {
    const ids = AI_PROVIDERS.map(provider => provider.id);
    const expectedIds: AIProviderId[] = ['claude', 'openai', 'gemini', 'deepseek'];

    expect(ids).toEqual(expectedIds);
    expectedIds.forEach(id => {
      expect(AI_PROVIDER_METADATA[id].id).toBe(id);
      expect(AI_PROVIDER_METADATA[id].label.length).toBeGreaterThan(0);
      expect(AI_PROVIDER_METADATA[id].shortLabel.length).toBeGreaterThan(0);
      expect(AI_PROVIDER_METADATA[id].keyPlaceholder.length).toBeGreaterThan(0);
    });
  });
});
