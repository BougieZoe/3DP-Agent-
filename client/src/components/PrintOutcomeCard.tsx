/**
 * PrintOutcomeCard — record the ACTUAL manufacturing outcome for one analysis run.
 *
 * This is the observed result (kind F in the evidence hierarchy), deliberately
 * separated from everything above it in the report: scores and findings are
 * predictions; what gets selected here is what physically happened.
 *
 * Local-first: persists through the analysis-history RecordStore (IndexedDB).
 * Nothing here performs network I/O. Attaches strictly to the record id of the
 * run that produced the report on screen — never to "any record with this
 * file's fingerprint".
 */
import { useCallback, useEffect, useState } from 'react';
import { getAnalysisHistory, updateOutcome, type RecordStore } from '@/lib/analysisHistory';
import {
  FAILURE_TYPES,
  type AnalysisRecord,
  type FailureType,
  type OutcomeStatus,
} from '@/lib/analysisRecord';
import { uploadOutcomeAnonymous, type OutcomeUploader } from '@/lib/outcomeUpload';
import { recordAnalysisOutcome } from '@/lib/printFeedback';
import type { Language } from '@/lib/i18n';

const L = {
  en: {
    title: 'PRINT OUTCOME',
    observed: '[OBSERVED]',
    caption:
      'What actually happened on the printer. Scores above are predictions — this entry is the observed result that checks them.',
    legend: 'Observed result',
    statuses: {
      success: 'Successful print',
      partial: 'Partial — rework needed',
      failure: 'Failed print',
      unknown: 'Unknown',
      not_tested: 'Not tested',
    } as Record<OutcomeStatus, string>,
    predicted: 'Predicted score',
    failureDetails: 'Failure details (optional)',
    failureLayerLabel: 'Failed layer',
    failureLayerPlaceholder: 'e.g. 12',
    failureTypeLabel: 'Failure type',
    failureTypeNone: 'Not specified',
    failureTypes: {
      warping: 'Warping',
      layer_adhesion: 'Layer adhesion',
      layer_shift: 'Layer shift',
      stringing: 'Stringing',
      under_extrusion: 'Under-extrusion',
      over_extrusion: 'Over-extrusion',
      clog: 'Clog / jam',
      dimensional_accuracy: 'Dimensional accuracy',
      surface_finish: 'Surface finish',
      other: 'Other',
    } as Record<FailureType, string>,
    notesLabel: 'Notes / failure description (optional)',
    notesPlaceholder: 'e.g. layer 12 detached from bed, corner warped…',
    save: 'SAVE OUTCOME',
    saving: 'SAVING…',
    saved: 'Saved to local history',
    saveError: 'Save failed — outcome NOT recorded.',
    loadError: 'No analysis record for this run — outcome not recordable.',
    noRecord:
      'No linked analysis record for this run — outcome cannot be recorded. Re-run the analysis from the upload flow.',
    loading: 'Loading record…',
    recordedAt: 'Recorded',
    localNote: 'Stored in this browser only',
  },
  ja: {
    title: '印刷結果',
    observed: '[実測]',
    caption:
      '実際にプリンターで起きたことです。上のスコアは予測であり、ここはそれを検証する実測結果です。',
    legend: '実測結果',
    statuses: {
      success: '印刷成功',
      partial: '一部成功 — 要手直し',
      failure: '印刷失敗',
      unknown: '不明',
      not_tested: '未テスト',
    } as Record<OutcomeStatus, string>,
    predicted: '予測スコア',
    failureDetails: '失敗の詳細（任意）',
    failureLayerLabel: '失敗した層',
    failureLayerPlaceholder: '例：12',
    failureTypeLabel: '失敗の種類',
    failureTypeNone: '未指定',
    failureTypes: {
      warping: '反り',
      layer_adhesion: '層間密着不良',
      layer_shift: '層ずれ',
      stringing: '糸引き',
      under_extrusion: '押出不足',
      over_extrusion: '押出過多',
      clog: '詰まり',
      dimensional_accuracy: '寸法精度',
      surface_finish: '表面仕上げ',
      other: 'その他',
    } as Record<FailureType, string>,
    notesLabel: 'メモ / 失敗内容（任意）',
    notesPlaceholder: '例：12層目がベッドから剥離、角の反り…',
    save: '結果を保存',
    saving: '保存中…',
    saved: 'ローカル履歴に保存しました',
    saveError: '保存失敗 — 結果は記録されていません。',
    loadError: 'この実行の分析記録がありません — 結果を記録できません。',
    noRecord:
      'この実行に紐づく分析記録がないため、結果は記録できません。アップロードから分析を再実行してください。',
    loading: '記録を読み込み中…',
    recordedAt: '記録日時',
    localNote: 'このブラウザ内にのみ保存',
  },
  zh: {
    title: '打印结果',
    observed: '[实测]',
    caption: '打印机上实际发生的情况。上方评分是预测——此处记录的是验证它们的实测结果。',
    legend: '实测结果',
    statuses: {
      success: '打印成功',
      partial: '部分成功 — 需返工',
      failure: '打印失败',
      unknown: '未知',
      not_tested: '未测试',
    } as Record<OutcomeStatus, string>,
    predicted: '预测评分',
    failureDetails: '失败详情（可选）',
    failureLayerLabel: '失败层号',
    failureLayerPlaceholder: '例：12',
    failureTypeLabel: '失败类型',
    failureTypeNone: '未指定',
    failureTypes: {
      warping: '翘曲',
      layer_adhesion: '层间附着不良',
      layer_shift: '层偏移',
      stringing: '拉丝',
      under_extrusion: '挤出不足',
      over_extrusion: '挤出过量',
      clog: '堵塞',
      dimensional_accuracy: '尺寸精度',
      surface_finish: '表面质量',
      other: '其他',
    } as Record<FailureType, string>,
    notesLabel: '备注 / 失败描述（可选）',
    notesPlaceholder: '例：第12层脱离热床、角部翘曲…',
    save: '保存结果',
    saving: '保存中…',
    saved: '已保存到本地历史',
    saveError: '保存失败 — 结果未被记录。',
    loadError: '本次运行没有分析记录 — 无法记录结果。',
    noRecord: '本次运行没有关联的分析记录，无法记录结果。请从上传流程重新运行分析。',
    loading: '正在加载记录…',
    recordedAt: '记录时间',
    localNote: '仅存储在此浏览器中',
  },
} as const;

