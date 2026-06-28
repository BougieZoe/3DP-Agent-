import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attemptLLMFix } from "../llm";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const pendingDiffPath = path.join(
  "loops",
  "pending-fixes",
  "2026-06-28T10-20-30-000Z.diff"
);
const sourcePath = path.join(tmpdir(), "llm-fixer-source.ts");

describe("attemptLLMFix", () => {
  beforeEach(async () => {
    await rm(pendingDiffPath, { force: true });
    await rm(sourcePath, { force: true });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T10:20:30.000Z"));
    vi.mocked(execFile).mockImplementation((command, args, callback) => {
      const done = callback as (
        error: Error | null,
        stdout: string,
        stderr: string
      ) => void;

      done(
        null,
        [
          "--- a/tmp/fixture.ts",
          "+++ b/tmp/fixture.ts",
          "@@ -1 +1 @@",
          "-const width: string = 42;",
          '+const width: string = "42";',
        ].join("\n"),
        ""
      );

      return undefined as never;
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(pendingDiffPath, { force: true });
    await rm(sourcePath, { force: true });
  });

  it("writes a non-empty pending diff without modifying the source file", async () => {
    const source = "const width: string = 42;\n";
    await writeFile(sourcePath, source, "utf8");

    const generated = await attemptLLMFix(
      `${sourcePath}(1,7): error TS2322: Type 'number' is not assignable to type 'string'.`,
      sourcePath,
      source
    );

    const diff = await readFile(pendingDiffPath, "utf8");
    const sourceAfterFixAttempt = await readFile(sourcePath, "utf8");
    const execArgs = vi.mocked(execFile).mock.calls[0];

    expect(generated).toBe(true);
    expect(diff.trim()).not.toHaveLength(0);
    expect(diff).toContain("--- a/tmp/fixture.ts");
    expect(sourceAfterFixAttempt).toEqual(source);
    expect(execArgs[0]).toBe("codex");
    expect(execArgs[1]).toContain("exec");
    expect(String(execArgs[1].at(-1))).toContain(
      "Only output one unified diff"
    );
    expect(String(execArgs[1].at(-1))).toContain(
      "Do not modify files yourself"
    );
  });
});
