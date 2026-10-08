import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_FILE_PATH = "client/src/components/CADWorkspace.tsx";
const PENDING_FIXES_DIR = path.join("loops", "pending-fixes");
const MAX_SNIPPET_CHARS = 4_000;

/**
 * Asks a Codex subprocess to draft a unified diff and stores it for review.
 *
 * Returns true only when a non-empty pending diff file was generated. It does
 * not mean the TypeScript error is fixed, and this function never applies the
 * generated diff or edits the source file directly.
 */
export async function attemptLLMFix(
  errorOutput: string,
  filePath = DEFAULT_FILE_PATH,
  codeSnippet?: string
): Promise<boolean> {
  console.log("🤖 Requesting pending diff from codex exec");

  const snippet = codeSnippet ?? (await readRelevantSnippet(filePath));
  const prompt = buildPrompt(errorOutput, filePath, snippet);
  const stdout = await runCodexExec(prompt);

  const diff = stdout.trim();
if (!diff || !/^(diff --git|---\s|\+\+\+\s)/m.test(diff)) {
  console.log("→ codex exec 没有返回一个像样的 unified diff,拒绝写入。");
  return false;
}

  const diffPath = await writePendingDiff(diff);
  console.log(`→ Pending diff written to ${diffPath}`);
  return true;
}

function runCodexExec(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "codex",
      [
        "exec",
        "--sandbox",
        "read-only",
        prompt,
      ],
      { timeout: 60000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        if (stderr) {
          console.log(`→ codex exec stderr: ${stderr}`);
        }

        resolve(stdout.toString());
      }
    );
  });
}

function buildPrompt(
  errorOutput: string,
  filePath: string,
  codeSnippet: string
): string {
  return [
    "You are fixing a TypeScript error in a CAD/geometry codebase.",
    "只输出一个 unified diff,不要解释,不要自己改文件。",
    "Only output one unified diff.",
    "Do not explain.",
    "Do not modify files yourself.",
    "The diff must be reviewable before it is applied.",
    "",
    `File: ${filePath}`,
    "",
    "Full tsc error output:",
    "```",
    errorOutput,
    "```",
    "",
    "Relevant code snippet:",
    "```ts",
    codeSnippet,
    "```",
  ].join("\n");
}

async function readRelevantSnippet(filePath: string): Promise<string> {
  try {
    const source = await readFile(path.resolve(filePath), "utf8");
    return source.slice(0, MAX_SNIPPET_CHARS);
  } catch {
    return "(Could not read source file. Use the error output only.)";
  }
}

async function writePendingDiff(diff: string): Promise<string> {
  await mkdir(PENDING_FIXES_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const diffPath = path.join(PENDING_FIXES_DIR, `${timestamp}.diff`);
  await writeFile(diffPath, `${diff}\n`, "utf8");
  return diffPath;
}
