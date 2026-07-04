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

  it("auto-fixes TS2322 by inserting a ts-expect-error fallback comment", async () => {
    const source = "const width: string = 42;\n";
    const filePath = await createFixture(source);

    const fixed = await attemptAutoFix(
      `${filePath}(1,7): error TS2322: Type 'number' is not assignable to type 'string'.`,
      filePath
    );

    await expectFile(filePath).toContain("// @ts-expect-error: Auto-fix fallback for TS2322: Type 'number' is not assignable to type 'string'.");
    expect(fixed).toBe(true);
  });

  it("auto-fixes TS2339 by inserting a ts-expect-error fallback comment", async () => {
    const source = 'const part = { id: "a" };\nconsole.log(part.missing);\n';
    const filePath = await createFixture(source);

    const fixed = await attemptAutoFix(
      `${filePath}(2,18): error TS2339: Property 'missing' does not exist on type '{ id: string; }'.`,
      filePath
    );

    await expectFile(filePath).toContain("// @ts-expect-error: Auto-fix fallback for TS2339: Property 'missing' does not exist on type '{ id: string; }'.");
    expect(fixed).toBe(true);
  });

  it("auto-fixes TS2304 by adding import for common identifiers", async () => {
    const source = "const [val, setVal] = useState(0);\n";
    const filePath = await createFixture(source);

    const fixed = await attemptAutoFix(
      `${filePath}(1,23): error TS2304: Cannot find name 'useState'.`,
      filePath
    );

    await expectFile(filePath).toContain('import { useState } from "react";');
    await expectFile(filePath).toContain("const [val, setVal] = useState(0);");
    expect(fixed).toBe(true);
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
