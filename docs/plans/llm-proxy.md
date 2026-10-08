# LLM Proxy / BYOK Migration Guide

This document describes the new `/api/llm-proxy` server-side proxy, the client BYOK (Bring Your Own Key) policy and local testing steps.

Why this change
- Centralize provider key usage on the server to reduce risk of long-lived secrets in the browser.
- Enforce allowlist, rate-limits and quota checks on the server side.
- Make it possible to rotate and manage server keys in a single place (secret manager).

Default behaviour (safe-by-default)
- Frontend now uses `/api/llm-proxy` by default (see `client/src/lib/config.ts`).
- Browser keys (BYOK) are stored in-memory (session-only) by default. Persisting keys to `localStorage` is disabled unless explicitly enabled for development.
  - To enable persistence for development only: set `window.__ALLOW_PERSIST_KEYS__ = true` in the browser console, or build with `VITE_ALLOW_PERSIST_KEYS=true`.

Server behaviour
- `/api/llm-proxy` accepts POST `{ provider, body }` (and optional `apiKey` for anonymous BYOK). If a valid `Authorization: Bearer <session>` header is present, the server uses its configured server-side key for that provider and enforces the hosted quota/limits.
- Stream endpoint: `/api/llm-proxy/stream` is available and proxies SSE streams to the client via the same rules.
- The proxy is intentionally not a generic HTTP forwarder — it uses the existing relay logic (`server/llmRelay.ts`) that enforces allowlists and model checks.

Local testing
1. Start the server and frontend (branch `fix/secrets-migration-to-server`):

```bash
pnpm install
pnpm dev:server  # server on :3001
pnpm dev         # frontend on :3000
```

2. Anonymous BYOK test (temporary key in request body):

```bash
curl -v -X POST http://localhost:3001/api/llm-proxy \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","body":{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]},"apiKey":"sk_TEST"}'
```

3. Hosted/session test (server-side key via session bearer):

```bash
curl -v -X POST http://localhost:3001/api/llm-proxy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session_token>" \
  -d '{"provider":"openai","body":{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}}'
```

Validation points
- Proxy returns upstream response (200) and body contains normal response shape.
- Server logs the request (provider/model/status/timing) but does NOT log or persist API keys.
- Frontend no longer stores keys in `localStorage` by default.

CI / Security recommendations
- Add a gitleaks (or equivalent) job to CI to prevent committing secrets. Example (GitHub Actions snippet):

```yaml
name: Secrets scan
on: [push, pull_request]
jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install gitleaks
        run: |
          curl -sSfL https://github.com/zricethezav/gitleaks/releases/latest/download/gitleaks_$(uname | tr '[:upper:]' '[:lower:]')_amd64.tar.gz | tar xz -C /tmp
      - name: Run gitleaks
        run: |
          /tmp/gitleaks detect --source=. --report=gitleaks-report.json || true
      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: gitleaks-report
          path: gitleaks-report.json
```

- Move server-side provider keys into a managed secret store (Vault / cloud secrets) and reference them from deployment (do not store keys in repo or plain ENV in CI logs).

Migration plan
1. Merge `fix/secrets-migration-to-server` branch after review.
2. Keep `/api/llm` operational for one release cycle (compatibility) while monitoring usage.
3. Gradually flip clients to default `/api/llm-proxy` and enforce persistence disabled in production.
4. Later: implement ephemeral token issuance for hosted sessions and retire direct client BYOK passing.

Rollback plan
- If issues occur after deploy, revert the branch or re-enable the old `/api/llm` endpoint (no deletion was performed during migration).

If you want, I can also add a small integration test under `tests/` that exercises the proxy against a mocked upstream. Say the word and I'll add it in the same branch and reference it in the PR.
