*** Begin Patch
*** Add File: tests/llm-proxy.test.ts
+import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
+
+// Ensure the bridges (where /api/llm-proxy is mounted) are enabled for tests.
+process.env.BRIDGE_TOKEN = process.env.BRIDGE_TOKEN ?? 'test-token-for-ci';
+
+// Mock the relay so tests don't call real upstream providers.
+vi.mock('../../server/llmRelay', () => ({
+  relayLLM: async (_params: any) => ({
+    status: 200,
+    text: JSON.stringify({ choices: [{ message: { content: 'mock response' } }] }),
+  }),
+  relayLLMStream: async () => {
+    /* noop for stream tests */
+  },
+}));
+
+import { createApp } from '../../server/index';
+import { createServer } from 'http';
+
+let server: any;
+let baseUrl = '';
+
+beforeAll((done) => {
+  const app = createApp();
+  server = createServer(app).listen(0, () => {
+    // @ts-ignore node types in the test environment
+    const port = (server.address() as any).port;
+    baseUrl = `http://127.0.0.1:${port}`;
+    done();
+  });
+});
+
+afterAll((done) => {
+  server.close(done);
+});
+
+describe('LLM proxy (integration)', () => {
+  it('should proxy anonymous BYOK requests and return mocked response', async () => {
+    const res = await fetch(baseUrl + '/api/llm-proxy', {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({
+        provider: 'openai',
+        body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
+        apiKey: 'sk_test',
+      }),
+    });
+    expect(res.status).toBe(200);
+    const data = await res.json();
+    expect(data.choices?.[0]?.message?.content).toBe('mock response');
+  });
+});
+
*** End Patch