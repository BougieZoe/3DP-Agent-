import { useCallback, useEffect, useRef, useState } from 'react';
import { getTranslation, type Language } from '@/lib/i18n';

/**
 * CameraCapture — live viewfinder for the photo → CAD flow.
 *
 * Why a component and not three lines in the panel: opening a device camera is a
 * stateful resource (permission, tracks, recorder, timers). It must be released the
 * instant the tab closes, otherwise the LED stays on and the next open races for the
 * device. All of that bookkeeping lives here; the panel only receives Files.
 *
 * The contract is deliberately File-shaped: whatever comes out — a JPEG frame from the
 * shutter or frames sampled from a recorded clip — lands in the same queue the file
 * picker feeds, so the upload + reconstruction chain downstream never learns that a
 * camera existed.
 */

type CameraState = 'starting' | 'live' | 'unsupported' | 'insecure' | 'denied' | 'unavailable';

const t = (
  language: Language,
  key: Parameters<typeof getTranslation>[1],
  params?: Record<string, string | number>,
) => getTranslation(language, key, params);

const CLIP_FRAME_SAMPLES = 6;

interface CameraCaptureProps {
  language: Language;
  disabled?: boolean;
  onCapture: (files: File[]) => void;
}

export function CameraCapture({ language, disabled = false, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const clipUrlRef = useRef<string | null>(null);

  const [state, setState] = useState<CameraState>('starting');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [detail, setDetail] = useState('');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [clipFrames, setClipFrames] = useState(0);
  const [shots, setShots] = useState(0);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(
    async (mode: 'environment' | 'user') => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setState('unsupported');
        setDetail('getUserMedia unavailable');
        return;
      }
      if (!window.isSecureContext) {
        setState('insecure');
        setDetail('insecure context');
        return;
      }
      setState('starting');
      setDetail('');
      stopTracks();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setState('live');
      } catch (error) {
        const name = (error as DOMException)?.name ?? 'Error';
        const message = (error as Error)?.message ?? '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setState('denied');
        } else {
          setState('unavailable');
        }
        setDetail(`${name}${message ? ` · ${message}` : ''}`);
      }
    },
    [stopTracks],
  );

  useEffect(() => {
    void start(facing);
    return () => {
      stopTimer();
      stopTracks();
      if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    };
  }, [facing, start, stopTimer, stopTracks]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        onCapture([new File([blob], `camera-${stamp}.jpg`, { type: 'image/jpeg' })]);
        setShots((count) => count + 1);
      },
      'image/jpeg',
      0.92,
    );
  }, [onCapture]);

  const seekTo = (video: HTMLVideoElement, time: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener('seeked', done);
        resolve();
      };
      video.addEventListener('seeked', done);
      video.currentTime = time;
    });

  /** The upload endpoint speaks images only, so a clip contributes as sampled frames. */
  const sampleClipFrames = useCallback(
    async (blob: Blob, url: string): Promise<File[]> => {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      try {
        await new Promise<void>((resolve, reject) => {
          video.addEventListener('loadedmetadata', () => resolve(), { once: true });
          video.addEventListener('error', () => reject(new Error('clip-decode-failed')), { once: true });
        });
        // MediaRecorder writes WebM without a duration header, so video.duration stays
        // Infinity until the demuxer is forced past the tail. Without this the sampler
        // silently yields zero frames and a clip would contribute nothing to the job.
        let duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        if (!duration) {
          video.currentTime = 1e7;
          for (let attempt = 0; attempt < 40; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            if (Number.isFinite(video.duration) && video.duration > 0) {
              duration = video.duration;
              break;
            }
          }
          await seekTo(video, 0);
        }
        if (!duration || !video.videoWidth) return [];
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (!context) return [];
        const frames: File[] = [];
        for (let index = 1; index <= CLIP_FRAME_SAMPLES; index += 1) {
          await seekTo(video, (duration * index) / (CLIP_FRAME_SAMPLES + 1));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((next) => resolve(next), 'image/jpeg', 0.92),
          );
          if (frame) {
            frames.push(
              new File([frame], `clip-${Date.now()}-${index}.jpg`, { type: 'image/jpeg' }),
            );
          }
        }
        return frames;
      } catch {
        return [];
      } finally {
        video.removeAttribute('src');
        video.load();
      }
    },
    [],
  );

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorderRef.current = null;
    stopTimer();
    setRecording(false);
  }, [stopTimer]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') return;
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    const mimeType = candidates.find((mime) => MediaRecorder.isTypeSupported?.(mime));
    if (!mimeType) return;

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      if (!blob.size) return;
      if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
      const url = URL.createObjectURL(blob);
      clipUrlRef.current = url;
      setClipUrl(url);
      const frames = await sampleClipFrames(blob, url);
      setClipFrames(frames.length);
      if (frames.length) onCapture(frames);
    };
    recorder.start(250);
    recorderRef.current = recorder;
    setRecording(true);
    setElapsed(0);
    stopTimer();
    timerRef.current = window.setInterval(() => setElapsed((value) => value + 1), 1000);
  }, [onCapture, sampleClipFrames, stopTimer]);

  const clearClip = useCallback(() => {
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    clipUrlRef.current = null;
    setClipUrl(null);
    setClipFrames(0);
  }, []);

  const retry = useCallback(() => {
    void start(facing);
  }, [facing, start]);

  const label = (key: Parameters<typeof getTranslation>[1], fallback: string) => {
    const value = t(language, key);
    return value && value !== key ? value : fallback;
  };

  const live = state === 'live';
  const degraded = state === 'denied' || state === 'unavailable' || state === 'unsupported' || state === 'insecure';

  return (
    <div className="mt-3">
      <div className="relative overflow-hidden rounded-lg border border-border/60 bg-black/70">
        <video
          data-testid="camera-viewfinder"
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`h-44 w-full object-cover ${live ? '' : 'opacity-0'} ${
            facing === 'user' ? 'scale-x-[-1]' : ''
          }`}
        />
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
            <span className="text-[11px] text-neutral-300">
              {state === 'starting'
                ? label('photoToCadCameraStarting', 'Starting camera…')
                : state === 'denied'
                  ? label('photoToCadCameraDenied', 'Camera permission denied.')
                  : state === 'insecure'
                    ? label('photoToCadCameraInsecure', 'Camera needs https or localhost.')
                    : label('photoToCadCameraUnavailable', 'No usable camera found.')}
            </span>
            {detail && <span className="text-[10px] text-neutral-500">{detail}</span>}
            {degraded && (
              <>
                <span className="text-[10px] leading-relaxed text-neutral-400">
                  {label('photoToCadCameraFallback', 'Use “Choose photos” below instead.')}
                </span>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-1 rounded-sm border border-white/20 px-2 py-0.5 text-[10px] text-neutral-300 hover:border-primary/50 hover:text-primary"
                >
                  {label('photoToCadCameraRetry', 'Retry')}
                </button>
              </>
            )}
          </div>
        )}
        {live && (
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-sm bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
            <span className={`h-1.5 w-1.5 rounded-full ${recording ? 'bg-red-500' : 'bg-emerald-400'}`} />
            {recording
              ? t(language, 'photoToCadRecording', { seconds: elapsed })
              : label('photoToCadCameraLive', 'Live')}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="camera-capture"
          onClick={captureFrame}
          disabled={!live || disabled}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40"
        >
          {label('photoToCadShutter', 'Capture')}
          {shots > 0 ? ` · ${t(language, 'photoToCadShots', { count: shots })}` : ''}
        </button>
        <button
          type="button"
          data-testid="camera-record"
          onClick={recording ? stopRecording : startRecording}
          disabled={!live || disabled}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
            recording
              ? 'border-destructive bg-destructive/10 text-destructive'
              : 'border-border bg-background hover:bg-muted'
          }`}
        >
          {recording
            ? label('photoToCadRecordStop', 'Stop')
            : label('photoToCadRecord', 'Record')}
        </button>
        <button
          type="button"
          data-testid="camera-switch"
          onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}
          disabled={disabled}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          {label('photoToCadSwitchCamera', 'Switch')}
        </button>
      </div>

      {clipUrl && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-border/60 bg-background/60 p-2">
          <video src={clipUrl} controls className="h-12 w-20 rounded-sm bg-black object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {t(language, 'photoToCadClipFrames', { count: clipFrames })}
            </p>
          </div>
          <button
            type="button"
            onClick={clearClip}
            className="text-xs text-muted-foreground hover:text-foreground"
            title={label('photoToCadClear', 'Clear')}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default CameraCapture;
