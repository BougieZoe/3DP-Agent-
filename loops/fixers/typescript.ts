import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runCommand } from "../utils/helpers.js";

type TypeScriptDiagnostic = {
  filePath: string;
  line: number;
  column: number;
  code: string;
  message: string;
};

type FixResult = {
  changed: boolean;
  description?: string;
  reason?: string;
};

const DEFAULT_FILE_PATH = "client/src/components/CADWorkspace.tsx";
const MANUAL_REVIEW_MESSAGE = "这类错误需要人工判断,不会自动修";

const DIAGNOSTIC_WITH_LOCATION =
  /^(.*?\.(?:ts|tsx|js|jsx))\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/;
const DIAGNOSTIC_COLON_LOCATION =
  /^(.*?\.(?:ts|tsx|js|jsx)):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s+(.+)$/;
const DIAGNOSTIC_WITHOUT_LOCATION = /^error\s+(TS\d+):\s+(.+)$/;

export async function attemptAutoFix(
  errorOutput: string,
  filePath = DEFAULT_FILE_PATH
): Promise<boolean> {
  console.log("🔧 Attempting TypeScript auto fix");

  const diagnostics = parseTypeScriptDiagnostics(errorOutput, filePath);
  if (diagnostics.length === 0) {
    console.log("→ No TypeScript diagnostics found in fixer input.");
    return false;
  }

  let changedAnyFile = false;
  const diagnosticsByFile = groupDiagnosticsByFile(diagnostics, filePath);

  for (const [diagnosticFilePath, fileDiagnostics] of diagnosticsByFile) {
    const absolutePath = path.resolve(diagnosticFilePath);
    let source: string;

    try {
      source = await readFile(absolutePath, "utf8");
    } catch (error) {
      console.log(`→ Could not read ${diagnosticFilePath}: ${String(error)}`);
      continue;
    }

    const lines = source.split(/\r?\n/);
    let changedThisFile = false;

    const orderedDiagnostics = [...fileDiagnostics].sort((left, right) => {
      if (left.line !== right.line) return right.line - left.line;
      return right.column - left.column;
    });

    for (const diagnostic of orderedDiagnostics) {
      const result = applyDiagnosticFix(lines, diagnostic);
      const location = `${diagnosticFilePath}:${diagnostic.line}:${diagnostic.column}`;

      if (result.changed) {
        changedThisFile = true;
        console.log(
          `→ ${diagnostic.code} ${location} ${result.description ?? "fixed"}`
        );
      } else if (result.reason) {
        console.log(`→ ${diagnostic.code} ${location} ${result.reason}`);
      }
    }

    if (changedThisFile) {
      await writeFile(absolutePath, lines.join("\n"), "utf8");
      changedAnyFile = true;

      const prettierResult = await runCommand(
        `pnpm exec prettier --write ${quoteShellArg(diagnosticFilePath)}`
      );
      if (!prettierResult.ok) {
        console.log(`→ Prettier failed for ${diagnosticFilePath}`);
      }
    }
  }

  if (!changedAnyFile) {
    console.log(
      "→ Diagnostics were parsed, but no safe automatic rule matched."
    );
    return false;
  }

  console.log("✅ Auto fix changed at least one file");
  return true;
}

export function parseTypeScriptDiagnostics(
  output: string,
  fallbackFilePath = DEFAULT_FILE_PATH
): TypeScriptDiagnostic[] {
  const diagnostics: TypeScriptDiagnostic[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const locationMatch =
      line.match(DIAGNOSTIC_WITH_LOCATION) ??
      line.match(DIAGNOSTIC_COLON_LOCATION);

    if (locationMatch) {
      diagnostics.push({
        filePath: locationMatch[1],
        line: Number(locationMatch[2]),
        column: Number(locationMatch[3]),
        code: locationMatch[4],
        message: locationMatch[5],
      });
      continue;
    }

    const noLocationMatch = line.match(DIAGNOSTIC_WITHOUT_LOCATION);
    if (noLocationMatch) {
      diagnostics.push({
        filePath: fallbackFilePath,
        line: 1,
        column: 1,
        code: noLocationMatch[1],
        message: noLocationMatch[2],
      });
    }
  }

  return diagnostics;
}

function groupDiagnosticsByFile(
  diagnostics: TypeScriptDiagnostic[],
  fallbackFilePath: string
): Map<string, TypeScriptDiagnostic[]> {
  const groups = new Map<string, TypeScriptDiagnostic[]>();

  for (const diagnostic of diagnostics) {
    const filePath = diagnostic.filePath || fallbackFilePath;
    const existing = groups.get(filePath) ?? [];
    existing.push(diagnostic);
    groups.set(filePath, existing);
  }

  return groups;
}

function applyDiagnosticFix(
  lines: string[],
  diagnostic: TypeScriptDiagnostic
): FixResult {
  switch (diagnostic.code) {
    case "TS2552":
      return fixDidYouMeanName(lines, diagnostic);
    case "TS2322":
    case "TS2339":
      return { changed: false, reason: MANUAL_REVIEW_MESSAGE };
    default:
      return { changed: false };
  }
}

function fixDidYouMeanName(
  lines: string[],
  diagnostic: TypeScriptDiagnostic
): FixResult {
  const match = diagnostic.message.match(
    /Cannot find name '([^']+)'\. Did you mean '([^']+)'\?/
  );
  if (!match) return { changed: false };

  return replaceIdentifierAtDiagnosticColumn(
    lines,
    diagnostic,
    match[1],
    match[2]
  )
    ? { changed: true, description: `renamed ${match[1]} to ${match[2]}` }
    : { changed: false };
}

function replaceIdentifierAtDiagnosticColumn(
  lines: string[],
  diagnostic: TypeScriptDiagnostic,
  identifier: string,
  replacement: string
): boolean {
  const index = diagnostic.line - 1;
  const line = lines[index];
  if (line === undefined) return false;

  const token = findIdentifierAroundColumn(
    line,
    Math.max(0, diagnostic.column - 1)
  );
  if (token?.text === identifier) {
    lines[index] =
      line.slice(0, token.start) + replacement + line.slice(token.end);
    return true;
  }

  const fallbackIndex = findTokenIndexNearColumn(
    line,
    identifier,
    diagnostic.column
  );
  if (fallbackIndex === -1) return false;

  lines[index] =
    line.slice(0, fallbackIndex) +
    replacement +
    line.slice(fallbackIndex + identifier.length);
  return true;
}

function findIdentifierAroundColumn(
  line: string,
  columnIndex: number
): { start: number; end: number; text: string } | undefined {
  if (!line) return undefined;

  let start = Math.min(columnIndex, line.length - 1);
  while (start > 0 && /[$\w]/.test(line[start - 1])) start--;

  let end = Math.max(columnIndex, 0);
  while (end < line.length && /[$\w]/.test(line[end])) end++;

  const text = line.slice(start, end);
  if (!/^[$A-Z_a-z][$\w]*$/.test(text)) return undefined;
  return { start, end, text };
}

function findTokenIndexNearColumn(
  line: string,
  token: string,
  column: number
): number {
  const preferredIndex = Math.max(0, column - 1);
  const matches: number[] = [];
  let index = line.indexOf(token);

  while (index !== -1) {
    matches.push(index);
    index = line.indexOf(token, index + token.length);
  }

  if (matches.length === 0) return -1;
  return matches.sort(
    (left, right) =>
      Math.abs(left - preferredIndex) - Math.abs(right - preferredIndex)
  )[0];
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
