import { exec } from "node:child_process";
import { promisify } from "node:util";

import type { VerificationResult } from "../types.js";
import { config } from "../utils/config.js";

const execAsync = promisify(exec);

export async function verifyTypecheck(): Promise<VerificationResult> {
  try {
    const { stdout, stderr } = await execAsync("pnpm check", {
      timeout: config.timeouts.typecheck,
    });

    return {
      ok: true,
      output: stdout || stderr,
    };
  } catch (error) {
    const err = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: string;
      killed?: boolean;
    };

    if (err.killed || err.code === "ETIMEDOUT") {
      return {
        ok: false,
        output: `Typecheck execution timed out after ${config.timeouts.typecheck}ms`,
      };
    }

    return {
      ok: false,
      output: err.stderr || err.stdout || err.message,
    };
  }
}