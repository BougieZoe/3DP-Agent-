/**
 * cadSandbox — Phase 0 hardening for running untrusted build123d source.
 *
 * The bridge executes LLM-authored Python. Three layers of defense:
 *   1. scanSourceSafety() rejects dangerous imports/calls before execution.
 *   2. The interpreter runs with `-I` (isolated: ignores PYTHONPATH/HOME env
 *      and user site-packages) and a sanitized env that strips host secrets.
 *   3. Best-effort resource ceilings (virtual memory / CPU / output size) via
 *      a ulimit wrapper, plus the existing wall-clock timeout (SIGKILL).
 *
 * Full container + seccomp isolation is a deployment concern for hosted runs;
 * this is the code-level baseline that must always apply.
 */

const FORBIDDEN_IMPORTS = [
  'os', 'sys', 'subprocess', 'socket', 'ctypes', 'importlib', 'builtins',
  'requests', 'urllib', 'http', 'ftplib', 'shutil', 'pathlib', 'tempfile',
  'multiprocessing', 'pty', 'pickle', 'marshal', 'crypt', 'resource',
  'signal', 'sysconfig', 'pkgutil', 'runpy', 'dl', 'gc', 'codecs',
];

const FORBIDDEN_PATTERNS: RegExp[] = [
  /eval\s*\(/,
  /exec\s*\(/,
  /__import__\s*\(/,
  /open\s*\(\s*['"]/, // opening a file by string literal
  /compile\s*\(/,
  /input\s*\(/,
  /getattr\s*\(\s*['"]__/,
  /globals\s*\(\s*\)/,
  /locals\s*\(\s*\)/,
];

export interface SourceSafety {
  safe: boolean;
  reason?: string;
}

export function scanSourceSafety(source: string): SourceSafety {
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    // `import X` / `from X import ...` — check the top-level module.
    const importMatch = trimmed.match(/^(?:import|from)\s+([\w.]+)/);
    if (importMatch) {
      const mod = importMatch[1].split('.')[0];
      if (FORBIDDEN_IMPORTS.includes(mod)) {
        return { safe: false, reason: `forbidden import: ${mod}` };
      }
    }
    for (const pat of FORBIDDEN_PATTERNS) {
      if (pat.test(trimmed)) {
        return { safe: false, reason: `forbidden call: ${pat.source}` };
      }
    }
  }
  return { safe: true };
}

/** Minimal env for running untrusted code — strips host secrets & config. */
export const SANDBOX_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: process.env.HOME ?? '/tmp',
  LANG: process.env.LANG ?? 'C.UTF-8',
  TMPDIR: process.env.TMPDIR ?? '/tmp',
  PYTHONUNBUFFERED: '1',
  PYTHONDONTWRITEBYTECODE: '1',
};

/** Best-effort resource ceilings (ignored silently where unsupported). */
export const SANDBOX_MEM_KB = 2_000_000; // ~2 GB virtual
export const SANDBOX_CPU_S = 120;
export const SANDBOX_FILE_KB = 102_400; // ~100 MB of output files
