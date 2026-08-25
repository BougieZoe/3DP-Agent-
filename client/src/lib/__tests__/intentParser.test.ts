import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseIntent, getSuggestedCommands } from '../intentParser';

// Mock the API keys module
vi.mock('@/lib/apiKeys', () => ({
  callAI: vi.fn(),
  getActiveProvider: vi.fn(() => null),
  getKey: vi.fn(() => undefined),
}));

describe('intentParser', () => {
  describe('parseIntent', () => {
    it('should parse analyze command', async () => {
      const intent = await parseIntent('analyze this model');

      expect(intent.action).toBe('analyze');
      expect(intent.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should parse settings command with material', async () => {
      const intent = await parseIntent('use PETG material');

      expect(intent.action).toBe('settings');
      expect(intent.params.material).toBe('PETG');
    });

    it('should parse query command', async () => {
      const intent = await parseIntent('how long will this take?');

      expect(intent.action).toBe('query');
    });

    it('should parse export command', async () => {
      const intent = await parseIntent('export as STL');

      expect(intent.action).toBe('export');
      expect(intent.params.format).toBe('stl');
    });

    it('should parse help command', async () => {
      const intent = await parseIntent('help');

      expect(intent.action).toBe('help');
    });

    it('should return default query for unrecognized input', async () => {
      const intent = await parseIntent('random text');

      expect(intent.action).toBe('query');
      expect(intent.confidence).toBeLessThan(0.5);
    });
  });

  describe('getSuggestedCommands', () => {
    it('should return English commands by default', () => {
      const commands = getSuggestedCommands('en');

      expect(commands.length).toBeGreaterThan(0);
      expect(commands.some(c => c.includes('Analyze'))).toBe(true);
    });

    it('should return Chinese commands', () => {
      const commands = getSuggestedCommands('zh');

      expect(commands.length).toBeGreaterThan(0);
      expect(commands.some(c => c.includes('分析'))).toBe(true);
    });

    it('should return Japanese commands', () => {
      const commands = getSuggestedCommands('ja');

      expect(commands.length).toBeGreaterThan(0);
      expect(commands.some(c => c.includes('分析'))).toBe(true);
    });
  });
});
