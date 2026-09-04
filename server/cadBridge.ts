import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express, { Router, type Request, type Response } from 'express';
import type { GeneratedArtifact, GeneratedModel } from '../shared/domain/generatedModel';
import { repairCadSource, type RepairType } from './cadRepair';
import {
  SANDBOX_ENV,
  SANDBOX_MEM_KB,
  SANDBOX_CPU_S,
  SANDBOX_FILE_KB,
  scanSourceSafety,
} from './cadSandbox';
import { runFailoverSequence, type LlmCandidate } from './llmFailover';

const SKILL_DIR =
  process.env.CAD_SKILL_DIR ?? path.join(os.homedir(), '.agents', 'skills', 'cad');
const STEP_CLI_DIR = path.join(SKILL_DIR, 'scripts', 'step');
const PROJECT_ROOT = process.cwd();
const DEFAULT_VENV_PYTHON = path.join(PROJECT_ROOT, '.cad-bridge', '.venv', 'bin', 'python');
const RUNS_ROOT = path.join(PROJECT_ROOT, '.cad-bridge', 'runs');
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 600_000;
// Authoring build123d source from a natural-language prompt is a single,
// often multi-step code-gen call — 30s was far too tight and caused frequent
// "TimeoutError: The operation was aborted due to timeout". 150s stays under
// the client request budget (180s) while giving reasoning models headroom.
const LLM_TIMEOUT_MS = 150_000;
const STDERR_TAIL = 4000;
const MAX_REPAIR_ATTEMPTS = 2;
const MAX_LLM_FIX_ATTEMPTS = 3;
const METRICS_PATH = path.join(PROJECT_ROOT, '.cad-bridge', 'metrics.jsonl');

interface BridgeLlmConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

/** Ordered LLM candidates for source authoring: [primary, ...fallbacks]. */
type BridgeLlmCandidates = BridgeLlmConfig[];

interface BridgeGenerateBody {
  prompt?: string;
  locale?: string;
  constraints?: {
    targetPrinter?: string;
    materialName?: string;
    maxDimensionMm?: number;
  };
  baseModel?: { generatedModelId: string; editInstruction: string };
  /** Legacy single-provider field — keep for compatibility. */
  llm?: BridgeLlmConfig;
  /** Ordered [primary, ...fallbacks]; used when llmCandidates is absent. */
  llmCandidates?: BridgeLlmCandidates;
  generatorSource?: string;
  meshTolerance?: { linear?: number; angular?: number };
  timeoutMs?: number;
  /** DfAM analysis context — issues to address in this generation. */
  analysisContext?: {
    issues: Array<{
      type: string;
      priority?: string;
      description: string;
      implementation?: string;
      recommendation?: string;
    }>;
    originalPrompt?: string;
    printabilityScore?: number;
  };
}

export function resolvePython(): string {
  if (process.env.CAD_BRIDGE_PYTHON) return process.env.CAD_BRIDGE_PYTHON;
  if (existsSync(DEFAULT_VENV_PYTHON)) return DEFAULT_VENV_PYTHON;
  return 'python3';
}

function bridgeReady(): { ready: boolean; python: string; reason?: string } {
  const python = resolvePython();
  if (!existsSync(STEP_CLI_DIR)) {
    return { ready: false, python, reason: `CAD skill not found at ${SKILL_DIR}` };
  }
  if (path.isAbsolute(python) && !existsSync(python)) {
    return { ready: false, python, reason: `Python interpreter not found at ${python}` };
  }
  return { ready: true, python };
}

