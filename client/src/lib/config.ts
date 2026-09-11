*** Begin Patch
*** Update File: client/src/lib/config.ts
@@
-export const LLM_PROXY_ENDPOINT = '/api/llm';
+// After centralized proxy introduction, clients should use the proxy endpoint.
+// We keep the old /api/llm for backwards compatibility during migration,
+// but the new default is /api/llm-proxy which enforces server-side
+// key usage for logged-in users and centralizes allowlist/rate limits.
+export const LLM_PROXY_ENDPOINT = '/api/llm-proxy';
*** End Patch