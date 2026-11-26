import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { getTranslation, type Language } from '@/lib/i18n';
import { CameraCapture } from '@/components/CameraCapture';

/**
 * Photo → CAD panel: the entry point for the v1 reconstruction capability.
 *
 * This panel is deliberately ignorant of geometry. It knows four things — photos in, which
 * reference to look for, a job id, and where the outputs live — because the detector
 * thresholds, the calibration arithmetic and the unit linkage all sit behind the published
 * /v1 contract and have to stay replaceable without touching the UI. The moment this file
 * starts reasoning about meshes or millimetres per unit, the boundary has been broken.
 *
 * The one place the UI holds an opinion: it never invents a scale. If the backend says the
 * result is uncalibrated, the panel says so instead of showing a number that looks measured.
 */

type ReferenceChoice = 'a4' | 'card' | 'none';

interface JobScaleView {
  source?: string;
  known_mm?: number;
  measured_mm?: number;
  factor?: number;
  units?: string;
}

interface JobView {
  job_id: string;
  status: string;
  progress?: { stage?: string; percent?: number };
  scale?: JobScaleView;
  outputs?: { format?: string }[];
  error?: { code?: string; message?: string };
}

interface PanelFailure {
  code: string;
  message: string;
}

const POLL_INTERVAL_MS = 2000;
const SETTLED_STATUS = /^(succeeded|failed|cancelled|canceled)$/i;
const ACCEPTED_PHOTOS = '.jpg,.jpeg,.png,.heic,.heif,.tif,.tiff,.webp';

const t = (language: Language, key: Parameters<typeof getTranslation>[1], params?: Record<string, string | number>) =>
  getTranslation(language, key, params);

async function readError(response: Response): Promise<PanelFailure> {
  const payload = (await response.json().catch(() => null)) as { error?: PanelFailure } | null;
  return {
    code: payload?.error?.code ?? `HTTP_${response.status}`,
    message: payload?.error?.message ?? response.statusText ?? 'Request failed',
  };
}

/** One photo, raw bytes, filename in a header — the endpoint takes no multipart envelope. */
async function uploadPhoto(file: File, sessionId: string): Promise<string> {
  const response = await fetch('/v1/reconstructions/uploads', {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-session-id': sessionId,
    },
    body: file,
  });
  if (!response.ok) {
    const failure = await readError(response);
    throw new Error(`${failure.code}: ${failure.message}`);
  }
  const payload = (await response.json()) as { path?: string };
  if (!payload.path) throw new Error('UPLOAD_NO_PATH: the upload endpoint returned no path');
  return payload.path;
}

