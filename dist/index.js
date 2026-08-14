// server/index.ts
import express3 from "express";
import { createServer } from "http";
import path5 from "path";
import { fileURLToPath } from "url";

// server/cadBridge.ts
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express, { Router } from "express";

// server/cadRepair.ts
function wrapFilletsInTry(source) {
  const lines = source.split("\n");
  const out = [];
  for (const line of lines) {
    if (/^\s*[\w.]+\s*=\s*fillet\(/.test(line)) {
      const indent = (line.match(/^\s*/) ?? [""])[0];
      out.push(
        `${indent}try:`,
        `${indent}    ${line.trimStart()}`,
        `${indent}except Exception:`,
        `${indent}    pass`
      );
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}
function repairCadSource(source, traceback) {
  const combined = (traceback || "").toLowerCase();
  if (combined.includes("shell is not manifold") || combined.includes("not manifold")) {
    return null;
  }
  if (combined.includes("boolean operation failed")) {
    const repaired = source.split("\n").map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("body += ") || trimmed.startsWith("body -= ") || trimmed.startsWith("part += ") || trimmed.startsWith("part -= ") || /^\w+\s*\+=\s*/.test(trimmed) || /^\w+\s*-=\s*/.test(trimmed) || /^\w+\s*=\s*fillet\(/.test(trimmed) || /^\w+\s*=\s*chamfer\(/.test(trimmed)) {
        return `# [AUTO-REPAIR] ${line}`;
      }
      return line;
    }).join("\n");
    return { source: repaired, type: "boolean" };
  }
  if (combined.includes("max_fillet")) {
    return { source: wrapFilletsInTry(source), type: "fillet" };
  }
  if (combined.includes("unsupported operand") && combined.includes("*")) {
    const repaired = source.replace(
      /\b(\w+)\s*\*\s*(Pos\s*\([^)]+\))/g,
      "$2 * $1"
    );
    return { source: repaired, type: "boolean" };
  }
  if (combined.includes("failed creating a fillet")) {
    return { source: wrapFilletsInTry(source), type: "fillet" };
  }
  if (combined.includes("buildpart") || combined.includes("builder of shapes")) {
    const returnMatch = source.match(/return\s+(Box|Cylinder|Sphere)\([^)]+\)/g);
    if (returnMatch) {
      const lastReturn = returnMatch[returnMatch.length - 1];
      const repaired2 = `from build123d import *

def gen_step():
    ${lastReturn}
`;
      return { source: repaired2, type: "builder" };
    }
    const repaired = `from build123d import *

def gen_step():
    body = Box(50, 50, 50, align=(Align.CENTER, Align.CENTER, Align.CENTER))
    return body
`;
    return { source: repaired, type: "builder" };
  }
  return null;
}

