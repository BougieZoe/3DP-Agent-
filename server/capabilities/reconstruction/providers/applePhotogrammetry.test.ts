/**
 * Guard rails for the Apple Object Capture provider.
 *
 * These cases are the ones that must never regress: refusing to start a job that cannot
 * succeed, and telling the truth about availability. They deliberately avoid invoking the
 * Swift engines so they stay fast and runnable on machines without a Swift toolchain —
 * the real photo-to-mesh run is covered by the end-to-end smoke, not here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ApplePhotogrammetryProvider } from "./applePhotogrammetry.js";
import type { ReconstructionJob } from "../types.js";

const originalPlatform = process.platform;
let workRoot: string;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

function buildJob(images: string[], extra: Record<string, unknown> = {}): ReconstructionJob {
  const snapshot = (extra.input_snapshot as Record<string, unknown> | undefined) ?? {};
  return {
    job_id: "job_test",
    tenant_id: "local",
    workspace_id: "local",
    ...extra,
    input_snapshot: { images: images.map((imagePath) => ({ path: imagePath })), ...snapshot },
  } as unknown as ReconstructionJob;
}

async function writeFakePhotos(count: number): Promise<string[]> {
  const dir = path.join(workRoot, `photos_${count}`);
  await fs.mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const file = path.join(dir, `photo_${index}.jpg`);
    await fs.writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    paths.push(file);
  }
  return paths;
}

function stubToolchain(provider: ApplePhotogrammetryProvider): void {
  // Pretend the toolchain exists so the test exercises the photo-count guard instead of
  // failing on the host's compiler.
  vi.spyOn(provider as unknown as { swiftcAvailable: () => Promise<boolean> }, "swiftcAvailable").mockResolvedValue(true);
  vi.spyOn(provider as unknown as { osVersion: () => Promise<string> }, "osVersion").mockResolvedValue("macOS test");
}

beforeEach(async () => {
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apple-provider-test-"));
  setPlatform("darwin");
});

afterEach(async () => {
  setPlatform(originalPlatform);
  vi.restoreAllMocks();
  await fs.rm(workRoot, { recursive: true, force: true });
});

describe("ApplePhotogrammetryProvider", () => {
  it("refuses a photo set too small to reconstruct, before spawning the engine", async () => {
    const provider = new ApplePhotogrammetryProvider({ workRoot });
    stubToolchain(provider);
    const photos = await writeFakePhotos(2);

    await expect(provider.submit(buildJob(photos))).rejects.toMatchObject({
      code: "INPUT_INSUFFICIENT",
      httpStatus: 422,
    });
  });

  it("refuses scale_reference instead of returning a part at an unknown size", async () => {
    const provider = new ApplePhotogrammetryProvider({ workRoot });
    stubToolchain(provider);
    const photos = await writeFakePhotos(3);

    const job = buildJob(photos, { input_snapshot: { images: photos.map((p) => ({ path: p })), scale_reference: { kind: "board", known_mm: 50 } } });
    await expect(provider.submit(job)).rejects.toMatchObject({
      code: "SCALE_REFERENCE_UNSUPPORTED",
      httpStatus: 422,
    });
  });

  it("declares itself unavailable off macOS", async () => {
    setPlatform("linux");
    const provider = new ApplePhotogrammetryProvider({ workRoot });

    const capabilities = await provider.capabilities();
    expect(capabilities.available).toBe(false);
    expect(capabilities.unavailable_reason).toContain("macOS-only");
    expect(capabilities.outputs).toEqual(["stl"]);
  });

  it("declares itself unavailable when the Swift toolchain is missing", async () => {
    const provider = new ApplePhotogrammetryProvider({ workRoot });
    vi.spyOn(provider as unknown as { swiftcAvailable: () => Promise<boolean> }, "swiftcAvailable").mockResolvedValue(false);

    const capabilities = await provider.capabilities();
    expect(capabilities.available).toBe(false);
    expect(capabilities.unavailable_reason).toContain("xcode-select");
  });

  it("falls back to a known detail level instead of passing through junk", () => {
    // A typo in RECON_APPLE_DETAIL must not silently pick an arbitrary Swift default.
    const provider = new ApplePhotogrammetryProvider({ workRoot, detail: "ultra" });
    expect((provider as unknown as { detail: string }).detail).toBe("medium");
  });
});
