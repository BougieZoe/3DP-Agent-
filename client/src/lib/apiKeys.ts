*** Begin Patch
*** Update File: client/src/lib/apiKeys.ts
@@
-import { AI_PROVIDERS, type AIProviderId } from '@shared/domain/providers';
-import { LANGUAGE_NAMES } from '@shared/i18n/content';
-import { AMD_CLOUD_ENDPOINT } from './config';
-import { callLLMProxy, CHAT_COMPLETION_MODELS, CLAUDE_MODEL, GEMINI_MODEL } from './llmProxy';
+import { AI_PROVIDERS, type AIProviderId } from '@shared/domain/providers';
+import { LANGUAGE_NAMES } from '@shared/i18n/content';
+import { AMD_CLOUD_ENDPOINT } from './config';
+import { callLLMProxy, CHAT_COMPLETION_MODELS, CLAUDE_MODEL, GEMINI_MODEL } from './llmProxy';
@@
-/**
- * API Key manager — stored in localStorage, relayed through our server per
- * request, never persisted server-side.
- */
+/**
+ * API Key manager — by default keys are kept in-memory (session-only) to
+ * avoid long-lived secrets in the browser. Persisting keys to localStorage is
+ * potentially dangerous (XSS, backups) and is disabled by default. To enable
+ * persistence for development only, set `window.__ALLOW_PERSIST_KEYS__ = true`
+ * or set the environment variable `VITE_ALLOW_PERSIST_KEYS=true` at build time.
+ *
+ * Keys are always relayed through our server per-request; the server does not
+ * persist them unless the hosted path is used (server-side keys via session).
+ */
@@
-const STORAGE_KEY = '3dp_agent_api_keys';
-const ACTIVE_PROVIDER_KEY = '3dp_agent_active_provider';
+const STORAGE_KEY = '3dp_agent_api_keys';
+const ACTIVE_PROVIDER_KEY = '3dp_agent_active_provider';
+
+// Allow persistence only when explicitly enabled (dev-only opt-in).
+const ALLOW_PERSIST_KEYS = Boolean((window as any).__ALLOW_PERSIST_KEYS__)
+  || (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ALLOW_PERSIST_KEYS === 'true');
+
+// In-memory session store used when persistence is disabled.
+let memoryKeys: APIKeys = {};
+let memorySelectedProvider: AIProvider | null = null;
@@
 export type APIKeys = Partial<Record<AIProvider, string>>;
@@
 export function getAPIKeys(): APIKeys {
   try {
-    const raw = localStorage.getItem(STORAGE_KEY);
-    if (!raw) return {};
-    const parsed = JSON.parse(raw) as Record<string, unknown>;
-    const keys: APIKeys = {};
-    for (const provider of Object.keys(parsed)) {
-      const v = parsed[provider];
-      if (typeof v !== 'string') continue;
-      const cleared = deobfuscate(v);
-      if (cleared !== null) keys[provider as AIProvider] = cleared;
-    }
-    return keys;
+    if (!ALLOW_PERSIST_KEYS) return { ...memoryKeys };
+    const raw = localStorage.getItem(STORAGE_KEY);
+    if (!raw) return {};
+    const parsed = JSON.parse(raw) as Record<string, unknown>;
+    const keys: APIKeys = {};
+    for (const provider of Object.keys(parsed)) {
+      const v = parsed[provider];
+      if (typeof v !== 'string') continue;
+      const cleared = deobfuscate(v);
+      if (cleared !== null) keys[provider as AIProvider] = cleared;
+    }
+    return keys;
   } catch { return {}; }
 }
@@
 export function saveAPIKeys(keys: APIKeys) {
-  const enc: Record<string, string> = {};
-  for (const provider of Object.keys(keys)) {
-    const v = keys[provider as AIProvider];
-    if (v) enc[provider] = obfuscate(v);
-  }
-  localStorage.setItem(STORAGE_KEY, JSON.stringify(enc));
+  if (!ALLOW_PERSIST_KEYS) {
+    memoryKeys = { ...keys };
+    return;
+  }
+  const enc: Record<string, string> = {};
+  for (const provider of Object.keys(keys)) {
+    const v = keys[provider as AIProvider];
+    if (v) enc[provider] = obfuscate(v);
+  }
+  localStorage.setItem(STORAGE_KEY, JSON.stringify(enc));
 }
@@
 export function getSelectedProvider(): AIProvider | null {
   try {
-    return (localStorage.getItem(ACTIVE_PROVIDER_KEY) as AIProvider) || null;
+    if (!ALLOW_PERSIST_KEYS) return memorySelectedProvider;
+    return (localStorage.getItem(ACTIVE_PROVIDER_KEY) as AIProvider) || null;
   } catch { return null; }
 }
@@
 export function setSelectedProvider(provider: AIProvider) {
-  localStorage.setItem(ACTIVE_PROVIDER_KEY, provider);
+  if (!ALLOW_PERSIST_KEYS) {
+    memorySelectedProvider = provider;
+    return;
+  }
+  localStorage.setItem(ACTIVE_PROVIDER_KEY, provider);
 }
*** End Patch