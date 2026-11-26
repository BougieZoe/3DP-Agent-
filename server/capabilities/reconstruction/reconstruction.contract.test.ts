/**
 * Contract tests for the Photo-to-CAD capability.
 *
 * Two layers, both required by the contract doc (§5 Acceptance checklist):
 *   1. Provider contract suite — every provider implementation must pass the same list.
 *   2. Route contract — tenant defaults, idempotency, honest failure, single usage row.
 *
 * These tests assert behaviour the contract promises, not implementation details.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import express from "express";
import type { Router } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FileJobStore } from "./jobStore.js";
import { createProvider } from "./providerRegistry.js";
import { createReconstructionRouter } from "./reconstructionRouter.js";
import { CapabilityError } from "./types.js";
import type {
  ProviderCapabilities,
  ProviderStatus,
  ProviderSubmitResult,
  ReconOutput,
  ReconstructionJob,
  ReconstructionProvider,
} from "./types.js";
import { MeshroomProvider } from "./providers/meshroom.js";

/** Minimal provider used to exercise the contract independent of any real engine. */
class FakeProvider implements ReconstructionProvider {
  readonly id = "fake";
  readonly version = "1.0.0";
  state: "running" | "succeeded" = "running";
  submitted: ReconstructionJob[] = [];

  constructor(private readonly available = true) {}

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      id: this.id,
      version: this.version,
      available: this.available,
      ...(this.available ? {} : { unavailable_reason: "fake engine disabled" }),
      inputs: ["image_set"],
      outputs: ["stl"],
      needs_gpu: false,
      license: "test-only",
    };
  }

  async submit(job: ReconstructionJob): Promise<ProviderSubmitResult> {
    if (!this.available) throw new CapabilityError("ENGINE_NOT_AVAILABLE", "fake engine disabled", 503);
    this.submitted.push(job);
    return { providerJobId: `${job.job_id}:1` };
  }

  async status(): Promise<ProviderStatus> {
    return { state: this.state, percent: this.state === "succeeded" ? 100 : 42, stage: "meshing" };
  }

  async cancel(): Promise<void> {
    this.state = "succeeded";
  }

  async collect(): Promise<ReconOutput[]> {
    return this.state === "succeeded" ? [{ format: "stl", bytes: 1234 }] : [];
  }
}

function assertProviderContract(provider: ReconstructionProvider): Promise<void> {
  return (async () => {
    const capabilities = await provider.capabilities();
    expect(typeof capabilities.id).toBe("string");
    expect(typeof capabilities.license).toBe("string");
    expect(Array.isArray(capabilities.inputs)).toBe(true);
    expect(Array.isArray(capabilities.outputs)).toBe(true);
    expect(typeof capabilities.available).toBe("boolean");
    // An unavailable provider must explain itself rather than fail silently.
    if (!capabilities.available) expect(capabilities.unavailable_reason).toBeTruthy();

    // Collecting before a job exists must degrade to "nothing yet", never throw a lie.
    const empty = await provider.collect("missing:0", {} as ReconstructionJob);
    expect(empty).toEqual([]);

    if (!capabilities.available) {
      await expect(provider.submit({} as ReconstructionJob)).rejects.toMatchObject({
        code: "ENGINE_NOT_AVAILABLE",
      });
    }
  })();
}

