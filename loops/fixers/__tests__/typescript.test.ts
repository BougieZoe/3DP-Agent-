import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { attemptAutoFix } from "../typescript";

const tempDirs: string[] = [];

describe("attemptAutoFix", () => {
  afterEach(async () => {
    vi.restoreAllMocks();

    const dirs = tempDirs.splice(0);
    await Promise.all(
      dirs.map(dir => rm(dir, { force: true, recursive: true }))
    );
  });

  it("fixes TS2552 by applying the suggested identifier", async () => {
    const filePath = await createFixture(
      'const color = "blue";\nconst label = colour;\n'
    );

    const fixed = await attemptAutoFix(
      `${filePath}(2,15): error TS2552: Cannot find name 'colour'. Did you mean 'color'?`,
      filePath
    );

    await expectFile(filePath).toContain("const label = color;");
    expect(fixed).toBe(true);
  });

  it("does not auto-fix TS2322 because assignability needs manual review", async () => {
    const source = "const width: string = 42;\n";
    const filePath = await createFixture(source);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const fixed = await attemptAutoFix(
      `${filePath}(1,7): error TS2322: Type 'number' is not assignable to type 'string'.`,
      filePath
    );

    await expectFile(filePath).toEqual(source);
    expect(logSpy.mock.calls.flat().join("\n")).toContain(
      "这类错误需要人工判断,不会自动修"
    );
    expect(fixed).toBe(false);
  });

  it("does not auto-fix TS2339 because missing properties need manual review", async () => {
    const source = 'const part = { id: "a" };\nconsole.log(part.missing);\n';
    const filePath = await createFixture(source);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const fixed = await attemptAutoFix(
      `${filePath}(2,18): error TS2339: Property 'missing' does not exist on type '{ id: string; }'.`,
      filePath
    );

    await expectFile(filePath).toEqual(source);
    expect(logSpy.mock.calls.flat().join("\n")).toContain(
      "这类错误需要人工判断,不会自动修"
    );
    expect(fixed).toBe(false);
  });
});

async function createFixture(source: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "loops-typescript-fixer-"));
  tempDirs.push(dir);

  const filePath = path.join(dir, "fixture.ts");
  await writeFile(filePath, source, "utf8");
  return filePath;
}

function expectFile(filePath: string) {
  return {
    async toEqual(expected: string) {
      const actual = await readFile(filePath, "utf8");
      expect(actual).toEqual(expected);
    },
    async toContain(expected: string) {
      const actual = await readFile(filePath, "utf8");
      expect(actual).toContain(expected);
    },
  };
}