const CAD_SYSTEM_PROMPT = `You are a build123d CAD code generator. Output ONLY valid Python.

RULES:
1. First line: from build123d import *
2. Define: def gen_step():
3. Return ONE closed solid. No type hints on def.
4. Output raw code ONLY. No markdown, no backticks, no explanations.
5. NEVER: export_*, show_*, print, CadQuery, OCP, or external libs.
6. Put Pos() LEFT of the shape: Pos(x,y,z) * Box(...) — NOT Box(...) * Pos(...)
7. Align: use align=(Align.CENTER, Align.CENTER, Align.CENTER) or Align.MIN for stacking.
8. Maximum ~20 lines of code. Keep it simple.

FORBIDDEN PATTERNS (your code WILL crash if you use these):
- DO NOT use BuildPart(), with BuildPart(), with Locations(), or any Builder pattern.
  Write simple procedural code: shape = Box(...); return shape
  NEVER use: BuildPart, BuildLine, BuildSketch, Locations, or context managers (with statements).
- DO NOT call fillet() or chamfer() on any shape with holes, cutouts, or lattices.
- DO NOT fillet after body -= hole (boolean subtraction).
- DO NOT use fillet on a shape made from many boolean unions.
- DO NOT write loops with more than 8 iterations.
- DO NOT use for/while loops unless absolutely needed (prefer manual unrolling).
- DO NOT use try/except in generated code.
- DO NOT use Wedge(...) — its taper parameters (xmin/zmin/xmax/zmax) are 0..1 ratios, not lengths; models crash with Standard_Failure. Build slanted shapes with extrude() of a 2D polygon instead.

SAFE PATTERNS (always work):
- Simple box:  Box(w, d, h, align=(Align.CENTER, Align.CENTER, Align.CENTER))
- Cylinder:    Cylinder(radius=r, height=h, align=(Align.CENTER, Align.CENTER, Align.CENTER))
- Sphere:      Sphere(radius=r)
- Cone:        Cone(bottom_radius=r1, top_radius=r2, height=h, align=(Align.CENTER, Align.CENTER, Align.MIN)) — keyword names are bottom_radius/top_radius, never bottom_r/top_r
- Subtract:    body -= Pos(x, y, z) * Cylinder(radius=r, height=h)
- Add:         body += Pos(x, y, z) * Box(w, d, h)
- Fillet (ONLY on a SINGLE primitive, no holes): body = fillet(body.edges(), radius=1)
- Hole pattern (max 4 holes, unrolled): hole = Pos(x,y,0) * Cylinder(r, h); body -= hole

EXAMPLES:

from build123d import *

def gen_step():
    body = Box(50, 50, 50, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    return body

from build123d import *

def gen_step():
    body = Cylinder(radius=15, height=50, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    return body

from build123d import *

def gen_step():
    body = Box(80, 60, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
    hole1 = Pos(-30, -20, 0) * Cylinder(radius=4, height=10)
    hole2 = Pos(30, -20, 0) * Cylinder(radius=4, height=10)
    hole3 = Pos(-30, 20, 0) * Cylinder(radius=4, height=10)
    hole4 = Pos(30, 20, 0) * Cylinder(radius=4, height=10)
    body -= hole1 + hole2 + hole3 + hole4
    return body

Now generate for: `;

function extractPythonSource(text: string): string {
  const fenced = text.match(/```(?:python)?\s*\n([\s\S]*?)```/);
  const source = (fenced ? fenced[1] : text).trim();
  if (!source.includes('def gen_step')) {
    throw new Error('LLM output did not contain a gen_step() function');
  }
  // Guard against truncated output: unbalanced brackets mean the model was
  // cut off mid-expression (finish_reason=length). Bail so the caller can
  // retry / fail over instead of shipping unparseable code to the kernel.
  const opens = (source.match(/[(\[{]/g) ?? []).length;
  const closes = (source.match(/[)\]}]/g) ?? []).length;
  if (opens !== closes) {
    throw new Error('LLM output is truncated (unbalanced brackets)');
  }
  return source;
}