export function PhotoToCadPanel({ language, embedded = false }: { language: Language; embedded?: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [reference, setReference] = useState<ReferenceChoice>('a4');
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'submitting' | 'running'>('idle');
  const [uploadedCount, setUploadedCount] = useState(0);
  const [job, setJob] = useState<JobView | null>(null);
  const [failure, setFailure] = useState<PanelFailure | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const busy = phase !== 'idle';
  const percent = job?.progress?.percent;
  const stage = job?.progress?.stage;
  const settled = job ? SETTLED_STATUS.test(job.status) : false;
  const succeeded = job ? /^succeeded$/i.test(job.status) : false;
  const scale = job?.scale;

  const referenceOptions = useMemo(
    () =>
      [
        { value: 'a4' as ReferenceChoice, label: t(language, 'photoToCadRefA4') },
        { value: 'card' as ReferenceChoice, label: t(language, 'photoToCadRefCard') },
        { value: 'none' as ReferenceChoice, label: t(language, 'photoToCadRefNone') },
      ],
    [language],
  );

  const handlePick = useCallback((picked: FileList | null) => {
    if (!picked?.length) return;
    setFiles((current) => [...current, ...Array.from(picked)]);
    setFailure(null);
  }, []);

  /** Camera frames (shutter) and clip frames land in the same queue as picked files. */
  const handleCapture = useCallback((captured: File[]) => {
    if (!captured.length) return;
    setFiles((current) => [...current, ...captured]);
    setFailure(null);
  }, []);

  const handleRemoveAt = useCallback((index: number) => {
    setFiles((current) => current.filter((_, position) => position !== index));
  }, []);

  // Object URLs exist only for the lifetime of the current queue: keeping them past a
  // reset leaks the whole frame set into the tab's memory.
  const previews = useMemo(
    () =>
      files.map((file) => ({
        file,
        url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      })),
    [files],
  );

  useEffect(
    () => () => {
      previews.forEach((preview) => {
        if (preview.url) URL.revokeObjectURL(preview.url);
      });
    },
    [previews],
  );

  // Polling is driven by the job object itself: any status change re-arms the timer, a settled
  // status stops it. Cancelling the timeout on cleanup keeps a fast job from being polled twice.
  useEffect(() => {
    if (phase !== 'running' || !job?.job_id || SETTLED_STATUS.test(job.status)) return;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/v1/reconstructions/${job.job_id}`);
        if (!response.ok) {
          setFailure(await readError(response));
          setPhase('idle');
          return;
        }
        const next = (await response.json()) as JobView;
        setJob(next);
        if (/^failed$/i.test(next.status)) {
          setFailure({
            code: next.error?.code ?? 'RECONSTRUCTION_FAILED',
            message: next.error?.message ?? next.status,
          });
          setPhase('idle');
        } else if (SETTLED_STATUS.test(next.status)) {
          setPhase('idle');
        }
      } catch (error) {
        setFailure({ code: 'POLL_FAILED', message: (error as Error).message });
        setPhase('idle');
      }
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [phase, job]);

  const handleStart = useCallback(async () => {
    if (!files.length) {
      toast.error(t(language, 'photoToCadNoPhotos'));
      return;
    }
    setFailure(null);
    setJob(null);
    setUploadedCount(0);
    setPhase('uploading');

    const sessionId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `session-${Date.now()}`;

    try {
      const paths: string[] = [];
      for (const file of files) {
        paths.push(await uploadPhoto(file, sessionId));
        setUploadedCount(paths.length);
      }

      setPhase('submitting');
      const payload = {
        input: {
          images: paths.map((path) => ({ path })),
          // "Find the A4 sheet in the mesh" is one field, not a manual measurement. The
          // detector decides where it is; the backend refuses (422) rather than guess.
          ...(reference === 'none'
            ? {}
            : { scale_reference: { kind: 'reference_object', spec_id: reference } }),
        },
        output: { formats: ['stl', 'step'], units: 'mm' },
      };

      const response = await fetch('/v1/reconstructions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setFailure(await readError(response));
        setPhase('idle');
        return;
      }

      const created = (await response.json()) as JobView;
      setJob(created);
      setPhase(SETTLED_STATUS.test(created.status) ? 'idle' : 'running');
    } catch (error) {
      setFailure({ code: 'SUBMIT_FAILED', message: (error as Error).message });
      setPhase('idle');
    }
  }, [files, language, reference]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setJob(null);
    setFailure(null);
    setUploadedCount(0);
    setPhase('idle');
  }, []);

  return (
    <section
      className={
        embedded
          ? "text-neutral-200 [&_.text-foreground]:text-neutral-100 [&_.text-muted-foreground]:text-neutral-500"
          : "rounded-xl border border-border/60 bg-card/40 p-4"
      }
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={embedded ? "sr-only" : "text-sm font-semibold uppercase tracking-wide text-foreground"}>
          {t(language, 'photoToCad')}
        </h3>
        <button
          type="button"
          aria-label={t(language, 'photoToCadClear')}
          title={t(language, 'photoToCadClear')}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          onClick={handleReset}
          disabled={busy}
        >
          ×
        </button>
      </header>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {t(language, 'photoToCadHint')}
      </p>

      <CameraCapture language={language} disabled={busy} onCapture={handleCapture} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_PHOTOS}
          multiple
          className="hidden"
          onChange={(event) => {
            handlePick(event.target.files);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {t(language, 'photoToCadAddPhotos')}
        </button>
        {files.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t(language, 'photoToCadPhotosSelected', { count: files.length })}
            {phase === 'uploading' && ` (${uploadedCount}/${files.length})`}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground/80">{t(language, 'photoToCadDropHint')}</p>

      {previews.length > 0 && (
        <ul data-testid="camera-shots" className="mt-2 flex flex-wrap gap-1.5">
          {previews.map((preview, index) => (
            <li key={`${preview.file.name}-${index}`} className="relative">
              {preview.url ? (
                <img
                  src={preview.url}
                  alt={preview.file.name}
                  className="h-12 w-12 rounded-sm border border-border/60 object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-sm border border-border/60 text-[10px] text-muted-foreground">
                  {t(language, 'photoToCadClip')}
                </span>
              )}
              <button
                type="button"
                aria-label={t(language, 'photoToCadRemoveShot')}
                title={t(language, 'photoToCadRemoveShot')}
                onClick={() => handleRemoveAt(index)}
                disabled={busy}
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-[9px] leading-none text-muted-foreground hover:text-destructive disabled:opacity-40"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <fieldset className="mt-4" disabled={busy}>
        <legend className="text-xs font-medium text-foreground">
          {t(language, 'photoToCadReference')}
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {referenceOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setReference(option.value)}
              className={[
                'rounded-md border px-3 py-1.5 text-xs transition-colors',
                reference === option.value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted',
              ].join(' ')}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground/80">
          {t(language, 'photoToCadRefHelp')}
        </p>
      </fieldset>

      <button
        type="button"
        className="mt-4 w-full rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
        onClick={handleStart}
        disabled={busy || files.length === 0}
      >
        {phase === 'uploading'
          ? t(language, 'photoToCadUploading')
          : phase === 'running' || phase === 'submitting'
            ? t(language, 'photoToCadReconstructing')
            : t(language, 'photoToCadSubmit')}
      </button>

      {(phase === 'running' || (job && !settled)) && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.max(0, Math.min(100, percent ?? 5))}%` }}
            />
          </div>
          {stage && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {t(language, 'photoToCadStage', { stage })}
            </p>
          )}
        </div>
      )}

      {succeeded && job && (
        <div className="mt-3 space-y-2 rounded-lg border border-border/60 bg-background/60 p-3">
          {scale?.known_mm && scale?.measured_mm ? (
            <p className="text-[11px] leading-relaxed text-foreground">
              {t(language, 'photoToCadScaleApplied', {
                measured: scale.measured_mm.toFixed(2),
                known: scale.known_mm.toFixed(2),
                source: scale.source ?? '—',
              })}
            </p>
          ) : (
            // No calibration block means the mesh has no real size. Saying nothing here would
            // let the operator believe millimetres came back when only engine units did.
            <p className="text-[11px] leading-relaxed text-amber-600">
              {t(language, 'photoToCadRefNone')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <a
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
              href={`/v1/reconstructions/${job.job_id}/outputs/stl`}
              download
            >
              {t(language, 'photoToCadDownloadStl')}
            </a>
            <a
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
              href={`/v1/reconstructions/${job.job_id}/outputs/step`}
              download
            >
              {t(language, 'photoToCadDownloadStep')}
            </a>
          </div>
        </div>
      )}

      {failure && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-[11px] font-semibold text-destructive">
            {t(language, 'photoToCadFailed')} · {failure.code}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{failure.message}</p>
        </div>
      )}
    </section>
  );
}
