import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function runCommand(command: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(command);
    return {
      ok: true,
      output: stdout || stderr || "Command executed successfully"
    };
  } catch (error: any) {
    const errOutput = error.stderr || error.stdout || error.message;
    return {
      ok: false,
      output: errOutput
    };
  }
}

export function logSection(title: string) {
  console.log(`\n=== ${title} ===`);
}