/** Single OpenAI-compatible chat call to author build123d source. */
async function llmChatOnce(llm: BridgeLlmConfig, userMessage: string): Promise<string> {
  const res = await fetch(`${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: llm.model,
      max_tokens: 4096,
      // Low temperature → repeatable output. Same prompt should yield a
      // similar shape across clicks instead of a random variation each time.
      temperature: 0.2,
      messages: [
        { role: 'system', content: CAD_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('LLM rate limited (HTTP 429) — provider quota exceeded');
    }
    throw new Error(`LLM request failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw new Error('LLM returned empty content');
  if (choice?.finish_reason === 'length') {
    throw new Error('LLM output truncated (finish_reason=length)');
  }
  return extractPythonSource(content);
}

/**
 * Retry a single provider with transient-failure backoff (5xx / 429, honoring
 * Retry-After) up to its own attempt budget. Full timeouts are NOT retried —
 * the model is simply slow, and a second attempt would exceed the budget.
 */
async function llmChatWithBackoff(
  llm: BridgeLlmConfig,
  userMessage: string,
  onLog: (msg: string) => void,
): Promise<string> {
  const attempts = 3;
  let backoffMs = 1_000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await llmChatOnce(llm, userMessage);
    } catch (err) {
      lastError = err;
      const message = String(err);
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      const rateLimited = message.includes('429');
      const transient = rateLimited || /HTTP 5\d\d/.test(message);
      if (timedOut || attempt === attempts || !transient) throw err;
      const wait = Math.min(backoffMs, 5_000);
      onLog(`[cadBridge] LLM attempt ${attempt}/${attempts} (${message}); retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      backoffMs *= 2;
    }
  }
  throw lastError;
}

/** Author build123d source, failing over across ordered providers with a
 * circuit breaker so one quota-limited provider can't kill the pipeline. */
async function generateSourceViaLlm(
  candidates: BridgeLlmCandidates,
  userMessage: string,
): Promise<string> {
  let content = '';
  const candidate: LlmCandidate[] = candidates.map((llm) => ({
    id: `${llm.baseUrl}|${llm.model}`,
    label: `${new URL(llm.baseUrl).hostname}/${llm.model}`,
    send: async () => {
      content = await llmChatWithBackoff(llm, userMessage, () => {});
      return { ok: true };
    },
  }));
  const result = await runFailoverSequence(candidate, {
    failureThreshold: 2,
    cooldownMs: 30_000,
    budgetMs: 150_000,
    onLog: (msg) => console.log(`[cadBridge] failover: ${msg}`),
  });
  if (!result.ok) {
    throw new Error(result.error ?? 'LLM source generation failed');
  }
  return content;
}

/** Send the failed source + traceback to the LLM and ask it to fix the code. */
async function generateFixViaLlm(
  candidates: BridgeLlmCandidates,
  originalSource: string,
  errorOutput: string,
  userPrompt: string,
): Promise<string> {
  const fixMessage = [
    `The following build123d code failed to execute. Fix the code so it runs correctly.`,
    '',
    `Original user request: ${userPrompt}`,
    '',
    'Failed source:',
    '```python',
    originalSource,
    '```',
    '',
    'Error output:',
    '```',
    errorOutput.slice(-2000),
    '```',
    '',
    'Rules:',
    '- Output ONLY the fixed Python code. No explanations.',
    '- Keep the same gen_step() function structure.',
    '- Fix the error while preserving the original design intent.',
    '- Do NOT use BuildPart, BuildLine, BuildSketch, or context managers.',
    '- Do NOT use fillet/chamfer on shapes with holes.',
  ].join('\n');

  let content = '';
  const candidate: LlmCandidate[] = candidates.map((llm) => ({
    id: `${llm.baseUrl}|${llm.model}`,
    label: `${new URL(llm.baseUrl).hostname}/${llm.model}`,
    send: async () => {
      content = await llmChatWithBackoff(llm, fixMessage, () => {});
      return { ok: true };
    },
  }));
  const result = await runFailoverSequence(candidate, {
    failureThreshold: 2,
    cooldownMs: 30_000,
    budgetMs: 120_000,
    onLog: (msg) => console.log(`[cadBridge] fix-failover: ${msg}`),
  });
  if (!result.ok) {
    throw new Error(result.error ?? 'LLM fix generation failed');
  }
  return content;
}

function composeUserMessage(body: BridgeGenerateBody, priorSource: string | null): string {
  const lines: string[] = [];
  if (body.baseModel && priorSource) {
    lines.push(
      `Modify the following existing build123d generator according to this instruction: "${body.baseModel.editInstruction}"`,
      '',
      'Existing generator source:',
      priorSource,
      '',
      `Original description: ${body.prompt ?? ''}`,
    );
  } else {
    lines.push(`Part description: ${body.prompt ?? ''}`);
  }
  const c = body.constraints;
  if (c?.maxDimensionMm) lines.push(`Constraint: no dimension may exceed ${c.maxDimensionMm} mm.`);
  if (c?.targetPrinter) lines.push(`Constraint: must fit the ${c.targetPrinter} print bed.`);
  if (c?.materialName) lines.push(`Constraint: will be printed in ${c.materialName} (FDM).`);
  if (body.baseModel && !priorSource) {
    lines.push(`Edit instruction (no prior source available, design fresh): ${body.baseModel.editInstruction}`);
  }

  // Append DfAM analysis context when provided
  if (body.analysisContext && body.analysisContext.issues.length > 0) {
    const ac = body.analysisContext;
    lines.push('');
    lines.push('DfAM ANALYSIS CONTEXT (address these issues):');
    if (ac.printabilityScore != null) {
      lines.push(`Current printability score: ${ac.printabilityScore}/100`);
    }
    for (const issue of ac.issues.slice(0, 5)) {
      const parts = [`- [${issue.priority ?? 'medium'}] ${issue.type}: ${issue.description}`];
      if (issue.recommendation) parts.push(`  Fix: ${issue.recommendation}`);
      else if (issue.implementation) parts.push(`  Fix: ${issue.implementation}`);
      lines.push(parts.join('\n'));
    }
    lines.push('');
    lines.push('IMPORTANT: Preserve the original design intent. Only modify geometry to address the issues above.');
  }

  return lines.join('\n');
}

interface StepRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runStepCli(
  python: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<StepRunResult> {
  return new Promise((resolvePromise) => {
    // Sandboxed execution: isolated interpreter (-I), sanitized env (no host
    // secrets), and best-effort resource limits applied before exec.
    const ulimitCmd =
      `ulimit -v ${SANDBOX_MEM_KB} 2>/dev/null; ` +
      `ulimit -t ${SANDBOX_CPU_S} 2>/dev/null; ` +
      `ulimit -f ${SANDBOX_FILE_KB} 2>/dev/null; ` +
      `exec "$0" "$@"`;
    const child = spawn('/bin/sh', ['-c', ulimitCmd, python, '-I', ...args], {
      cwd,
      env: SANDBOX_ENV,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ code: null, stdout, stderr: String(err), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut });
    });
  });
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function sendError(
  res: Response,
  status: number,
  code: string,
  detail: string,
  stderr?: string,
): void {
  res.status(status).json({ ok: false, error: { code, detail, ...(stderr ? { stderr } : {}) } });
}

async function fileSizeIfExists(p: string): Promise<number | undefined> {
  try {
    return (await stat(p)).size;
  } catch {
    return undefined;
  }
}

export function createCadBridgeRouter(): Router {
  const router = Router();
  router.use(express.json({ limit: '2mb' }));

  router.get('/health', (_req: Request, res: Response) => {
    const status = bridgeReady();
    res.json({ ok: true, ...status, skillDir: SKILL_DIR });
  });

  // Download the exact STEP file produced for a run (the primary CAD artifact
  // for CNC / machining). Only the run's own file is exposed; ids are validated
  // to avoid path traversal.
  router.get('/:id/step', async (req: Request, res: Response) => {
    const id = req.params.id ?? '';
    if (!/^[0-9a-f-]{20,}$/i.test(id)) {
      res.status(400).json({ ok: false, error: { code: 'invalid-artifact', detail: 'invalid run id' } });
      return;
    }
    try {
      const buf = await readFile(path.join(RUNS_ROOT, id, 'model.step'));
      res.setHeader('Content-Type', 'application/step');
      res.setHeader('Content-Disposition', 'attachment; filename="model.step"');
      res.send(buf);
    } catch {
      res.status(404).json({ ok: false, error: { code: 'invalid-artifact', detail: 'STEP file not found' } });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const body = (req.body ?? {}) as BridgeGenerateBody;
    const id = randomUUID();

    console.log(`[cadBridge:${id.slice(0, 8)}] POST / — prompt="${(body.prompt ?? '').slice(0, 80)}"`);

    if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
      console.log(`[cadBridge:${id.slice(0, 8)}] REJECT — empty prompt`);
      sendError(res, 400, 'generation-failed', 'prompt must be a non-empty string');
      return;
    }
    if (
      !body.generatorSource &&
      !body.llm &&
      !(body.llmCandidates && body.llmCandidates.length > 0)
    ) {
      console.log(`[cadBridge:${id.slice(0, 8)}] REJECT — no LLM config or generatorSource`);
      sendError(
        res,
        400,
        'generation-failed',
        'bridge requires either an llm config or explicit generatorSource',
      );
      return;
    }

    const ready = bridgeReady();
    if (!ready.ready) {
      console.log(`[cadBridge:${id.slice(0, 8)}] REJECT — bridge not ready: ${ready.reason}`);
      sendError(res, 503, 'transport-unavailable', ready.reason ?? 'CAD bridge not ready');
      return;
    }

    const runDir = path.join(RUNS_ROOT, id);
    const warnings: string[] = [];

    let priorSource: string | null = null;
    if (body.baseModel) {
      // Same allowlist as the /step download route — a malformed
      // generatedModelId must never reach path.join(RUNS_ROOT, ...).
      const parentId = body.baseModel.generatedModelId ?? '';
      if (!/^[0-9a-f-]{20,}$/i.test(parentId)) {
        sendError(res, 400, 'invalid-artifact', 'baseModel.generatedModelId has an invalid format');
        return;
      }
      try {
        priorSource = await readFile(
          path.join(RUNS_ROOT, parentId, 'model.py'),
          'utf-8',
        );
      } catch {
        warnings.push(
          `parent model ${parentId} source not found; generating fresh`,
        );
      }
    }

    let source: string;
    let candidates: BridgeLlmCandidates = [];
    if (body.generatorSource) {
      source = body.generatorSource;
      console.log(`[cadBridge:${id.slice(0, 8)}] Using generatorSource (${source.length} chars)`);
    } else {
      candidates =
        body.llmCandidates && body.llmCandidates.length > 0
          ? body.llmCandidates
          : body.llm
            ? [body.llm]
            : [];
      if (candidates.length === 0) {
        sendError(res, 502, 'generation-failed', 'LLM source generation failed: no LLM provider configured');
        return;
      }
      const llmStart = Date.now();
      try {
        console.log(
          `[cadBridge:${id.slice(0, 8)}] Calling LLM: ${candidates
            .map((c) => `${new URL(c.baseUrl).hostname}/${c.model}`)
            .join(' → ')}`,
        );
        source = await generateSourceViaLlm(candidates, composeUserMessage(body, priorSource));
        console.log(`[cadBridge:${id.slice(0, 8)}] LLM responded in ${Date.now() - llmStart}ms (${source.length} chars)`);
      } catch (err) {
        console.log(`[cadBridge:${id.slice(0, 8)}] LLM failed after ${Date.now() - llmStart}ms: ${String(err)}`);
        sendError(res, 502, 'generation-failed', `LLM source generation failed: ${String(err)}`);
        return;
      }
      warnings.push('LLM-authored build123d source executed in a sandboxed interpreter');
    }

    const safety = scanSourceSafety(source);
    if (!safety.safe) {
      console.warn(`[cadBridge:${id.slice(0, 8)}] REJECT — unsafe source: ${safety.reason}`);
      sendError(
        res,
        502,
        'generation-failed',
        `Generated code contained a forbidden operation (${safety.reason}). Try a different description.`,
      );
      return;
    }

    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, 'model.py'), source, 'utf-8');

    const args = [STEP_CLI_DIR, 'model.py', '--stl', 'model.stl'];
    if (body.meshTolerance?.linear) args.push('--mesh-tolerance', String(body.meshTolerance.linear));
    if (body.meshTolerance?.angular) {
      args.push('--mesh-angular-tolerance', String(body.meshTolerance.angular));
    }

    const timeoutMs = Math.min(body.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    console.log(`[cadBridge:${id.slice(0, 8)}] Running: python ${args.join(' ')}`);
    const stepStart = Date.now();

    // ── Retry loop with auto-repair ──
    let run = await runStepCli(ready.python, args, runDir, timeoutMs);
    let repairAttempts = 0;
    let repairType: RepairType | null = null;
    let llmFixAttempts = 0;
    const providerLabel =
      (body.llmCandidates?.[0]?.model ?? body.llm?.model) || 'template';

    while (run.code !== 0 && !run.timedOut && repairAttempts < MAX_REPAIR_ATTEMPTS) {
      const combined = run.stdout + run.stderr;
      console.log(`[cadBridge:${id.slice(0, 8)}] Attempt ${repairAttempts + 1} failed — inspecting traceback`);
      const repairResult = repairCadSource(source, combined);
      if (!repairResult) {
        console.log(`[cadBridge:${id.slice(0, 8)}] No repairable pattern — trying LLM fix`);
        break;
      }

      source = repairResult.source;
      repairType = repairResult.type;
      repairAttempts++;

      await writeFile(path.join(runDir, 'model.py'), source, 'utf-8');
      console.log(`[cadBridge:${id.slice(0, 8)}] Repair ${repairAttempts}/${MAX_REPAIR_ATTEMPTS} — type: ${repairType}`);

      run = await runStepCli(ready.python, args, runDir, timeoutMs);
      console.log(`[cadBridge:${id.slice(0, 8)}] After repair — exit code ${run.code}`);
    }

    // ── LLM-based fix loop (after pattern repairs exhausted) ──
    if (run.code !== 0 && !run.timedOut && candidates.length > 0) {
      while (run.code !== 0 && !run.timedOut && llmFixAttempts < MAX_LLM_FIX_ATTEMPTS) {
        const combined = run.stdout + run.stderr;
        llmFixAttempts++;
        console.log(`[cadBridge:${id.slice(0, 8)}] LLM fix attempt ${llmFixAttempts}/${MAX_LLM_FIX_ATTEMPTS}`);
        try {
          source = await generateFixViaLlm(candidates, source, combined, body.prompt ?? '');
          const safety = scanSourceSafety(source);
          if (!safety.safe) {
            console.log(`[cadBridge:${id.slice(0, 8)}] LLM fix produced unsafe code: ${safety.reason}`);
            break;
          }
          await writeFile(path.join(runDir, 'model.py'), source, 'utf-8');
          run = await runStepCli(ready.python, args, runDir, timeoutMs);
          console.log(`[cadBridge:${id.slice(0, 8)}] After LLM fix — exit code ${run.code}`);
        } catch (err) {
          console.log(`[cadBridge:${id.slice(0, 8)}] LLM fix failed: ${String(err)}`);
          break;
        }
      }
    }

    // ── Metrics ──
    const metricsLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      prompt: (body.prompt ?? '').slice(0, 200),
      provider: providerLabel,
      repaired: repairAttempts > 0,
      repairType: repairType ?? 'none',
      success: run.code === 0 && !run.timedOut,
    }) + '\n';
    appendFile(METRICS_PATH, metricsLine, 'utf-8').catch((err) =>
      console.error(`[cadBridge] metrics write failed: ${(err as Error).message}`),
    );

    if (run.timedOut) {
      console.log(`[cadBridge:${id.slice(0, 8)}] TIMEOUT after ${timeoutMs}ms`);
      sendError(res, 504, 'generation-timeout', `scripts/step exceeded ${timeoutMs}ms`, run.stderr.slice(-STDERR_TAIL));
      return;
    }
    if (run.code !== 0) {
      console.log(`[cadBridge:${id.slice(0, 8)}] FAILED with code ${run.code} (${repairAttempts} repairs attempted)`);
      const combined = (run.stdout + run.stderr).slice(-STDERR_TAIL);
      sendError(
        res,
        502,
        'generation-failed',
        `scripts/step exited with code ${run.code ?? 'unknown'}`,
        combined,
      );
      return;
    }

    const stlPath = path.join(runDir, 'model.stl');
    const stepPath = path.join(runDir, 'model.step');
    let stl: Buffer;
    try {
      stl = await readFile(stlPath);
    } catch {
      console.log(`[cadBridge:${id.slice(0, 8)}] ERROR — no STL file produced`);
      const combined = (run.stdout + run.stderr).slice(-STDERR_TAIL);
      sendError(res, 502, 'invalid-artifact', 'scripts/step completed but produced no STL', combined);
      return;
    }
    console.log(`[cadBridge:${id.slice(0, 8)}] STL file: ${stl.byteLength} bytes`);
    if (stl.byteLength <= 84) {
      console.log(`[cadBridge:${id.slice(0, 8)}] ERROR — STL too small: ${stl.byteLength} bytes`);
      sendError(res, 502, 'invalid-artifact', `STL artifact too small (${stl.byteLength} bytes)`);
      return;
    }

    const artifacts: GeneratedArtifact[] = [];
    const stepSize = await fileSizeIfExists(stepPath);
    if (stepSize !== undefined) {
      artifacts.push({
        kind: 'step',
        role: 'primary',
        format: 'step-ap214',
        units: 'mm',
        location: { type: 'local-path', path: stepPath },
        sizeBytes: stepSize,
      });
    }
    artifacts.push({
      kind: 'stl',
      role: 'sidecar',
      format: 'binary-stl',
      units: 'mm',
      location: { type: 'inline-bytes' },
      sizeBytes: stl.byteLength,
      sha256: sha256(stl),
    });

    const model: GeneratedModel = {
      id,
      origin: 'cad-generation',
      prompt: body.prompt,
      summary: body.prompt.split('\n')[0].slice(0, 120),
      params: {
        prompt: body.prompt,
        assumptions: [],
        meshTolerance: {
          linear: body.meshTolerance?.linear ?? 0.02,
          angular: body.meshTolerance?.angular ?? 0.05,
        },
      },
      artifacts,
      validation: {
        ran: false,
        checks: ['scripts/step completed; scripts/inspect not run by bridge (v1)'],
      },
      provenance: {
        skill: 'cad (earthtojake/text-to-cad)',
        generator: 'build123d',
        executedBy: 'local-bridge',
      },
      ...(body.baseModel ? { parentModelId: body.baseModel.generatedModelId } : {}),
      createdAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      warnings,
      source,
    };

    const totalServerMs = Date.now() - startedAt;
    console.log(`[cadBridge:${id.slice(0, 8)}] Response sent — total ${totalServerMs}ms`);
    res.json({
      ok: true,
      model,
      stlBase64: stl.toString('base64'),
      repaired: repairAttempts > 0,
      repairType: repairType ?? 'none',
      attempts: repairAttempts + 1,
    });
  });

  return router;
}