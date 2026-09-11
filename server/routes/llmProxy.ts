*** Begin Patch
*** Add File: server/routes/llmProxy.ts
+import express from 'express';
+import { relayLLM, relayLLMStream } from '../llmRelay';
+import { logger } from '../logger';
+
+const router = express.Router();
+
+// Lightweight proxy endpoint that expects the browser to POST { provider, body }
+// and the server will use its configured server-side keys when the request
+// includes a valid Authorization: Bearer <session> header. This centralizes
+// key usage and prevents keys being stored in localStorage in production.
+router.post('/', express.json({ limit: '2mb' }), async (req, res) => {
+  try {
+    const { provider, body } = req.body ?? {};
+    // The relayLLM helper accepts apiKey (optional) and bearer (optional).
+    // We intentionally forward any Authorization header so that hosted users
+    // can use server-side keys via their session.
+    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
+    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
+    const result = await relayLLM({ provider, apiKey: undefined, body, bearer });
+    res.status(result.status).set('Content-Type', 'application/json').send(result.text);
+  } catch (err) {
+    logger.error('llm proxy error', { err: String(err) });
+    res.status(500).json({ error: 'llm proxy error' });
+  }
+});
+
+router.post('/stream', express.json({ limit: '2mb' }), async (req, res) => {
+  // Streaming handled by relayLLMStream which expects bearer inside req.body.
+  try {
+    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
+    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
+    (req.body as any).bearer = bearer;
+    await relayLLMStream(req as any, res as any);
+  } catch (err) {
+    logger.error('llm proxy stream error', { err: String(err) });
+    res.status(500).json({ error: 'llm proxy stream error' });
+  }
+});
+
+export default router;
+
*** End Patch