import express, { type NextFunction, type Request, type Response } from "express";
import { createServer } from "http";
import { appendFile, mkdir } from "node:fs/promises";
import path from "path";
import { currentDir as __dirname } from "./currentDir";
import { createCadBridgeRouter } from "./cadBridge";
import { createMeshProcessRouter } from "./meshProcess";
import { createSlicerRouter } from "./slicerRouter";
import { createStepRouter } from "./stepRouter";
import { createTripoProxyRouter } from "./tripoProxy";
import { bridgeAuthDecision } from "./loopbackGuard";
import { relayLLM, relayLLMStream } from "./llmRelay";
import { createShareRouter } from "./shareRouter";
import { createStripeRouter } from "./stripeRouter";
import { logger } from "./logger";
import { requestContext, errorHandler, notFoundHandler } from "./requestContext";
import healthRouter from "./healthRouter";
import { initShutdown } from "./shutdown";

// Real address of the AMD machine, read from an environment variable instead
// of hardcoded. Every time a new Droplet is spun up, only this env var in the
// dashboard needs to change — no code edits, no commit, no push.
const AMD_MACHINE_URL =
  process.env.AMD_MACHINE_URL || "http://localhost:8000/v1/chat/completions";

// Bearer token guarding the local-dev bridge routes. When NODE_ENV is
// "production" the bridges (cad/generate, mesh/process, slice, amd-proxy) are
// UNMOUNTED unless BRIDGE_TOKEN is set — none of them should ever be reachable
// by the public internet without an explicit, operator-chosen secret.
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const bridgesEnabled = !IS_PRODUCTION || !!BRIDGE_TOKEN;

// Dev binds the Express server to loopback only, so the unauthenticated local
// bridge flow (REPAIR & PROCESS etc.) is reachable from this machine alone.
// Production leaves it unbound (all interfaces) because the static frontend
// serves there and the bridges are token-gated anyway. Override with HOST=...
// if you know what you are doing — a non-loopback HOST in dev keeps bridgeAuth
// enforced (see devLocalBridgeGuard), so exposing it is safe-by-default.
const HOST = process.env.HOST || (IS_PRODUCTION ? undefined : "127.0.0.1");

// Only the AMD vLLM endpoint is ever proxied, and only for chat completion
// payloads the client is allowed to send. Anything else is rejected before a
// fetch is attempted — the proxy is not a general-purpose HTTP forwarder.
const AMD_ALLOWED_MODELS = new Set<string>([
  "Qwen/Qwen3-8B",
  "Qwen/Qwen3-30B-A3B",
]);

function bridgeAuth(req: Request, res: Response, next: NextFunction): void {
  if (!BRIDGE_TOKEN) {
    res.status(503).json({ error: "bridge unavailable: BRIDGE_TOKEN not configured" });
    return;
  }
  const expected = `Bearer ${BRIDGE_TOKEN}`;
  if (req.headers.authorization !== expected) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

/**
 * Dev gate: keeps the bridges usable from localhost while remaining token-gated
 * for everyone else. The decision is made from the REQUEST-SOURCE chain (see
 * loopbackGuard.ts), never from the bind host — so a LAN peer that reaches this
 * server through the (LAN-exposed) Vite proxy stays authenticated, and a dev
 * server accidentally published on 0.0.0.0 does not silently expose the bridges.
 */
function devLocalBridgeGuard(req: Request, res: Response, next: NextFunction): void {
  if (bridgeAuthDecision(req, IS_PRODUCTION)) return bridgeAuth(req, res, next);
  next();
}

// Minimal in-memory rate limiter. Not a replacement for a real edge limiter
// (e.g. Vercel/Cloudflare), but it stops trivial abuse of the proxy and
// bridges from a single origin.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30; // requests per window per IP
const RATE_CLEANUP_INTERVAL_MS = 300_000; // cleanup every 5 minutes
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

// Periodically remove expired buckets to prevent memory leaks.
const rateCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.resetAt < now) {
      rateBuckets.delete(ip);
    }
  }
}, RATE_CLEANUP_INTERVAL_MS);

// Allow the process to exit even if the timer is still active.
if (rateCleanupTimer.unref) {
  rateCleanupTimer.unref();
}

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    next();
    return;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  next();
}

