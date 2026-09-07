import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BlenderAdapter } from '../blenderAdapter';
import { verifyPart } from '../visionVerifier';

let adapter: BlenderAdapter;

beforeAll(async () => {
  adapter = new BlenderAdapter();
  await adapter.init();
  // Export test cube to STL for import test
  await adapter.createMesh('cube', { size: 2 });
  await adapter.export('/tmp/verify_test.stl', 'stl');
}, 30000);

afterAll(async () => {
  await adapter.dispose();
});

describe('visionVerifier', () => {
  it('runs mock verification pipeline', async () => {
    const report = await verifyPart(adapter, '/tmp/verify_test.stl', { provider: 'mock' });

    expect(report.fileName).toBe('verify_test.stl');
    expect(report.viewsRendered).toBe(8);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.overallVerdict).toBe('ok');
    expect(report.summary).toBeTruthy();
    expect(report.modelUsed).toBe('mock');
  }, 60000);

  it('returns structured findings per view angle', async () => {
    const report = await verifyPart(adapter, '/tmp/verify_test.stl', { provider: 'mock' });

    for (const finding of report.findings) {
      expect(finding.category).toBeTruthy();
      expect(['ok', 'warning', 'critical']).toContain(finding.severity);
      expect(finding.description).toBeTruthy();
    }
  }, 60000);

  it('throws on missing API key for openai', async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await expect(
      verifyPart(adapter, '/tmp/verify_test.stl', { provider: 'openai' })
    ).rejects.toThrow('API key');
    if (original) process.env.OPENAI_API_KEY = original;
  }, 30000);
});