const ORDER: OutcomeStatus[] = ['success', 'partial', 'failure', 'unknown', 'not_tested'];

const STATUS_ACCENT: Record<OutcomeStatus, string> = {
  success: 'text-emerald-400',
  partial: 'text-amber-400',
  failure: 'text-red-400',
  unknown: 'text-muted-foreground',
  not_tested: 'text-muted-foreground',
};


interface Props {
  /** Record id of the analysis run this outcome attaches to; null = not recordable. */
  recordId: string | null;
  language: Language;
  /** Injectable for tests; defaults to the shared IndexedDB-backed store. */
  store?: RecordStore;
  /** Opt-in anonymized uploader. Omit to keep the outcome local-only. */
  uploader?: OutcomeUploader;
}

type Phase = 'loading' | 'ready' | 'saving' | 'saved' | 'error';

export function PrintOutcomeCard({ recordId, language, store, uploader }: Props) {
  const t = L[language] || L.en;
  const history = store ?? getAnalysisHistory();

  const [phase, setPhase] = useState<Phase>(recordId ? 'loading' : 'error');
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [status, setStatus] = useState<OutcomeStatus>('not_tested');
  const [failureType, setFailureType] = useState<FailureType | ''>('');
  const [failureLayer, setFailureLayer] = useState('');
  const [notes, setNotes] = useState('');
  // Which failure the alert shows: loading a record vs saving one.
  const [errorKind, setErrorKind] = useState<'load' | 'save'>('load');

  useEffect(() => {
    let cancelled = false;
    if (!recordId) {
      setPhase('error');
      setErrorKind('load');
      setRecord(null);
      return;
    }
    setPhase('loading');
    history
      .get(recordId)
      .then((r) => {
        if (cancelled) return;
        if (!r) {
          setPhase('error');
          setRecord(null);
          return;
        }
        setRecord(r);
        setStatus(r.outcome.status);
        setFailureType(r.outcome.failureType ?? '');
        setFailureLayer(r.outcome.failureLayer != null ? String(r.outcome.failureLayer) : '');
        setNotes(r.outcome.notes ?? '');
        setPhase('ready');
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [recordId, history]);

  const handleSave = useCallback(async () => {
    if (!recordId || phase === 'saving') return;
    setPhase('saving');
    try {
      // Preserve detail fields this card does not edit — updateOutcome writes
      // the full outcome object, so re-sending them avoids wiping history.
      const source = record;
      const trimmed = notes.trim();
      const parsedLayer = failureLayer.trim() === '' ? null : Number(failureLayer);
      const layer =
        parsedLayer !== null && Number.isInteger(parsedLayer) && parsedLayer >= 1
          ? parsedLayer
          : null;
      const updated = await updateOutcome(history, recordId, {
        status,
        notes: trimmed ? trimmed : null,
        failureLayer: layer,
        failureType: failureType || null,
        failureMode: source?.outcome.failureMode ?? null,
        actualSettings: source?.outcome.actualSettings ?? null,
      });
      if (!updated) {
        setErrorKind('save');
        setPhase('error');
        return;
      }
      // Verify the write actually landed: the history store's save() is
      // best-effort by design and swallows storage failures, so a resolved
      // update alone is not proof of persistence.
      const reread = await history.get(recordId);
      if (!reread || reread.outcome.status !== status) {
        setErrorKind('save');
        setPhase('error');
        return;
      }
      setRecord(reread);
      // Canonical record is the source of truth; calibration is its derived
      // index. Editing the same record replaces its printId entry.
      recordAnalysisOutcome(reread);
      setPhase('saved');
      // Reserved opt-in aggregation. The default uploader is local-only and
      // never touches the network; an upload failure must not mask the save.
      if (uploader) void uploadOutcomeAnonymous(reread, uploader);
    } catch {
      setErrorKind('save');
      setPhase('error');
    }
  }, [recordId, phase, status, failureType, failureLayer, notes, history, record, uploader]);

  // Not recordable: honest single-line notice, no form. Never silently attach
  // to a fingerprint-matched record instead.
  if (!recordId) {
    return (
      <div className="border border-border/50 rounded-sm bg-card/30 px-4 py-3 text-xs text-muted-foreground/70">
        {t.noRecord}
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div
        className="border border-border rounded-sm bg-card px-4 py-3 fade-up"
        role="status"
        aria-live="polite"
      >
        <span className="text-xs font-mono text-muted-foreground animate-pulse">
          ▋ {t.loading}
        </span>
      </div>
    );
  }

  if ((phase === 'error' && errorKind === 'load') || !record) {
    return (
      <div
        className="border border-amber-500/40 bg-amber-500/5 text-amber-400/90 rounded-sm px-4 py-3 text-xs font-mono"
        role="alert"
      >
        {t.loadError}
      </div>
    );
  }

  const statusLine =
    phase === 'saving'
      ? t.saving
      : phase === 'saved'
        ? `✓ ${t.saved}`
        : phase === 'error'
          ? t.saveError
          : '';

  return (
    <div className="border border-border rounded-sm bg-card p-4 fade-up">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-primary tracking-widest">{t.title}</span>
        <div className="flex items-center gap-2">
          {typeof record.score?.value === 'number' && (
            <span className="text-[10px] font-mono text-muted-foreground/60">
              {t.predicted}: {record.score.value}
            </span>
          )}
          <span className="text-[10px] font-mono text-emerald-400/80 border border-emerald-400/30 rounded-sm px-1.5 py-0.5">
            {t.observed}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground/70 leading-relaxed mb-3">{t.caption}</p>

      <fieldset disabled={phase === 'saving'} className="mb-3">
        <legend className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-1.5">
          {t.legend}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {ORDER.map((s) => {
            const selected = status === s;
            return (
              <label
                key={s}
                className={`cursor-pointer border rounded-sm px-2.5 py-1.5 text-xs font-mono transition-colors focus-within:ring-1 focus-within:ring-primary ${
                  selected
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : 'border-border/40 text-muted-foreground hover:text-foreground hover:border-foreground/30'
                }`}
              >
                <input
                  type="radio"
                  name="print-outcome-status"
                  value={s}
                  checked={selected}
                  onChange={() => {
                    setStatus(s);
                    setPhase('ready');
                  }}
                  className="sr-only"
                />
                <span className={selected ? STATUS_ACCENT[s] : undefined}>{t.statuses[s]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {(status === 'failure' || status === 'partial') && (
        <div className="mb-3 border border-border/40 rounded-sm p-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-2">
            {t.failureDetails}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[10px] font-mono text-muted-foreground/50 mb-1">
                {t.failureLayerLabel}
              </span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={failureLayer}
                onChange={(e) => {
                  setFailureLayer(e.target.value);
                  setPhase('ready');
                }}
                disabled={phase === 'saving'}
                placeholder={t.failureLayerPlaceholder}
                aria-label={t.failureLayerLabel}
                className="w-full text-xs font-mono bg-background/40 border border-border/40 rounded-sm px-2 py-1.5 text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="block text-[10px] font-mono text-muted-foreground/50 mb-1">
                {t.failureTypeLabel}
              </span>
              <select
                value={failureType}
                onChange={(e) => {
                  setFailureType(e.target.value as FailureType | '');
                  setPhase('ready');
                }}
                disabled={phase === 'saving'}
                aria-label={t.failureTypeLabel}
                className="w-full text-xs font-mono bg-background/40 border border-border/40 rounded-sm px-2 py-1.5 text-foreground/90 focus:outline-none focus:border-primary/50 disabled:opacity-50"
              >
                <option value="">{t.failureTypeNone}</option>
                {FAILURE_TYPES.map((ft) => (
                  <option key={ft} value={ft}>{t.failureTypes[ft]}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      <label className="block mb-3">
        <span className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-1">
          {t.notesLabel}
        </span>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setPhase('ready');
          }}
          disabled={phase === 'saving'}
          rows={2}
          placeholder={t.notesPlaceholder}
          aria-label={t.notesLabel}
          className="w-full text-xs font-mono bg-background/40 border border-border/40 rounded-sm px-2 py-1.5 text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 disabled:opacity-50"
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <button
          onClick={handleSave}
          disabled={phase === 'saving'}
          className="px-3 py-2 text-xs font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all disabled:opacity-50"
        >
          {phase === 'saving' ? t.saving : t.save}
        </button>
        <span
          aria-live="polite"
          role={phase === 'error' ? 'alert' : undefined}
          className={`text-[11px] font-mono ${
            phase === 'saved'
              ? 'text-emerald-400'
              : phase === 'error'
                ? 'text-red-400'
                : 'text-muted-foreground/60'
          }`}
        >
          {statusLine}
          {phase === 'saved' && record.outcome.recordedAt && (
            <span className="text-muted-foreground/50">
              {' '}
              {t.recordedAt}{' '}
              {record.outcome.recordedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}
            </span>
          )}
        </span>
      </div>

      <div className="mt-2 text-[10px] font-mono text-muted-foreground/40">
        {t.localNote} · {record.model.fileName}
      </div>
    </div>
  );
}