interface RunningServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function listen(router: Router): Promise<RunningServer> {
  const app = express();
  app.use("/v1/reconstructions", express.json({ limit: "1mb" }), router);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1/reconstructions`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

const submitBody = {
  workspace_id: "ws_test",
  input: {
    images: [
      { path: "/tmp/a.jpg", role: "overview" },
      { path: "/tmp/b.jpg", role: "detail" },
    ],
    scale_reference: { kind: "calibration_board", known_mm: 50 },
  },
};

describe("provider contract suite", () => {
  it("pseudo provider satisfies the provider contract", async () => {
    await assertProviderContract(new FakeProvider());
  });

  it("unavailable provider refuses work instead of faking success", async () => {
    await assertProviderContract(new FakeProvider(false));
  });

  it("meshroom provider satisfies the same contract on this host", async () => {
    const provider = new MeshroomProvider({ workRoot: path.join(os.tmpdir(), "recon-contract") });
    await assertProviderContract(provider);
  });

  it("unknown RECON_PROVIDER resolves to an unavailable provider, not a crash", async () => {
    const previous = process.env.RECON_PROVIDER;
    process.env.RECON_PROVIDER = "definitely-not-an-engine";
    try {
      const provider = createProvider({ workRoot: os.tmpdir() });
      await assertProviderContract(provider);
      const capabilities = await provider.capabilities();
      expect(capabilities.available).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.RECON_PROVIDER;
      else process.env.RECON_PROVIDER = previous;
    }
  });
});

describe("route contract", () => {
  let tmpRoot: string;
  let store: FileJobStore;
  let provider: FakeProvider;
  let server: RunningServer;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "recon-route-"));
    store = new FileJobStore(tmpRoot);
    provider = new FakeProvider();
    server = await listen(createReconstructionRouter({ store, provider }));
  });

  afterAll(async () => {
    await server.close();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("defaults tenant_id and workspace_id to local instead of failing", async () => {
    const response = await fetch(server.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submitBody),
    });
    expect(response.status).toBe(202);
    const job = (await response.json()) as ReconstructionJob;
    expect(job.tenant_id).toBe("local");
    expect(job.workspace_id).toBe("ws_test");
    expect(job.status).toBe("running");
    // Internal execution state must not leak onto the wire.
    expect(job).not.toHaveProperty("input_snapshot");
    expect(job).not.toHaveProperty("provider_job_id");
  });

  it("passes the input snapshot to the provider (not to the client)", async () => {
    expect(provider.submitted.at(-1)?.input_snapshot?.images).toHaveLength(2);
  });

  it("replaying an Idempotency-Key does not start a second reconstruction", async () => {
    const key = "idem-key-001";
    const send = () =>
      fetch(server.baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(submitBody),
      });
    const first = (await (await send()).json()) as ReconstructionJob;
    const submissionsBefore = provider.submitted.length;
    const replayResponse = await send();
    const replay = (await replayResponse.json()) as ReconstructionJob;

    expect(replay.job_id).toBe(first.job_id);
    expect(replayResponse.headers.get("idempotency-replayed")).toBe("true");
    expect(provider.submitted.length).toBe(submissionsBefore);
  });

  it("settles a terminal job and writes exactly one usage record", async () => {
    provider.state = "succeeded";
    const created = (await (
      await fetch(server.baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submitBody),
      })
    ).json()) as ReconstructionJob;

    const settled = (await (await fetch(`${server.baseUrl}/${created.job_id}`)).json()) as ReconstructionJob;
    expect(settled.status).toBe("succeeded");
    expect(settled.outputs).toHaveLength(1);

    // Polling again must not double-bill.
    await fetch(`${server.baseUrl}/${created.job_id}`);
    const usage = (await store.listUsage()).filter((row) => row.job_id === created.job_id);
    expect(usage).toHaveLength(1);
    expect(usage[0]?.output_bytes).toBe(1234);
    expect(usage[0]?.gpu_seconds).toBeNull();
    provider.state = "running";
  });

  it("returns a machine-readable 404 for an unknown job", async () => {
    const response = await fetch(`${server.baseUrl}/job_000000000000`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("JOB_NOT_FOUND");
  });

  it("rejects a malformed body with REQUEST_INVALID", async () => {
    const response = await fetch(server.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { images: [] } }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("REQUEST_INVALID");
  });
});

describe("honest failure", () => {
  it("refuses to submit when no engine is available", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "recon-unavailable-"));
    const store = new FileJobStore(tmpRoot);
    const server = await listen(
      createReconstructionRouter({ store, provider: new FakeProvider(false) }),
    );
    try {
      const response = await fetch(server.baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submitBody),
      });
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("ENGINE_NOT_AVAILABLE");
      // No usage row: nothing ran, so nothing is billable.
      expect(await store.listUsage()).toEqual([]);
    } finally {
      await server.close();
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
