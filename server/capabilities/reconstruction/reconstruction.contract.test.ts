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
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import express from "express";
import type { Router } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FileJobStore } from "./jobStore.js";
import { createProvider } from "./providerRegistry.js";
import { createReconstructionRouter } from "./reconstructionRouter.js";
import { createReconstructionCapabilityRouter } from "./reconstructionRouter.js";
import { deliverWebhook, signBody } from "./webhook.js";
import type { StepExportInput, StepExporter } from "./exporters/step.js";
import type { CloudEvent } from "./webhook.js";
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

  /** When set, collect reports a real mesh file so derived outputs can be exercised. */
  outputPath?: string;

  async collect(): Promise<ReconOutput[]> {
    if (this.state !== "succeeded") return [];
    return [{ format: "stl", ...(this.outputPath ? { path: this.outputPath } : {}), bytes: 1234 }];
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

async function listen(router: Router, prefix = "/v1/reconstructions"): Promise<RunningServer> {
  const app = express();
  app.use(prefix, express.json({ limit: "1mb" }), router);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}${prefix}`,
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

/** Stand-in for a CAD kernel, so route behaviour is testable without FreeCAD installed. */
class FakeStepExporter implements StepExporter {
  readonly id = "fake-step";
  calls: StepExportInput[] = [];

  constructor(private readonly available = true) {}

  async availability() {
    return this.available
      ? ({ available: true, kernel: "freecad" } as const)
      : ({
          available: false,
          kernel: "none",
          unavailable_reason: "no CAD kernel installed in this test",
        } as const);
  }

  async convert(input: StepExportInput): Promise<void> {
    if (!this.available) throw new Error("no CAD kernel installed in this test");
    this.calls.push(input);
    await writeFile(input.outPath, "ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n", "utf8");
  }
}

async function routeHarness(options: {
  provider?: FakeProvider;
  stepExporter?: StepExporter;
  deliver?: typeof deliverWebhook;
  prefix?: string;
}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "recon-step-"));
  const store = new FileJobStore(root);
  const provider = options.provider ?? new FakeProvider();
  // These harnesses assert settlement, so the fake engine finishes on the first poll.
  provider.state = "succeeded";
  const server = await listen(
    createReconstructionRouter({
      store,
      provider,
      rootDir: root,
      ...(options.stepExporter ? { stepExporter: options.stepExporter } : {}),
      ...(options.deliver ? { deliver: options.deliver } : {}),
    }),
    options.prefix,
  );
  return {
    store,
    provider,
    server,
    close: async () => {
      await server.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function submit(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(baseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("STEP export channel", () => {
  it("converts the engine mesh and adds a step output when asked", async () => {
    const exporter = new FakeStepExporter();
    // A derived STEP needs a real mesh file on disk, so the fake engine writes one.
    const mesh = path.join(os.tmpdir(), `recon-mesh-${Date.now()}.stl`);
    await writeFile(mesh, "solid mesh\nendsolid mesh\n", "utf8");
    const provider = new FakeProvider();
    provider.outputPath = mesh;
    const harness = await routeHarness({ provider, stepExporter: exporter });
    try {
      const created = (await (
        await submit(harness.server.baseUrl, { ...submitBody, output: { formats: ["stl", "step"], units: "mm" } })
      ).json()) as { job_id: string };

      const settled = (await (await fetch(`${harness.server.baseUrl}/${created.job_id}`)).json()) as {
        status: string;
        outputs: { format: string; bytes: number }[];
      };

      expect(settled.status).toBe("succeeded");
      expect(settled.outputs.map((item) => item.format).sort()).toEqual(["step", "stl"]);
      expect(settled.outputs.find((item) => item.format === "step")?.bytes).toBeGreaterThan(0);
      expect(exporter.calls).toHaveLength(1);
      expect(exporter.calls[0]?.units).toBe("mm");
    } finally {
      await rm(mesh, { force: true });
      await harness.close();
    }
  });

  it("never invokes the kernel when STEP was not requested", async () => {
    const exporter = new FakeStepExporter();
    const harness = await routeHarness({ stepExporter: exporter });
    try {
      const created = (await (await submit(harness.server.baseUrl, submitBody)).json()) as { job_id: string };
      await fetch(`${harness.server.baseUrl}/${created.job_id}`);
      expect(exporter.calls).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it("refuses a STEP request up front when the channel is unavailable", async () => {
    const harness = await routeHarness({ stepExporter: new FakeStepExporter(false) });
    try {
      const response = await submit(harness.server.baseUrl, { ...submitBody, output: { formats: ["step"] } });
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("STEP_EXPORT_UNAVAILABLE");
      // Refused before a job existed, so there is nothing to bill and nothing to poll.
      expect(await harness.store.listUsage()).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});

describe("webhook events", () => {
  it("delivers exactly one CloudEvent 1.0 on the terminal transition", async () => {
    const seen: { event: CloudEvent; url: string }[] = [];
    const deliver: typeof deliverWebhook = async ({ url, event }) => {
      seen.push({ event, url });
      return { status: "delivered", http_status: 204, at: new Date().toISOString() };
    };
    const harness = await routeHarness({ deliver });
    try {
      const created = (await (
        await submit(harness.server.baseUrl, { ...submitBody, webhook_url: "https://example.test/hook" })
      ).json()) as { job_id: string };

      const first = (await (await fetch(`${harness.server.baseUrl}/${created.job_id}`)).json()) as Record<string, any>;
      await fetch(`${harness.server.baseUrl}/${created.job_id}`);

      expect(seen).toHaveLength(1);
      expect(seen[0]?.event.specversion).toBe("1.0");
      expect(seen[0]?.event.type).toBe("io.3dp.reconstruction.succeeded.v1");
      expect(seen[0]?.event.subject).toBe(created.job_id);
      expect(seen[0]?.event.source).toBe("urn:3dp:capability:photo-to-cad");
      expect((seen[0]?.event.data as Record<string, unknown>).job_id).toBe(created.job_id);

      // The callback target is a bearer secret; polling must never echo it back.
      expect(JSON.stringify(first)).not.toContain("example.test");
      expect(first.webhook).toEqual({ configured: true, last_delivery: expect.objectContaining({ status: "delivered" }) });
    } finally {
      await harness.close();
    }
  });

  it("keeps the job successful when the callback fails", async () => {
    const deliver: typeof deliverWebhook = async () => ({
      status: "failed",
      http_status: 500,
      error: "Webhook responded 500.",
      at: new Date().toISOString(),
    });
    const harness = await routeHarness({ deliver });
    try {
      const created = (await (
        await submit(harness.server.baseUrl, { ...submitBody, webhook_url: "https://example.test/hook" })
      ).json()) as { job_id: string };
      const polled = (await (await fetch(`${harness.server.baseUrl}/${created.job_id}`)).json()) as Record<string, any>;
      expect(polled.status).toBe("succeeded");
      expect(polled.webhook.last_delivery.status).toBe("failed");
    } finally {
      await harness.close();
    }
  });

  it("posts a signed application/cloudevents+json envelope over HTTP", async () => {
    const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
    const receiver = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.statusCode = 204;
        res.end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const { port } = receiver.address() as AddressInfo;
    try {
      const event: CloudEvent = {
        specversion: "1.0",
        id: "evt_test",
        source: "urn:3dp:capability:photo-to-cad",
        type: "io.3dp.reconstruction.succeeded.v1",
        subject: "job_0123456789ab",
        time: new Date().toISOString(),
        datacontenttype: "application/json",
        data: { job_id: "job_0123456789ab" },
      };
      const delivery = await deliverWebhook({
        url: `http://127.0.0.1:${port}/hook`,
        event,
        secret: "test-secret",
      });

      expect(delivery.status).toBe("delivered");
      expect(delivery.http_status).toBe(204);
      expect(received).toHaveLength(1);
      expect(received[0]?.headers["content-type"]).toBe("application/cloudevents+json");
      expect(received[0]?.headers["ce-type"]).toBe("io.3dp.reconstruction.succeeded.v1");
      expect(received[0]?.headers["ce-specversion"]).toBe("1.0");
      expect(received[0]?.headers["x-3dp-signature"]).toBe(signBody(received[0]!.body, "test-secret"));
    } finally {
      await new Promise<void>((resolve, reject) =>
        receiver.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("reports a refused callback as a failed delivery instead of throwing", async () => {
    const receiver = http.createServer((_req, res) => {
      res.statusCode = 502;
      res.end("nope");
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const { port } = receiver.address() as AddressInfo;
    try {
      const delivery = await deliverWebhook({
        url: `http://127.0.0.1:${port}/hook`,
        event: {
          specversion: "1.0",
          id: "evt_fail",
          source: "urn:3dp:capability:photo-to-cad",
          type: "io.3dp.reconstruction.failed.v1",
          subject: "job_0123456789ab",
          time: new Date().toISOString(),
          datacontenttype: "application/json",
          data: {},
        },
      });
      expect(delivery.status).toBe("failed");
      expect(delivery.http_status).toBe(502);
    } finally {
      await new Promise<void>((resolve, reject) =>
        receiver.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

describe("capability self-description", () => {
  it("advertises STEP as a derived output and names every event type", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "recon-discovery-"));
    const exporter = new FakeStepExporter(false);
    const server = await listen(
      createReconstructionCapabilityRouter({ store: new FileJobStore(root), provider: new FakeProvider(), rootDir: root, stepExporter: exporter }),
      "/v1/capabilities/reconstruction",
    );
    try {
      const body = (await (await fetch(server.baseUrl)).json()) as Record<string, any>;
      expect(body.capability).toBe("photo-to-cad");
      expect(body.derived_outputs.step.available).toBe(false);
      expect(body.derived_outputs.step.unavailable_reason).toBeTruthy();
      expect(body.event_types).toContain("io.3dp.reconstruction.cancelled.v1");
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
