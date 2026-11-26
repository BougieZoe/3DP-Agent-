/**
 * ASR Router — local open-source speech-to-text bridge.
 *
 * The browser SpeechRecognition API is unavailable in Electron (and in most
 * non-Chrome shells), so voice control falls back to a local, open-source
 * Whisper engine executed on the host machine:
 *
 *   - whisper.cpp  (`whisper-cli` / `whisper-cpp` CLI + a GGUF/ggml model)
 *   - MLX Whisper  (`mlx_whisper`, Apple silicon accelerated)
 *   - OpenAI Whisper CLI (`whisper`, reference implementation)
 *
 * Engine detection order can be overridden with env vars:
 *   ASR_BIN    absolute path to the CLI binary
 *   ASR_ENGINE `whisper-cpp` | `mlx-whisper` | `openai-whisper`
 *   ASR_MODEL  model path (whisper.cpp) or model name (mlx/openai)
 *
 * Endpoints (mounted at /api/asr):
 *   GET  /health      -> { available, engine, model, languages }
 *   POST /transcribe  -> { text, engine, language } (raw audio body)
 */
import { Router } from "express";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ASR_LANGUAGES = [
  "en",
  "ja",
  "zh",
  "ko",
  "de",
  "es",
  "fr",
  "it",
  "sv",
] as const;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 120_000;

export type AsrEngineKind = "whisper-cpp" | "mlx-whisper" | "openai-whisper";

export interface AsrEngine {
  kind: AsrEngineKind;
  bin: string;
  model: string | null;
}

const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/flac": "flac",
};

const CANDIDATE_BINARIES: Record<AsrEngineKind, string[]> = {
  "whisper-cpp": ["whisper-cli", "whisper-cpp", "main"],
  "mlx-whisper": ["mlx_whisper"],
  "openai-whisper": ["whisper"],
};

/** Resolve an executable on PATH (returns null when missing). */
async function which(cmd: string): Promise<string | null> {
  if (cmd.includes(path.sep)) {
    try {
      await fs.access(cmd, fs.constants.X_OK);
      return cmd;
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execFileAsync("/usr/bin/env", ["which", cmd], {
      timeout: 5_000,
    });
    const found = stdout.trim().split("\n")[0];
    return found || null;
  } catch {
    return null;
  }
}

/**
 * Detect an available local Whisper engine.
 * `ASR_BIN` wins over auto-detection; `ASR_ENGINE` filters the candidate list.
 */
export async function detectAsrEngine(): Promise<AsrEngine | null> {
  const forcedBin = process.env.ASR_BIN?.trim();
  const forcedKind = process.env.ASR_ENGINE?.trim() as AsrEngineKind | undefined;
  const model = process.env.ASR_MODEL?.trim() || null;

  if (forcedBin) {
    const kind: AsrEngineKind =
      forcedKind ??
      (forcedBin.includes("mlx") ? "mlx-whisper" : forcedBin.includes("whisper-cpp") ? "whisper-cpp" : "openai-whisper");
    const resolved = await which(forcedBin);
    return resolved ? { kind, bin: resolved, model } : null;
  }

  const kinds: AsrEngineKind[] = forcedKind
    ? [forcedKind]
    : ["whisper-cpp", "mlx-whisper", "openai-whisper"];

  for (const kind of kinds) {
    for (const name of CANDIDATE_BINARIES[kind]) {
      const bin = await which(name);
      if (bin) return { kind, bin, model };
    }
  }
  return null;
}

function engineArgs(engine: AsrEngine, audioPath: string, language: string, outBase: string): string[] {
  switch (engine.kind) {
    case "whisper-cpp": {
      const model = engine.model ?? "";
      const args = ["-f", audioPath, "-l", language, "-otxt", "-of", outBase, "-nt"];
      if (model) args.unshift("-m", model);
      return args;
    }
    case "mlx-whisper": {
      const args = [audioPath, "--language", language, "--output-format", "txt", "--output-dir", outBase];
      if (engine.model) args.push("--model", engine.model);
      return args;
    }
    case "openai-whisper":
    default: {
      const args = [audioPath, "--language", language, "--output_format", "txt", "--output_dir", outBase];
      if (engine.model) args.push("--model", engine.model);
      return args;
    }
  }
}

/** Locate the `.txt` transcript the CLI produced inside `dir`. */
async function readTranscript(dir: string): Promise<string> {
  const entries = await fs.readdir(dir);
  const txt = entries.find((name) => name.endsWith(".txt"));
  if (!txt) return "";
  const raw = await fs.readFile(path.join(dir, txt), "utf8");
  return raw.trim();
}

export async function transcribeAudio(
  audio: Buffer,
  contentType: string,
  language: string,
): Promise<{ text: string; engine: AsrEngineKind }> {
  if (!audio.length) throw new Error("empty audio payload");
  if (audio.length > MAX_AUDIO_BYTES) throw new Error("audio payload too large");

  const engine = await detectAsrEngine();
  if (!engine) throw new Error("no local ASR engine found");
  if (engine.kind === "whisper-cpp" && !engine.model) {
    throw new Error("whisper.cpp requires ASR_MODEL to point at a ggml/gguf model");
  }

  const safeLang = (ASR_LANGUAGES as readonly string[]).includes(language) ? language : "en";
  const ext = EXT_BY_MIME[contentType.split(";")[0].trim().toLowerCase()] ?? "webm";
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "marvis-asr-"));
  const audioPath = path.join(workDir, `input.${ext}`);
  const outBase = path.join(workDir, "out");
  const outDir = path.join(workDir, "out-dir");

  try {
    await fs.writeFile(audioPath, audio);
    await fs.mkdir(outDir, { recursive: true });
    const args = engineArgs(engine, audioPath, safeLang, engine.kind === "whisper-cpp" ? outBase : outDir);
    await execFileAsync(engine.bin, args, {
      timeout: TRANSCRIBE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    const text =
      engine.kind === "whisper-cpp"
        ? (await fs.readFile(`${outBase}.txt`, "utf8").catch(() => "")).trim()
        : await readTranscript(outDir);

    return { text, engine: engine.kind };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function createAsrRouter(): Router {
  const router = Router();

  router.get("/health", async (_req, res) => {
    try {
      const engine = await detectAsrEngine();
      res.json({
        available: Boolean(engine),
        engine: engine?.kind ?? null,
        bin: engine?.bin ?? null,
        model: engine?.model ?? null,
        languages: ASR_LANGUAGES,
      });
    } catch (error) {
      res.status(500).json({ available: false, error: (error as Error).message });
    }
  });

  router.post("/transcribe", async (req, res) => {
    const contentType = req.headers["content-type"] ?? "audio/webm";
    const language = String((req.query.lang as string) ?? "en");
    const body = req.body;

    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "raw audio body required (Content-Type: audio/*)" });
      return;
    }

    try {
      const result = await transcribeAudio(body, contentType, language);
      res.json({ text: result.text, engine: result.engine, language });
    } catch (error) {
      const message = (error as Error).message;
      const status = message.includes("no local ASR engine") ? 501 : 500;
      res.status(status).json({ error: message });
    }
  });

  return router;
}

export default createAsrRouter;
