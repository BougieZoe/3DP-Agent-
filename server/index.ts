*** Begin Patch
*** Update File: server/index.ts
@@
-    app.post("/api/amd-proxy", express.json({ limit: "2mb" }), ...amdProxy, async (req: Request, res: Response) => {
+    app.post("/api/amd-proxy", express.json({ limit: "2mb" }), ...amdProxy, async (req: Request, res: Response) => {
@@
     });
+
+    // Mount the centralized LLM proxy route. This route uses server-side key
+    // configuration when the request includes a valid Bearer session token.
+    // It is deliberately mounted under the same bridge guards so operators can
+    // opt-in to exposing server-side features only when BRIDGE_TOKEN is set.
+    const llmProxyRouter = (await import('./routes/llmProxy')).default;
+    app.use('/api/llm-proxy', ...amdProxy, llmProxyRouter);
*** End Patch