/**
 * Local ASR voice controller — open-source Whisper running on the host.
 *
 * Same public shape as the Web Speech API controller in `voiceInput.ts`
 * (`isSupported / isListening / start / stop / onResult / onError`), so the
 * UI can swap engines without knowing which one is active.
 *
 * Audio is captured with MediaRecorder and streamed in short segments to
 * `POST /api/asr/transcribe`, which shells out to whisper.cpp / MLX Whisper.
 */
import type { VoiceController, VoiceInputConfig } from "./voiceInput";

const SEGMENT_MS = 5_000;
const HEALTH_TTL_MS = 60_000;

interface AsrHealth {
  available: boolean;
  engine: string | null;
  languages: string[];
}

let cachedHealth: { value: AsrHealth; at: number } | null = null;

/** Probe the local ASR bridge; result is cached briefly. */
export async function isLocalAsrAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
  if (typeof MediaRecorder === "undefined") return false;
  if (cachedHealth && Date.now() - cachedHealth.at < HEALTH_TTL_MS) {
    return cachedHealth.value.available;
  }
  try {
    const response = await fetch("/api/asr/health");
    if (!response.ok) throw new Error(`health ${response.status}`);
    const value = (await response.json()) as AsrHealth;
    cachedHealth = { value, at: Date.now() };
    return Boolean(value.available);
  } catch {
    return false;
  }
}

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return "";
}

async function transcribeBlob(blob: Blob, mimeType: string, language: string): Promise<string> {
  const response = await fetch(`/api/asr/transcribe?lang=${encodeURIComponent(language)}`, {
    method: "POST",
    headers: { "Content-Type": mimeType || "audio/webm" },
    body: blob,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ASR ${response.status}: ${detail.slice(0, 200)}`);
  }
  const payload = (await response.json()) as { text?: string };
  return (payload.text ?? "").trim();
}

export function createLocalVoiceController(config: VoiceInputConfig = {}): VoiceController {
  const language = config.language ?? "en";
  const resultCallbacks: Array<(text: string, isFinal: boolean) => void> = [];
  const errorCallbacks: Array<(error: string) => void> = [];

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let listening = false;
  let stopping = false;
  let queue: Promise<void> = Promise.resolve();

  const emitError = (error: string) => {
    for (const cb of errorCallbacks) cb(error);
  };

  const emitResult = (text: string) => {
    if (!text) return;
    for (const cb of resultCallbacks) cb(text, true);
  };

  const startSegment = () => {
    if (!stream || stopping) return;
    const mimeType = pickMimeType();
    const chunks: BlobPart[] = [];
    const active = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder = active;

    active.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    active.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
      if (blob.size < 1024) {
        if (!stopping) startSegment();
        return;
      }
      // Serialize uploads so transcripts arrive in order.
      queue = queue
        .then(async () => {
          const text = await transcribeBlob(blob, mimeType || "audio/webm", language);
          emitResult(text);
        })
        .catch((error) => emitError((error as Error).message))
        .finally(() => {
          if (!stopping) startSegment();
        });
    };

    active.onerror = () => emitError("recorder error");
    active.start();
    window.setTimeout(() => {
      if (active.state === "recording") active.stop();
    }, SEGMENT_MS);
  };

  return {
    get isSupported() {
      return true;
    },
    get isListening() {
      return listening;
    },
    async start() {
      if (listening) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        throw new Error("Microphone access denied");
      }
      listening = true;
      stopping = false;
      try {
        startSegment();
      } catch (error) {
        listening = false;
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
        throw error;
      }
    },
    stop() {
      stopping = true;
      listening = false;
      const active = recorder;
      recorder = null;
      if (active && active.state === "recording") active.stop();
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    },
    onResult(callback) {
      resultCallbacks.push(callback);
      return () => {
        const index = resultCallbacks.indexOf(callback);
        if (index >= 0) resultCallbacks.splice(index, 1);
      };
    },
    onError(callback) {
      errorCallbacks.push(callback);
      return () => {
        const index = errorCallbacks.indexOf(callback);
        if (index >= 0) errorCallbacks.splice(index, 1);
      };
    },
  };
}