// server/cadSandbox.ts
var FORBIDDEN_IMPORTS = [
  "os",
  "sys",
  "subprocess",
  "socket",
  "ctypes",
  "importlib",
  "builtins",
  "requests",
  "urllib",
  "http",
  "ftplib",
  "shutil",
  "pathlib",
  "tempfile",
  "multiprocessing",
  "pty",
  "pickle",
  "marshal",
  "crypt",
  "resource",
  "signal",
  "sysconfig",
  "pkgutil",
  "runpy",
  "dl",
  "gc",
  "codecs"
];
var FORBIDDEN_PATTERNS = [
  /eval\s*\(/,
  /exec\s*\(/,
  /__import__\s*\(/,
  /open\s*\(\s*['"]/,
  // opening a file by string literal
  /compile\s*\(/,
  /input\s*\(/,
  /getattr\s*\(\s*['"]__/,
  /globals\s*\(\s*\)/,
  /locals\s*\(\s*\)/
];
function scanSourceSafety(source) {
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    const importMatch = trimmed.match(/^(?:import|from)\s+([\w.]+)/);
    if (importMatch) {
      const mod = importMatch[1].split(".")[0];
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
var SANDBOX_ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: process.env.HOME ?? "/tmp",
  LANG: process.env.LANG ?? "C.UTF-8",
  TMPDIR: process.env.TMPDIR ?? "/tmp",
  PYTHONUNBUFFERED: "1",
  PYTHONDONTWRITEBYTECODE: "1"
};
var SANDBOX_MEM_KB = 2e6;
var SANDBOX_CPU_S = 120;
var SANDBOX_FILE_KB = 102400;

// server/cadBridge.ts
var SKILL_DIR = process.env.CAD_SKILL_DIR ?? path.join(os.homedir(), ".agents", "skills", "cad");
var STEP_CLI_DIR = path.join(SKILL_DIR, "scripts", "step");
var PROJECT_ROOT = process.cwd();
var DEFAULT_VENV_PYTHON = path.join(PROJECT_ROOT, ".cad-bridge", ".venv", "bin", "python");
var RUNS_ROOT = path.join(PROJECT_ROOT, ".cad-bridge", "runs");
var DEFAULT_TIMEOUT_MS = 18e4;
var MAX_TIMEOUT_MS = 6e5;
var LLM_TIMEOUT_MS = 15e4;
var STDERR_TAIL = 4e3;
var MAX_REPAIR_ATTEMPTS = 2;
var METRICS_PATH = path.join(PROJECT_ROOT, ".cad-bridge", "metrics.jsonl");
function resolvePython() {
  if (process.env.CAD_BRIDGE_PYTHON) return process.env.CAD_BRIDGE_PYTHON;
  if (existsSync(DEFAULT_VENV_PYTHON)) return DEFAULT_VENV_PYTHON;
  return "python3";
}
function bridgeReady() {
  const python = resolvePython();
  if (!existsSync(STEP_CLI_DIR)) {
    return { ready: false, python, reason: `CAD skill not found at ${SKILL_DIR}` };
  }
  if (path.isAbsolute(python) && !existsSync(python)) {
    return { ready: false, python, reason: `Python interpreter not found at ${python}` };
  }
  return { ready: true, python };
}
var CAD_SYSTEM_PROMPT = `You are a build123d CAD code generator. Output ONLY valid Python.

RULES:
1. First line: from build123d import *
2. Define: def gen_step():
3. Return ONE closed solid. No type hints on def.
4. Output raw code ONLY. No markdown, no backticks, no explanations.
5. NEVER: export_*, show_*, print, CadQuery, OCP, or external libs.
6. Put Pos() LEFT of the shape: Pos(x,y,z) * Box(...) \u2014 NOT Box(...) * Pos(...)
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

SAFE PATTERNS (always work):
- Simple box:  Box(w, d, h, align=(Align.CENTER, Align.CENTER, Align.CENTER))
- Cylinder:    Cylinder(radius=r, height=h, align=(Align.CENTER, Align.CENTER, Align.CENTER))
- Sphere:      Sphere(radius=r)
- Cone:        Cone(bottom_r, top_r, h, align=(Align.CENTER, Align.CENTER, Align.MIN))
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
function extractPythonSource(text) {
  const fenced = text.match(/```(?:python)?\s*\n([\s\S]*?)```/);
  const source = (fenced ? fenced[1] : text).trim();
  if (!source.includes("def gen_step")) {
    throw new Error("LLM output did not contain a gen_step() function");
  }
  return source;
}
async function llmChatOnce(llm, userMessage) {
  const res = await fetch(`${llm.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}
    },
    body: JSON.stringify({
      model: llm.model,
      max_tokens: 4096,
      // Low temperature → repeatable output. Same prompt should yield a
      // similar shape across clicks instead of a random variation each time.
      temperature: 0.2,
      messages: [
        { role: "system", content: CAD_SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ]
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS)
  });
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("LLM rate limited (HTTP 429) \u2014 provider quota exceeded");
    }
    throw new Error(`LLM request failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");
  return extractPythonSource(content);
}
async function generateSourceViaLlm(llm, userMessage) {
  const attempts = 2;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await llmChatOnce(llm, userMessage);
    } catch (err) {
      lastError = err;
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      if (timedOut || attempt === attempts) throw err;
      console.warn(`[cadBridge] LLM attempt ${attempt}/${attempts} failed (${String(err)}); retrying`);
    }
  }
  throw lastError;
}
function composeUserMessage(body, priorSource) {
  const lines = [];
  if (body.baseModel && priorSource) {
    lines.push(
      `Modify the following existing build123d generator according to this instruction: "${body.baseModel.editInstruction}"`,
      "",
      "Existing generator source:",
      priorSource,
      "",
      `Original description: ${body.prompt ?? ""}`
    );
  } else {
    lines.push(`Part description: ${body.prompt ?? ""}`);
  }
  const c = body.constraints;
  if (c?.maxDimensionMm) lines.push(`Constraint: no dimension may exceed ${c.maxDimensionMm} mm.`);
  if (c?.targetPrinter) lines.push(`Constraint: must fit the ${c.targetPrinter} print bed.`);
  if (c?.materialName) lines.push(`Constraint: will be printed in ${c.materialName} (FDM).`);
  if (body.baseModel && !priorSource) {
    lines.push(`Edit instruction (no prior source available, design fresh): ${body.baseModel.editInstruction}`);
  }
  return lines.join("\n");
}
function runStepCli(python, args, cwd, timeoutMs) {
  return new Promise((resolvePromise) => {
    const ulimitCmd = `ulimit -v ${SANDBOX_MEM_KB} 2>/dev/null; ulimit -t ${SANDBOX_CPU_S} 2>/dev/null; ulimit -f ${SANDBOX_FILE_KB} 2>/dev/null; exec "$0" "$@"`;
    const child = spawn("/bin/sh", ["-c", ulimitCmd, python, "-I", ...args], {
      cwd,
      env: SANDBOX_ENV
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ code: null, stdout, stderr: String(err), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut });
    });
  });
}
function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function sendError(res, status, code, detail, stderr) {
  res.status(status).json({ ok: false, error: { code, detail, ...stderr ? { stderr } : {} } });
}
async function fileSizeIfExists(p) {
  try {
    return (await stat(p)).size;
  } catch {
    return void 0;
  }
}
function createCadBridgeRouter() {
  const router = Router();
  router.use(express.json({ limit: "2mb" }));
  router.get("/health", (_req, res) => {
    const status = bridgeReady();
    res.json({ ok: true, ...status, skillDir: SKILL_DIR });
  });
  router.get("/:id/step", async (req, res) => {
    const id = req.params.id ?? "";
    if (!/^[0-9a-f-]{20,}$/i.test(id)) {
      res.status(400).json({ ok: false, error: { code: "invalid-artifact", detail: "invalid run id" } });
      return;
    }
    try {
      const buf = await readFile(path.join(RUNS_ROOT, id, "model.step"));
      res.setHeader("Content-Type", "application/step");
      res.setHeader("Content-Disposition", 'attachment; filename="model.step"');
      res.send(buf);
    } catch {
      res.status(404).json({ ok: false, error: { code: "invalid-artifact", detail: "STEP file not found" } });
    }
  });
  router.post("/", async (req, res) => {
    const startedAt = Date.now();
    const body = req.body ?? {};
    const id = randomUUID();
    console.log(`[cadBridge:${id.slice(0, 8)}] POST / \u2014 prompt="${(body.prompt ?? "").slice(0, 80)}"`);
    if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      console.log(`[cadBridge:${id.slice(0, 8)}] REJECT \u2014 empty prompt`);
      sendError(res, 400, "generation-failed", "prompt must be a non-empty string");
      return;
    }
    if (!body.generatorSource && !body.llm) {
      console.log(`[cadBridge:${id.slice(0, 8)}] REJECT \u2014 no LLM config or generatorSource`);
      sendError(
        res,
        400,
        "generation-failed",
        "bridge requires either an llm config or explicit generatorSource"
      );
      return;
    }
    const ready = bridgeReady();
    if (!ready.ready) {
      console.log(`[cadBridge:${id.slice(0, 8)}] REJECT \u2014 bridge not ready: ${ready.reason}`);
      sendError(res, 503, "transport-unavailable", ready.reason ?? "CAD bridge not ready");
      return;
    }
    const runDir = path.join(RUNS_ROOT, id);
    const warnings = [];
    let priorSource = null;
    if (body.baseModel) {
      try {
        priorSource = await readFile(
          path.join(RUNS_ROOT, body.baseModel.generatedModelId, "model.py"),
          "utf-8"
        );
      } catch {
        warnings.push(
          `parent model ${body.baseModel.generatedModelId} source not found; generating fresh`
        );
      }
    }
    let source;
    if (body.generatorSource) {
      source = body.generatorSource;
      console.log(`[cadBridge:${id.slice(0, 8)}] Using generatorSource (${source.length} chars)`);
    } else {
      const llmStart = Date.now();
      try {
        console.log(`[cadBridge:${id.slice(0, 8)}] Calling LLM: ${body.llm.model} at ${body.llm.baseUrl}`);
        source = await generateSourceViaLlm(body.llm, composeUserMessage(body, priorSource));
        console.log(`[cadBridge:${id.slice(0, 8)}] LLM responded in ${Date.now() - llmStart}ms (${source.length} chars)`);
      } catch (err) {
        console.log(`[cadBridge:${id.slice(0, 8)}] LLM failed after ${Date.now() - llmStart}ms: ${String(err)}`);
        sendError(res, 502, "generation-failed", `LLM source generation failed: ${String(err)}`);
        return;
      }
      warnings.push("LLM-authored build123d source executed in a sandboxed interpreter");
    }
    const safety = scanSourceSafety(source);
    if (!safety.safe) {
      console.warn(`[cadBridge:${id.slice(0, 8)}] REJECT \u2014 unsafe source: ${safety.reason}`);
      sendError(
        res,
        502,
        "generation-failed",
        `Generated code contained a forbidden operation (${safety.reason}). Try a different description.`
      );
      return;
    }
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "model.py"), source, "utf-8");
    const args = [STEP_CLI_DIR, "model.py", "--stl", "model.stl"];
    if (body.meshTolerance?.linear) args.push("--mesh-tolerance", String(body.meshTolerance.linear));
    if (body.meshTolerance?.angular) {
      args.push("--mesh-angular-tolerance", String(body.meshTolerance.angular));
    }
    const timeoutMs = Math.min(body.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    console.log(`[cadBridge:${id.slice(0, 8)}] Running: python ${args.join(" ")}`);
    const stepStart = Date.now();
    let run = await runStepCli(ready.python, args, runDir, timeoutMs);
    let repairAttempts = 0;
    let repairType = null;
    const providerLabel = body.llm?.model ?? "template";
    while (run.code !== 0 && !run.timedOut && repairAttempts < MAX_REPAIR_ATTEMPTS) {
      const combined = run.stdout + run.stderr;
      console.log(`[cadBridge:${id.slice(0, 8)}] Attempt ${repairAttempts + 1} failed \u2014 inspecting traceback`);
      const repairResult = repairCadSource(source, combined);
      if (!repairResult) {
        console.log(`[cadBridge:${id.slice(0, 8)}] No repairable pattern \u2014 giving up`);
        break;
      }
      source = repairResult.source;
      repairType = repairResult.type;
      repairAttempts++;
      await writeFile(path.join(runDir, "model.py"), source, "utf-8");
      console.log(`[cadBridge:${id.slice(0, 8)}] Repair ${repairAttempts}/${MAX_REPAIR_ATTEMPTS} \u2014 type: ${repairType}`);
      run = await runStepCli(ready.python, args, runDir, timeoutMs);
      console.log(`[cadBridge:${id.slice(0, 8)}] After repair \u2014 exit code ${run.code}`);
    }
    const metricsLine = JSON.stringify({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      prompt: (body.prompt ?? "").slice(0, 200),
      provider: providerLabel,
      repaired: repairAttempts > 0,
      repairType: repairType ?? "none",
      success: run.code === 0 && !run.timedOut
    }) + "\n";
    appendFile(METRICS_PATH, metricsLine, "utf-8").catch(
      (err) => console.error(`[cadBridge] metrics write failed: ${err.message}`)
    );
    if (run.timedOut) {
      console.log(`[cadBridge:${id.slice(0, 8)}] TIMEOUT after ${timeoutMs}ms`);
      sendError(res, 504, "generation-timeout", `scripts/step exceeded ${timeoutMs}ms`, run.stderr.slice(-STDERR_TAIL));
      return;
    }
    if (run.code !== 0) {
      console.log(`[cadBridge:${id.slice(0, 8)}] FAILED with code ${run.code} (${repairAttempts} repairs attempted)`);
      const combined = (run.stdout + run.stderr).slice(-STDERR_TAIL);
      sendError(
        res,
        502,
        "generation-failed",
        `scripts/step exited with code ${run.code ?? "unknown"}`,
        combined
      );
      return;
    }
    const stlPath = path.join(runDir, "model.stl");
    const stepPath = path.join(runDir, "model.step");
    let stl;
    try {
      stl = await readFile(stlPath);
    } catch {
      console.log(`[cadBridge:${id.slice(0, 8)}] ERROR \u2014 no STL file produced`);
      const combined = (run.stdout + run.stderr).slice(-STDERR_TAIL);
      sendError(res, 502, "invalid-artifact", "scripts/step completed but produced no STL", combined);
      return;
    }
    console.log(`[cadBridge:${id.slice(0, 8)}] STL file: ${stl.byteLength} bytes`);
    if (stl.byteLength <= 84) {
      console.log(`[cadBridge:${id.slice(0, 8)}] ERROR \u2014 STL too small: ${stl.byteLength} bytes`);
      sendError(res, 502, "invalid-artifact", `STL artifact too small (${stl.byteLength} bytes)`);
      return;
    }
    const artifacts = [];
    const stepSize = await fileSizeIfExists(stepPath);
    if (stepSize !== void 0) {
      artifacts.push({
        kind: "step",
        role: "primary",
        format: "step-ap214",
        units: "mm",
        location: { type: "local-path", path: stepPath },
        sizeBytes: stepSize
      });
    }
    artifacts.push({
      kind: "stl",
      role: "sidecar",
      format: "binary-stl",
      units: "mm",
      location: { type: "inline-bytes" },
      sizeBytes: stl.byteLength,
      sha256: sha256(stl)
    });
    const model = {
      id,
      origin: "cad-generation",
      prompt: body.prompt,
      summary: body.prompt.split("\n")[0].slice(0, 120),
      params: {
        prompt: body.prompt,
        assumptions: [],
        meshTolerance: {
          linear: body.meshTolerance?.linear ?? 0.02,
          angular: body.meshTolerance?.angular ?? 0.05
        }
      },
      artifacts,
      validation: {
        ran: false,
        checks: ["scripts/step completed; scripts/inspect not run by bridge (v1)"]
      },
      provenance: {
        skill: "cad (earthtojake/text-to-cad)",
        generator: "build123d",
        executedBy: "local-bridge"
      },
      ...body.baseModel ? { parentModelId: body.baseModel.generatedModelId } : {},
      createdAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      warnings,
      source
    };
    const totalServerMs = Date.now() - startedAt;
    console.log(`[cadBridge:${id.slice(0, 8)}] Response sent \u2014 total ${totalServerMs}ms`);
    res.json({
      ok: true,
      model,
      stlBase64: stl.toString("base64"),
      repaired: repairAttempts > 0,
      repairType: repairType ?? "none",
      attempts: repairAttempts + 1
    });
  });
  return router;
}

// server/meshProcess.ts
import { Router as Router2, json as expressJson } from "express";
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync2 } from "node:fs";
import { mkdtemp, readFile as readFile2, writeFile as writeFile2, rm } from "node:fs/promises";
import os2 from "node:os";
import path2 from "node:path";
var MESH_SCRIPT = path2.join(import.meta.dirname, "mesh_process.py");
var MESH_PROCESS_TIMEOUT_MS = 3e4;
function resolveMeshPython() {
  const candidates = [
    process.env.CAD_MESH_PYTHON,
    path2.join(process.cwd(), ".cad-bridge", "mesh-venv", "bin", "python")
  ];
  for (const p of candidates) {
    if (p && existsSync2(p)) return p;
  }
  return resolvePython();
}
function runMeshProcess(python, cwd, inPath, outPath, decimateTo) {
  return new Promise((resolvePromise) => {
    const child = spawn2(python, ["-I", MESH_SCRIPT, inPath, outPath, String(decimateTo)], {
      cwd,
      env: SANDBOX_ENV
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), MESH_PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code });
    });
  });
}
function createMeshProcessRouter() {
  const router = Router2();
  router.use(expressJson({ limit: "50mb" }));
  router.post("/", async (req, res) => {
    const body = req.body ?? {};
    const stlBase64 = body.stlBase64;
    const decimateTo = typeof body.decimateTo === "number" ? Math.max(0, Math.min(2e6, Math.floor(body.decimateTo))) : 0;
    if (typeof stlBase64 !== "string" || stlBase64.length === 0) {
      res.status(400).json({ ok: false, error: { code: "invalid-artifact", detail: "missing stlBase64" } });
      return;
    }
    const input = Buffer.from(stlBase64, "base64");
    if (input.byteLength <= 84) {
      res.status(400).json({ ok: false, error: { code: "invalid-artifact", detail: "STL too small" } });
      return;
    }
    const dir = await mkdtemp(path2.join(os2.tmpdir(), "mesh-process-"));
    const inPath = path2.join(dir, "in.stl");
    const outPath = path2.join(dir, "out.stl");
    await writeFile2(inPath, input);
    try {
      const { stdout, stderr, code } = await runMeshProcess(
        resolveMeshPython(),
        dir,
        inPath,
        outPath,
        decimateTo
      );
      if (code !== 0) {
        res.status(500).json({
          ok: false,
          error: { code: "generation-failed", detail: `mesh process exited ${code}: ${stderr.slice(-1e3)}` }
        });
        return;
      }
      let diagnostics = {};
      try {
        diagnostics = JSON.parse(stdout);
      } catch {
      }
      const out = await readFile2(outPath);
      res.json({ ok: true, processedStlBase64: out.toString("base64"), diagnostics });
    } finally {
      rm(dir, { recursive: true, force: true }).catch(() => void 0);
    }
  });
  return router;
}

// server/slicerRouter.ts
import express2, { Router as Router3 } from "express";
import path4 from "node:path";

// server/slicerBridge.ts
import { execFile } from "node:child_process";
import { mkdtemp as mkdtemp2, readFile as readFile3, rm as rm2, writeFile as writeFile3 } from "node:fs/promises";
import { tmpdir } from "node:os";
import path3 from "node:path";
var DEFAULT_TIMEOUT_MS2 = 18e4;
var MAX_TIMEOUT_MS2 = 3e5;
function assertAbsoluteBinary(binary) {
  if (!path3.isAbsolute(binary)) {
    throw new Error(`Refusing to run non-absolute slicer binary: "${binary}"`);
  }
}
function createSlicerAdapter(profile, deps = {}) {
  const runExec = deps.execFile ?? execFile;
  const mkdir2 = deps.mkdtemp ?? mkdtemp2;
  const read = deps.readFile ?? readFile3;
  const write = deps.writeFile ?? writeFile3;
  const remove = deps.rm ?? rm2;
  const tmp = deps.tmpdir ?? tmpdir;
  return {
    id: profile.id,
    async isAvailable() {
      if (!path3.isAbsolute(profile.binary)) return false;
      return new Promise((resolve) => {
        runExec(profile.binary, ["--help"], { timeout: 5e3 }, (err) => resolve(err === null));
      });
    },
    async slice(request) {
      assertAbsoluteBinary(request.profile.binary);
      const timeoutMs = Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS2, MAX_TIMEOUT_MS2);
      const dir = await mkdir2(path3.join(tmp(), "slicer-"));
      const stlPath = path3.join(dir, "model.stl");
      const gcodePath = path3.join(dir, "model.gcode");
      const warnings = [];
      try {
        let bytes = toUint8Array(request.stlBytes);
        if (request.autoDropToBed) {
          const dropped = dropStlToBed(bytes);
          if (dropped !== bytes) warnings.push("autoDropToBed: mesh translated so minZ = 0");
          bytes = dropped;
        }
        await write(stlPath, bytes);
        const args = buildSlicerArgs(request.profile, stlPath, gcodePath);
        await runExecAsync(runExec, request.profile.binary, args, timeoutMs);
        const gcode = (await read(gcodePath)).toString("utf-8");
        return {
          gcode,
          fileName: request.fileName ?? "model.gcode",
          metadata: parseGCodeMetadata(gcode),
          layers: parseLayers(gcode),
          warnings
        };
      } finally {
        await remove(dir, { recursive: true, force: true }).catch(() => {
        });
      }
    }
  };
}
function buildSlicerArgs(profile, stlPath, gcodePath) {
  const args = ["--export-gcode"];
  if (profile.printerPreset) args.push("--printer", profile.printerPreset);
  if (profile.materialPreset) args.push("--filament", profile.materialPreset);
  if (profile.layerHeightMm != null) args.push("--layer-height", String(profile.layerHeightMm));
  if (profile.extraArgs) args.push(...profile.extraArgs);
  args.push("--output", gcodePath, stlPath);
  return args;
}
function runExecAsync(exec, binary, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    exec(binary, args, { timeout: timeoutMs }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`Slicer ${binary} failed: ${err.message}${stderr ? `
${stderr.slice(0, 2e3)}` : ""}`));
      } else {
        resolve();
      }
    });
  });
}
function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  return new Uint8Array(bytes);
}
function dropStlToBed(stlBytes) {
  if (stlBytes.byteLength < 84) return stlBytes;
  const view = new DataView(stlBytes.buffer, stlBytes.byteOffset, stlBytes.byteLength);
  const triCount = view.getUint32(80, true);
  if (!Number.isInteger(triCount) || 84 + triCount * 50 > stlBytes.byteLength) return stlBytes;
  let minZ = Infinity;
  let off = 84;
  for (let t = 0; t < triCount; t++) {
    for (let v = 0; v < 3; v++) {
      const z = view.getFloat32(off + 20 + v * 12, true);
      if (z < minZ) minZ = z;
    }
    off += 50;
  }
  if (!Number.isFinite(minZ) || minZ === 0) return stlBytes;
  const out = new Uint8Array(stlBytes.byteLength);
  out.set(stlBytes);
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
  off = 84;
  for (let t = 0; t < triCount; t++) {
    for (let v = 0; v < 3; v++) {
      const z = view.getFloat32(off + 20 + v * 12, true);
      outView.setFloat32(off + 20 + v * 12, z - minZ, true);
    }
    off += 50;
  }
  return out;
}
function parseGCodeMetadata(gcode) {
  const timeMatch = gcode.match(/estimated printing time[^=]*=\s*([\dhms\s]+)/);
  const filamentMatch = gcode.match(/filament used \[g\]\s*=\s*([\d.]+)/);
  const layerCountMatch = gcode.match(/(?:total layers count|layer_count)\s*=\s*(\d+)/);
  const layerHeightMatch = gcode.match(/layer_height\s*=\s*([\d.]+)/);
  return {
    printTimeMinutes: timeMatch ? parsePrintTime(timeMatch[1]) : 0,
    filamentGrams: filamentMatch ? parseFloat(filamentMatch[1]) : 0,
    layerCount: layerCountMatch ? parseInt(layerCountMatch[1], 10) : 0,
    layerHeightMm: layerHeightMatch ? parseFloat(layerHeightMatch[1]) : null
  };
}
function parsePrintTime(s) {
  let total = 0;
  const h = s.match(/(\d+)h/);
  if (h) total += parseInt(h[1], 10) * 60;
  const m = s.match(/(\d+)m/);
  if (m) total += parseInt(m[1], 10);
  const sec = s.match(/(\d+)s/);
  if (sec) total += parseInt(sec[1], 10) / 60;
  return Math.round(total * 100) / 100;
}
function parseLayers(gcode) {
  const layers = [];
  let currentLayer = -1;
  let lastZ = null;
  for (const raw of gcode.split("\n")) {
    const line = raw.trim();
    const layerMatch = /^;LAYER:(\d+)/.exec(line);
    if (layerMatch) {
      currentLayer = parseInt(layerMatch[1], 10);
      continue;
    }
    const zMatch = /^;Z:([\d.]+)/.exec(line);
    if (zMatch && currentLayer >= 0) {
      const z = parseFloat(zMatch[1]);
      const heightMm = lastZ !== null ? Math.max(0, Math.round((z - lastZ) * 1e3) / 1e3) : 0;
      layers.push({ layerNumber: currentLayer, zMm: z, heightMm });
      lastZ = z;
    }
  }
  return layers;
}

// server/slicerRouter.ts
var SLICER_APP_PATHS = {
  prusaslicer: ["/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer"],
  bambustudio: [
    "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
    "/Applications/BambuStudio.app/Contents/MacOS/bambu-studio"
  ],
  custom: []
};
function serverConfiguredSlicerPaths() {
  const raw = process.env.SLICER_PATHS ?? "";
  return raw.split(":").map((s) => s.trim()).filter((s) => s.length > 0 && path4.isAbsolute(s));
}
async function discoverSlicer(id) {
  const configured = serverConfiguredSlicerPaths();
  const candidates = configured.length > 0 ? configured : SLICER_APP_PATHS[id] ?? [];
  const seen = /* @__PURE__ */ new Set();
  for (const binary of candidates) {
    if (seen.has(binary)) continue;
    seen.add(binary);
    const adapter = createSlicerAdapter({ id, binary });
    if (await adapter.isAvailable()) return binary;
  }
  return null;
}
function sendError2(res, status, code, detail) {
  res.status(status).json({ ok: false, error: { code, detail } });
}
function createSlicerRouter() {
  const router = Router3();
  router.use(express2.json({ limit: "30mb" }));
  router.get("/health", async (_req, res) => {
    const [prusaslicer, bambustudio] = await Promise.all([
      discoverSlicer("prusaslicer"),
      discoverSlicer("bambustudio")
    ]);
    res.json({ ok: true, slicers: { prusaslicer, bambustudio } });
  });
  router.post("/", async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.stlBase64 !== "string" || body.stlBase64.length === 0) {
      sendError2(res, 400, "invalid-input", "stlBase64 must be a non-empty base64 string");
      return;
    }
    const id = body.slicer ?? "prusaslicer";
    const binary = await discoverSlicer(id);
    if (!binary) {
      sendError2(
        res,
        404,
        "slicer-not-found",
        `No ${id} slicer found on this machine (checked SLICER_PATHS and well-known install paths).`
      );
      return;
    }
    const profile = {
      id,
      binary,
      printerPreset: body.printerPreset,
      materialPreset: body.materialPreset,
      layerHeightMm: typeof body.layerHeightMm === "number" ? body.layerHeightMm : void 0
      // NOTE: extraArgs is intentionally never populated from request input —
      // it is reserved for server-side configuration only.
    };
    const adapter = createSlicerAdapter(profile);
    try {
      const stlBytes = Buffer.from(body.stlBase64, "base64");
      if (stlBytes.byteLength < 84) {
        sendError2(res, 400, "invalid-stl", "STL payload too small to be a valid binary STL");
        return;
      }
      const result = await adapter.slice({
        stlBytes,
        fileName: body.fileName,
        profile,
        autoDropToBed: body.autoDropToBed === true,
        timeoutMs: body.timeoutMs
      });
      res.json({ ok: true, result });
    } catch (err) {
      console.error("[slicerRouter] slice failed:", err);
      sendError2(res, 500, "slice-failed", String(err));
    }
  });
  return router;
}

// server/loopbackGuard.ts
function isLoopback(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}
function effectiveClientIp(socketIp, forwardedHeader) {
  if (isLoopback(socketIp) && forwardedHeader) {
    const first = forwardedHeader.split(",")[0]?.trim();
    if (first) return first;
  }
  return socketIp;
}
function bridgeAuthDecision(req, isProduction) {
  if (isProduction) return true;
  const socketIp = req.socket?.remoteAddress ?? "";
  const forwarded = typeof req.headers?.["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : void 0;
  return !isLoopback(effectiveClientIp(socketIp, forwarded));
}

// server/index.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path5.dirname(__filename);
var AMD_MACHINE_URL = process.env.AMD_MACHINE_URL || "http://localhost:8000/v1/chat/completions";
var BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;
var IS_PRODUCTION = process.env.NODE_ENV === "production";
var bridgesEnabled = !IS_PRODUCTION || !!BRIDGE_TOKEN;
var HOST = process.env.HOST || (IS_PRODUCTION ? void 0 : "127.0.0.1");
var AMD_ALLOWED_MODELS = /* @__PURE__ */ new Set([
  "Qwen/Qwen3-8B",
  "Qwen/Qwen3-30B-A3B"
]);
function bridgeAuth(req, res, next) {
  if (!BRIDGE_TOKEN) {
    res.status(503).json({ error: "bridge unavailable: BRIDGE_TOKEN not configured" });
    return;
  }
  const expected = `Bearer ${BRIDGE_TOKEN}`;
  if (req.headers.authorization !== expected) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
function devLocalBridgeGuard(req, res, next) {
  if (bridgeAuthDecision(req, IS_PRODUCTION)) return bridgeAuth(req, res, next);
  next();
}
var RATE_WINDOW_MS = 6e4;
var RATE_LIMIT = 30;
var rateBuckets = /* @__PURE__ */ new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    next();
    return;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  next();
}
async function startServer() {
  const app = express3();
  const server = createServer(app);
  if (bridgesEnabled) {
    const amdProxy = [rateLimit, devLocalBridgeGuard];
    app.post("/api/amd-proxy", express3.json({ limit: "2mb" }), ...amdProxy, async (req, res) => {
      try {
        const body = req.body ?? {};
        const model = typeof body.model === "string" ? body.model : "";
        if (!AMD_ALLOWED_MODELS.has(model)) {
          res.status(400).json({ error: "model not allowed" });
          return;
        }
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          res.status(400).json({ error: "body.messages must be a non-empty array" });
          return;
        }
        if (typeof body.max_tokens !== "number" || body.max_tokens > 4096) {
          res.status(400).json({ error: "max_tokens must be a number <= 4096" });
          return;
        }
        const amdRes = await fetch(AMD_MACHINE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: body.messages,
            max_tokens: body.max_tokens,
            temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
            stream: false
          }),
          signal: AbortSignal.timeout(12e4)
        });
        const data = await amdRes.json();
        res.json(data);
      } catch (err) {
        const timedOut = err instanceof Error && err.name === "TimeoutError";
        res.status(timedOut ? 504 : 500).json({ error: "AMD proxy failed", detail: String(err) });
      }
    });
    app.use("/api/cad/generate", ...amdProxy, createCadBridgeRouter());
    app.use("/api/mesh/process", ...amdProxy, createMeshProcessRouter());
    app.use("/api/slice", ...amdProxy, createSlicerRouter());
    console.log(
      `[server] bridges mounted${BRIDGE_TOKEN ? " (BRIDGE_TOKEN auth)" : " (NODE_ENV != production)"}`
    );
  } else {
    console.warn(
      "[server] production without BRIDGE_TOKEN \u2014 cad/mesh/slice/amd-proxy routes NOT mounted"
    );
  }
  const LLM_ENDPOINTS = {
    claude: "https://api.anthropic.com/v1/messages",
    openai: "https://api.openai.com/v1/chat/completions",
    deepseek: "https://api.deepseek.com/v1/chat/completions",
    kimi: "https://api.moonshot.cn/v1/chat/completions",
    fireworks: "https://api.fireworks.ai/inference/v1/chat/completions"
  };
  const LLM_ALLOWED_MODELS = {
    claude: /* @__PURE__ */ new Set(["claude-sonnet-4-20250514"]),
    openai: /* @__PURE__ */ new Set(["gpt-4o"]),
    gemini: /* @__PURE__ */ new Set(["gemini-2.0-flash"]),
    deepseek: /* @__PURE__ */ new Set(["deepseek-chat"]),
    kimi: /* @__PURE__ */ new Set(["kimi-k3"]),
    fireworks: /* @__PURE__ */ new Set(["accounts/fireworks/models/deepseek-v4-pro"])
  };
  app.post("/api/llm", express3.json({ limit: "2mb" }), rateLimit, async (req, res) => {
    try {
      const { provider, apiKey, body } = req.body ?? {};
      if (typeof provider !== "string" || typeof apiKey !== "string" || apiKey.length === 0) {
        res.status(400).json({ error: "provider and apiKey are required" });
        return;
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        res.status(400).json({ error: "body must be an object" });
        return;
      }
      const allowedModels = LLM_ALLOWED_MODELS[provider];
      if (!allowedModels) {
        res.status(400).json({ error: "provider not allowed" });
        return;
      }
      const model = typeof body.model === "string" ? body.model : "";
      if (!allowedModels.has(model)) {
        res.status(400).json({ error: "model not allowed" });
        return;
      }
      const target = provider === "gemini" ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` : LLM_ENDPOINTS[provider];
      const headers = { "Content-Type": "application/json" };
      if (provider === "claude") {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
      } else if (provider === "gemini") {
        headers["x-goog-api-key"] = apiKey;
      } else {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      const upstream = await fetch(target, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12e4)
      });
      const text = await upstream.text();
      res.status(upstream.status).set("Content-Type", "application/json").send(text || "{}");
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      res.status(timedOut ? 504 : 500).json({ error: "LLM proxy failed", detail: String(err) });
    }
  });
  const staticPath = process.env.NODE_ENV === "production" ? path5.resolve(__dirname, "public") : path5.resolve(__dirname, "..", "dist", "public");
  app.use(express3.static(staticPath));
  app.get("*", (_req, res) => {
    res.sendFile(path5.join(staticPath, "index.html"));
  });
  const port = process.env.PORT || 3e3;
  server.listen(Number(port), HOST, () => {
    console.log(`Server running on http://${HOST ?? "0.0.0.0"}:${port}/`);
  });
}
startServer().catch(console.error);
