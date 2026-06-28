import { exec } from "node:child_process";
import { promisify } from "node:util";

import type { VerificationResult } from "../types";

const execAsync = promisify(exec);

export async function verifyTypecheck(): Promise<VerificationResult> {
  try {
    const { stdout, stderr } = await execAsync("pnpm check");

    return {
      ok: true,
      output: stdout || stderr,
    };
  } catch (error) {
    const err = error as Error & {
      stdout?: string;
      stderr?: string;
    };

    return {
      ok: false,
      output: err.stderr ?? err.stdout ?? err.message,
    };
  }
}