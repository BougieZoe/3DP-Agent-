import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLLMProvider, getLLMProviderForMaterial, isLLMAvailable, HOSTED_DEFAULT_PROVIDER } from '../llmAccess';
import { saveAPIKeys, setSelectedProvider } from '../apiKeys';
import type { Material } from '@shared/domain/material';

// Mock authStore
vi.mock('../authStore', () => ({
  getAuthSnapshot: vi.fn(() => ({ user: null })),
}));

const mockGetAuthSnapshot = vi.mocked(await import('../authStore')).getAuthSnapshot;

describe('LLM Access - Provider Routing', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('getLLMProvider', () => {
    it('returns hosted provider for signed-in users', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: { id: '123' } } as any);
      const result = getLLMProvider();
      expect(result).toEqual({ provider: HOSTED_DEFAULT_PROVIDER, key: '' });
    });

    it('returns BYOK key for anonymous users', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: null } as any);
      saveAPIKeys({ deepseek: 'sk-test-key' } as any);
      setSelectedProvider('deepseek');
      const result = getLLMProvider();
      expect(result).toEqual({ provider: 'deepseek', key: 'sk-test-key' });
    });

    it('returns null when no keys configured', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: null } as any);
      const result = getLLMProvider();
      expect(result).toBeNull();
    });
  });

  describe('getLLMProviderForMaterial - Material-Aware Routing', () => {
    it('routes SLM (metal) to Claude first', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: null } as any);
      saveAPIKeys({ claude: 'sk-ant-test' } as any);
      setSelectedProvider('claude');

      const slmMaterial = { technology: 'slm' } as Material;
      const result = getLLMProviderForMaterial(slmMaterial);
      expect(result?.provider).toBe('claude');
    });

    it('routes FDM to DeepSeek first', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: null } as any);
      saveAPIKeys({ deepseek: 'sk-ds', claude: 'sk-ant' } as any);
      setSelectedProvider('deepseek');

      const fdmMaterial = { technology: 'fdm' } as Material;
      const result = getLLMProviderForMaterial(fdmMaterial);
      expect(result?.provider).toBe('deepseek');
    });

    it('routes SLA to DeepSeek first', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: null } as any);
      saveAPIKeys({ deepseek: 'sk-ds', openai: 'sk-oai' } as any);
      setSelectedProvider('deepseek');

      const slaMaterial = { technology: 'sla' } as Material;
      const result = getLLMProviderForMaterial(slaMaterial);
      expect(result?.provider).toBe('deepseek');
    });

    it('routes SLS to DeepSeek first', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: null } as any);
      saveAPIKeys({ deepseek: 'sk-ds', zhipu: 'id.secret' } as any);
      setSelectedProvider('deepseek');

      const slsMaterial = { technology: 'sls' } as Material;
      const result = getLLMProviderForMaterial(slsMaterial);
      expect(result?.provider).toBe('deepseek');
    });

    it('falls back to next provider when first is unavailable', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: null } as any);
      // Only Zhipu configured, not DeepSeek
      saveAPIKeys({ zhipu: 'id.secret' } as any);
      setSelectedProvider('zhipu');

      const fdmMaterial = { technology: 'fdm' } as Material;
      const result = getLLMProviderForMaterial(fdmMaterial);
      // FDM priority: deepseek, zhipu, kimi, fireworks, openai, gemini, claude
      expect(result?.provider).toBe('zhipu');
    });

    it('returns null when no providers available', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: null } as any);
      const fdmMaterial = { technology: 'fdm' } as Material;
      const result = getLLMProviderForMaterial(fdmMaterial);
      expect(result).toBeNull();
    });

    it('uses first provider from priority list for signed-in users', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: { id: '123' } } as any);

      // SLM priority: claude, openai, deepseek, zhipu, kimi, fireworks, gemini
      const slmMaterial = { technology: 'slm' } as Material;
      const result = getLLMProviderForMaterial(slmMaterial);
      expect(result?.provider).toBe('claude'); // First in SLM priority list
      expect(result?.key).toBe(''); // Server-side key

      // FDM priority: deepseek, zhipu, kimi, fireworks, openai, gemini, claude
      const fdmMaterial = { technology: 'fdm' } as Material;
      const result2 = getLLMProviderForMaterial(fdmMaterial);
      expect(result2?.provider).toBe('deepseek'); // First in FDM priority list
      expect(result2?.key).toBe('');
    });
  });

  describe('isLLMAvailable', () => {
    it('returns true for signed-in users', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: { id: '123' } } as any);
      expect(isLLMAvailable()).toBe(true);
    });

    it('returns true when BYOK keys configured', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: null } as any);
      saveAPIKeys({ deepseek: 'sk-test' } as any);
      expect(isLLMAvailable()).toBe(true);
    });

    it('returns false when no keys and not signed in', () => {
      mockGetAuthSnapshot.mockReturnValue({ user: null } as any);
      expect(isLLMAvailable()).toBe(false);
    });
  });
});
