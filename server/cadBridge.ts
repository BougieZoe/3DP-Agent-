import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express, { Router, type Request, type Response } from 'express';
import type { GeneratedArtifact, GeneratedModel } from '../shared/domain/generatedModel';

const SKILL_DIR =
  process.env.CAD_SKILL_DIR ?? path.join(os.homedir(), '.agents', 'skills', 'cad');
const STEP_CLI_DIR = path.join(SKILL_DIR, 'scripts', 'step');
const PROJECT_ROOT = process.cwd();
const DEFAULT_VENV_PYTHON = path.join(PROJECT_ROOT, '.cad-bridge', '.venv', 'bin', 'python');
const RUNS_ROOT = path.join(PROJECT_ROOT, '.cad-bridge', 'runs');
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 600_000;
const LLM_TIMEOUT_MS = 120_000;
const STDERR_TAIL = 4000;

interface BridgeLlmConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

interface BridgeGenerateBody {
  prompt?: string;
  locale?: string;
  constraints?: {
    targetPrinter?: string;
    materialName?: string;
    maxDimensionMm?: number;
  };
  baseModel?: { generatedModelId: string; editInstruction: string };
  llm?: BridgeLlmConfig;
  generatorSource?: string;
  meshTolerance?: { linear?: number; angular?: number };
  timeoutMs?: number;
}

function resolvePython(): string {
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

const CAD_SYSTEM_PROMPT = `You are an expert build123d CAD engineer.

You MUST generate ONLY valid Python code that can run directly.

STRICT RULES:
- First line MUST be: from build123d import *
- Define exactly: def gen_step():
- Do NOT use any return type annotation (no -> Shape, no -> Solid, etc.)
- Return exactly one closed solid geometry object.
- Output ONLY raw Python code. No markdown, no explanations, no backticks.
- Never call export_*, show_*, print, or any visualization function.
- Use only build123d APIs. Never use CadQuery or other libraries.
- Prefer Box() over Cube().
- Center objects using align=(Align.CENTER, Align.CENTER, Align.CENTER) when possible.
- Keep it simple and deterministic.

Examples:

from build123d import *

def gen_step():
    body = Box(50, 50, 50, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    return body

from build123d import *

def gen_step():
    body = Cylinder(radius=15, height=50, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    return body

Now generate for the user request. Output ONLY the Python code.`;

function extractPythonSource(text: string): string {
  const fenced = text.match(/```(?:python)?\s*\n([\s\S]*?)```/);
  const source = (fenced ? fenced[1] : text).trim();
  if (!source.includes('def gen_step')) {
    throw new Error('LLM output did not contain a gen_step() function');
  }
  return source;
}

async function generateSourceViaLlm(llm: BridgeLlmConfig, userMessage: string): Promise<string> {
  const res = await fetch(`${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: llm.model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: CAD_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`LLM request failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM returned empty content');
  return extractPythonSource(content);
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
    const child = spawn(python, args, { cwd, env: process.env });
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

  router.post('/', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const body = (req.body ?? {}) as BridgeGenerateBody;

    if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
      sendError(res, 400, 'generation-failed', 'prompt must be a non-empty string');
      return;
    }
    if (!body.generatorSource && !body.llm) {
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
      sendError(res, 503, 'transport-unavailable', ready.reason ?? 'CAD bridge not ready');
      return;
    }

    const id = randomUUID();
    const runDir = path.join(RUNS_ROOT, id);
    const warnings: string[] = [];

    let priorSource: string | null = null;
    if (body.baseModel) {
      try {
        priorSource = await readFile(
          path.join(RUNS_ROOT, body.baseModel.generatedModelId, 'model.py'),
          'utf-8',
        );
      } catch {
        warnings.push(
          `parent model ${body.baseModel.generatedModelId} source not found; generating fresh`,
        );
      }
    }

    let source: string;
    if (body.generatorSource) {
      source = body.generatorSource;
    } else {
      try {
        source = await generateSourceViaLlm(body.llm!, composeUserMessage(body, priorSource));
      } catch (err) {
        sendError(res, 502, 'generation-failed', `LLM source generation failed: ${String(err)}`);
        return;
      }
      warnings.push('LLM-authored build123d source executed without sandbox — local dev bridge');
    }

    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, 'model.py'), source, 'utf-8');

    const args = [STEP_CLI_DIR, 'model.py', '--stl', 'model.stl'];
    if (body.meshTolerance?.linear) args.push('--mesh-tolerance', String(body.meshTolerance.linear));
    if (body.meshTolerance?.angular) {
      args.push('--mesh-angular-tolerance', String(body.meshTolerance.angular));
    }

    const timeoutMs = Math.min(body.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const run = await runStepCli(ready.python, args, runDir, timeoutMs);

    if (run.timedOut) {
      sendError(res, 504, 'generation-timeout', `scripts/step exceeded ${timeoutMs}ms`, run.stderr.slice(-STDERR_TAIL));
      return;
    }
    if (run.code !== 0) {
      sendError(
        res,
        502,
        'generation-failed',
        `scripts/step exited with code ${run.code ?? 'unknown'}`,
        run.stderr.slice(-STDERR_TAIL),
      );
      return;
    }

    const stlPath = path.join(runDir, 'model.stl');
    const stepPath = path.join(runDir, 'model.step');
    let stl: Buffer;
    try {
      stl = await readFile(stlPath);
    } catch {
      sendError(res, 502, 'invalid-artifact', 'scripts/step completed but produced no STL', run.stderr.slice(-STDERR_TAIL));
      return;
    }
    if (stl.byteLength <= 84) {
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
    };

    res.json({ ok: true, model, stlBase64: stl.toString('base64') });
  });

  return router;
}