// Builds and returns the Express app. Vercel (@vercel/node) imports this via
// server/vercel.ts; local/Electron run startServer() which listens on a port.
export function createApp() {
  const app = express();

  if (bridgesEnabled) {
    const amdProxy = [rateLimit, devLocalBridgeGuard];

    // AMD Cloud proxy: the site is HTTPS while the AMD machine is HTTP, and
    // browsers block that combination. The server performs the request instead.
    // The body is validated against a strict allowlist before any fetch.
    app.post("/api/amd-proxy", express.json({ limit: "2mb" }), ...amdProxy, async (req: Request, res: Response) => {
      try {
        const body = req.body ?? {};
        const model = typeof body.model === "string" ? body.model : "";
        if (!AMD_ALLOWED_MODELS.has(model)) {
          res.status(400).json({ error: "model not allowed" });
          return;
        }
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          res.status(400).json({ error: "body.messages must be a non-empty array" });
          return;
        }
        if (typeof body.max_tokens !== "number" || body.max_tokens > 4096) {
          res.status(400).json({ error: "max_tokens must be a number <= 4096" });
          return;
        }

        const amdRes = await fetch(AMD_MACHINE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: body.messages,
            max_tokens: body.max_tokens,
            temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
            stream: false,
          }),
          signal: AbortSignal.timeout(120_000),
        });
        const data = await amdRes.json();
        res.json(data);
      } catch (err) {
        const timedOut = err instanceof Error && err.name === "TimeoutError";
        res.status(timedOut ? 504 : 500).json({ error: "AMD proxy failed", detail: String(err) });
      }
    });

    // CAD generation bridge: natural language → build123d → STL. Executes
    // Python on the host — protected by BRIDGE_TOKEN + rate limit, and only
    // mounted at all when bridges are explicitly enabled.
    app.use("/api/cad/generate", ...amdProxy, createCadBridgeRouter());

    // Mesh post-processing bridge: STL → diagnostics / repair / decimate.
    app.use("/api/mesh/process", ...amdProxy, createMeshProcessRouter());

    // Slicer bridge: STL → G-code via a local slicer CLI.
    app.use("/api/slice", ...amdProxy, createSlicerRouter());

    // STEP file parser: STEP → geometry + metadata via OpenCASCADE WASM.
    app.use("/api/step", ...amdProxy, createStepRouter());

    // Tripo text-to-3D relay: the API key stays server-side; the browser only
    // talks to this proxy. Mounted under the same bridge guards as the other
    // host-side features so the operator's Tripo quota cannot be drained by
    // anonymous callers.
    app.use("/api/tripo", ...amdProxy, createTripoProxyRouter());

    // Agent pipeline trace capture — local fine-tuning data collection.
    // The browser POSTs each completed pipeline step here after every deep
    // analysis; we append it to a JSONL file that feeds
    // deploy/amd/build-dataset.py. Mounted only with the other local bridges,
    // never on a public host without BRIDGE_TOKEN (same guard as the rest).
    const AGENT_TRACE_PATH = path.join(
      process.cwd(),
      "deploy",
      "amd",
      "agent-traces.jsonl",
    );
    app.post(
      "/api/agent-trace",
      rateLimit,
      express.json({ limit: "1mb" }),
      async (req: Request, res: Response) => {
        const trace = req.body ?? {};
        if (typeof trace !== "object" || typeof (trace as { raw?: unknown }).raw !== "string") {
          res.status(400).json({ error: "invalid trace: raw required" });
          return;
        }
        try {
          await mkdir(path.dirname(AGENT_TRACE_PATH), { recursive: true });
          await appendFile(AGENT_TRACE_PATH, JSON.stringify(trace) + "\n", "utf-8");
          res.json({ ok: true });
        } catch {
          res.status(500).json({ error: "trace write failed" });
        }
      },
    );

    logger.info(`Bridges mounted${BRIDGE_TOKEN ? ' (BRIDGE_TOKEN auth)' : ' (NODE_ENV != production)'}`, {
      context: 'server',
    });
  } else {
    logger.warn('Production without BRIDGE_TOKEN — cad/mesh/slice/amd-proxy routes NOT mounted', {
      context: 'server',
    });
  }

  // -------------------------------------------------------------------------
  // LLM relay (/api/llm) — the CORS fix for BYOK providers.
  //
  // Unlike the bridges above (which execute code on this host), this route only
  // forwards JSON to third-party LLM endpoints. Anthropic / Moonshot / Gemini
  // block browser-origin CORS calls, so the browser cannot reach them directly.
  // The user's key travels through here per-request and is NEVER stored.
  //
  // Deliberately NOT behind bridgeAuth: that guard protects host-side
  // execution. Here the security controls are (1) a strict provider+model
  // allowlist, (2) the rate limiter, (3) a body size cap, and (4) the fact that
  // upstream rejects calls with no valid key. This is the mirror image of the
  // client-side model registry in client/src/lib/llmProxy.ts — keep in sync.
  // -------------------------------------------------------------------------
  // The /api/llm relay logic lives in server/llmRelay.ts (shared with the Vercel
  // function api/llm.ts) so local and deployed behavior stay identical.
  // Request context middleware - adds request ID and timing
  app.use(requestContext);

  // Health check routes (no auth required)
  app.use(healthRouter);

  app.post("/api/llm", express.json({ limit: "2mb" }), rateLimit, async (req: Request, res: Response) => {
    const { provider, apiKey, body } = (req.body ?? {}) as Record<string, unknown>;
    const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const result = await relayLLM({ provider: provider as string, apiKey, body, bearer });
    res.status(result.status).set("Content-Type", "application/json").send(result.text);
  });

  // Streaming LLM endpoint — SSE passthrough for real-time token output
  app.post("/api/llm/stream", express.json({ limit: "2mb" }), rateLimit, async (req: Request, res: Response) => {
    const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    // Inject bearer into req.body for the relay
    (req.body as Record<string, unknown>).bearer = bearer;
    await relayLLMStream(req, res);
  });

  // Share report links — public, no auth required
  app.use("/api/share", express.json({ limit: "5mb" }), createShareRouter());

  // Stripe payment — checkout, webhook, portal
  // Webhook needs raw body for signature verification, so mount it first
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res, next) => {
    // Pass raw body to the router
    (req as any).rawBody = req.body;
    next();
  });
  app.use("/api/stripe", express.json({ limit: "1mb" }), createStripeRouter());

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  // Error handling middleware (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** Local / Electron / `npm start` entry — Vercel uses the exported createApp instead. */
function startServer() {
  const app = createApp();
  const server = createServer(app);
  const port = process.env.PORT || 3000;
  
  // Initialize graceful shutdown
  initShutdown(server);
  
  server.listen(Number(port), HOST as string | undefined, () => {
    logger.info(`Server running on http://${HOST ?? '0.0.0.0'}:${port}/`, {
      context: 'server',
      metadata: {
        port,
        host: HOST ?? '0.0.0.0',
        nodeEnv: process.env.NODE_ENV ?? 'development',
        pid: process.pid,
      },
    });
  });
}

if (!process.env.VERCEL) {
  startServer();
}
