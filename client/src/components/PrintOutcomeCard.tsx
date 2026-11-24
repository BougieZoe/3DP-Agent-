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
import { pickLang } from '@shared/i18n/content';

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
  ko: {
    title: '인쇄 결과',
    observed: '[실측]',
    caption: '프린터에서 실제로 일어난 일입니다. 위 점수는 예측이며, 여기에는 이를 검증하는 실측 결과를 기록합니다.',
    legend: '실측 결과',
    statuses: {
      success: '성공적으로 인쇄됨',
      partial: '부분 성공 — 재작업 필요',
      failure: '인쇄 실패',
      unknown: '알 수 없음',
      not_tested: '미검증',
    } as Record<OutcomeStatus, string>,
    predicted: '예측 점수',
    failureDetails: '실패 상세 (선택)',
    failureLayerLabel: '실패한 층',
    failureLayerPlaceholder: '예: 12',
    failureTypeLabel: '실패 유형',
    failureTypeNone: '미지정',
    failureTypes: {
      warping: '뒤틀림',
      layer_adhesion: '층 접착 불량',
      layer_shift: '층 어긋남',
      stringing: '실 가닥',
      under_extrusion: '압출 부족',
      over_extrusion: '압출 과다',
      clog: '노즐 막힘',
      dimensional_accuracy: '치수 정확도',
      surface_finish: '표면 조도',
      other: '기타',
    } as Record<FailureType, string>,
    notesLabel: '메모 / 실패 내용 (선택)',
    notesPlaceholder: '예: 12층이 베드에서 떨어짐, 모서리 뒤틀림…',
    save: '결과 저장',
    saving: '저장 중…',
    saved: '로컬 기록에 저장했습니다',
    saveError: '저장 실패 — 결과가 기록되지 않았습니다.',
    loadError: '이 실행에 대한 분석 기록이 없습니다 — 결과를 기록할 수 없습니다.',
    noRecord: '이 실행에 연결된 분석 기록이 없어 결과를 기록할 수 없습니다. 업로드 흐름에서 분석을 다시 실행하세요.',
    loading: '기록 불러오는 중…',
    recordedAt: '기록 시각',
    localNote: '이 브라우저에만 저장됨',
  },
  de: {
    title: 'DRUCKERGEBNIS',
    observed: '[GEMESSEN]',
    caption: 'Was tatsächlich auf dem Drucker passiert ist. Die Bewertungen oben sind Prognosen — hier wird das gemessene Ergebnis erfasst, das sie prüft.',
    legend: 'Gemessenes Ergebnis',
    statuses: {
      success: 'Erfolgreich gedruckt',
      partial: 'Teilweise — Nacharbeit nötig',
      failure: 'Druck fehlgeschlagen',
      unknown: 'Unbekannt',
      not_tested: 'Nicht geprüft',
    } as Record<OutcomeStatus, string>,
    predicted: 'Prognostizierte Bewertung',
    failureDetails: 'Fehlerdetails (optional)',
    failureLayerLabel: 'Fehlerhafte Schicht',
    failureLayerPlaceholder: 'z. B. 12',
    failureTypeLabel: 'Fehlerart',
    failureTypeNone: 'Nicht angegeben',
    failureTypes: {
      warping: 'Verzug',
      layer_adhesion: 'Schichthaftung',
      layer_shift: 'Schichtversatz',
      stringing: 'Fäden',
      under_extrusion: 'Unterextrusion',
      over_extrusion: 'Überextrusion',
      clog: 'Verstopfung',
      dimensional_accuracy: 'Maßhaltigkeit',
      surface_finish: 'Oberfläche',
      other: 'Sonstiges',
    } as Record<FailureType, string>,
    notesLabel: 'Notizen / Fehlerbeschreibung (optional)',
    notesPlaceholder: 'z. B. Schicht 12 vom Bett gelöst, Ecke verzogen…',
    save: 'ERGEBNIS SPEICHERN',
    saving: 'SPEICHERN…',
    saved: 'Im lokalen Verlauf gespeichert',
    saveError: 'Speichern fehlgeschlagen — Ergebnis NICHT erfasst.',
    loadError: 'Kein Analysedatensatz für diesen Lauf — Ergebnis nicht erfassbar.',
    noRecord: 'Kein verknüpfter Analysedatensatz für diesen Lauf — Ergebnis kann nicht erfasst werden. Analyse im Upload-Ablauf erneut starten.',
    loading: 'Datensatz wird geladen…',
    recordedAt: 'Erfasst',
    localNote: 'Nur in diesem Browser gespeichert',
  },
  es: {
    title: 'RESULTADO DE IMPRESIÓN',
    observed: '[MEDIDO]',
    caption: 'Lo que realmente ocurrió en la impresora. Las puntuaciones de arriba son predicciones — aquí se registra el resultado medido que las verifica.',
    legend: 'Resultado medido',
    statuses: {
      success: 'Impresión correcta',
      partial: 'Parcial — requiere retrabajo',
      failure: 'Impresión fallida',
      unknown: 'Desconocido',
      not_tested: 'Sin probar',
    } as Record<OutcomeStatus, string>,
    predicted: 'Puntuación prevista',
    failureDetails: 'Detalles del fallo (opcional)',
    failureLayerLabel: 'Capa fallida',
    failureLayerPlaceholder: 'p. ej. 12',
    failureTypeLabel: 'Tipo de fallo',
    failureTypeNone: 'Sin especificar',
    failureTypes: {
      warping: 'Alabeo',
      layer_adhesion: 'Adhesión entre capas',
      layer_shift: 'Desplazamiento de capa',
      stringing: 'Hilos',
      under_extrusion: 'Subextrusión',
      over_extrusion: 'Sobreextrusión',
      clog: 'Atasco',
      dimensional_accuracy: 'Precisión dimensional',
      surface_finish: 'Acabado superficial',
      other: 'Otro',
    } as Record<FailureType, string>,
    notesLabel: 'Notas / descripción del fallo (opcional)',
    notesPlaceholder: 'p. ej. la capa 12 se despegó de la cama, esquina alabeada…',
    save: 'GUARDAR RESULTADO',
    saving: 'GUARDANDO…',
    saved: 'Guardado en el historial local',
    saveError: 'Error al guardar — resultado NO registrado.',
    loadError: 'No hay registro de análisis para esta ejecución — no se puede registrar el resultado.',
    noRecord: 'No hay registro de análisis vinculado a esta ejecución — no se puede registrar el resultado. Vuelve a ejecutar el análisis desde el flujo de carga.',
    loading: 'Cargando registro…',
    recordedAt: 'Registrado',
    localNote: 'Guardado solo en este navegador',
  },
  fr: {
    title: "RÉSULTAT D'IMPRESSION",
    observed: '[MESURÉ]',
    caption: "Ce qui s'est réellement passé sur l'imprimante. Les scores ci-dessus sont des prédictions — cette entrée consigne le résultat mesuré qui les vérifie.",
    legend: 'Résultat mesuré',
    statuses: {
      success: 'Impression réussie',
      partial: 'Partielle — retouche nécessaire',
      failure: 'Impression échouée',
      unknown: 'Inconnu',
      not_tested: 'Non testée',
    } as Record<OutcomeStatus, string>,
    predicted: 'Score prédit',
    failureDetails: "Détails de l'échec (facultatif)",
    failureLayerLabel: 'Couche en échec',
    failureLayerPlaceholder: 'ex. 12',
    failureTypeLabel: "Type d'échec",
    failureTypeNone: 'Non précisé',
    failureTypes: {
      warping: 'Gauchissement',
      layer_adhesion: 'Adhérence entre couches',
      layer_shift: 'Décalage de couche',
      stringing: 'Filaments',
      under_extrusion: 'Sous-extrusion',
      over_extrusion: 'Sur-extrusion',
      clog: 'Bouchage',
      dimensional_accuracy: 'Précision dimensionnelle',
      surface_finish: 'État de surface',
      other: 'Autre',
    } as Record<FailureType, string>,
    notesLabel: "Notes / description de l'échec (facultatif)",
    notesPlaceholder: 'ex. couche 12 décollée du plateau, coin gauchi…',
    save: 'ENREGISTRER LE RÉSULTAT',
    saving: 'ENREGISTREMENT…',
    saved: "Enregistré dans l'historique local",
    saveError: "Échec de l'enregistrement — résultat NON consigné.",
    loadError: "Aucun enregistrement d'analyse pour cette exécution — résultat non consignable.",
    noRecord: "Aucun enregistrement d'analyse lié à cette exécution — le résultat ne peut pas être consigné. Relancez l'analyse depuis le flux de téléversement.",
    loading: "Chargement de l'enregistrement…",
    recordedAt: 'Enregistré',
    localNote: 'Stocké dans ce navigateur uniquement',
  },
  it: {
    title: 'ESITO DI STAMPA',
    observed: '[MISURATO]',
    caption: "Ciò che è realmente accaduto sulla stampante. I punteggi sopra sono previsioni — qui viene registrato l'esito misurato che le verifica.",
    legend: 'Esito misurato',
    statuses: {
      success: 'Stampa riuscita',
      partial: 'Parziale — serve rilavorazione',
      failure: 'Stampa fallita',
      unknown: 'Sconosciuto',
      not_tested: 'Non testato',
    } as Record<OutcomeStatus, string>,
    predicted: 'Punteggio previsto',
    failureDetails: 'Dettagli del guasto (facoltativo)',
    failureLayerLabel: 'Strato fallito',
    failureLayerPlaceholder: 'es. 12',
    failureTypeLabel: 'Tipo di guasto',
    failureTypeNone: 'Non specificato',
    failureTypes: {
      warping: 'Distorsione',
      layer_adhesion: 'Adesione tra strati',
      layer_shift: 'Disallineamento strato',
      stringing: 'Fili',
      under_extrusion: 'Sotto-estrusione',
      over_extrusion: 'Sovra-estrusione',
      clog: 'Ostruzione',
      dimensional_accuracy: 'Precisione dimensionale',
      surface_finish: 'Finitura superficiale',
      other: 'Altro',
    } as Record<FailureType, string>,
    notesLabel: 'Note / descrizione del guasto (facoltativo)',
    notesPlaceholder: 'es. strato 12 staccato dal piano, angolo deformato…',
    save: 'SALVA ESITO',
    saving: 'SALVATAGGIO…',
    saved: 'Salvato nella cronologia locale',
    saveError: 'Salvataggio fallito — esito NON registrato.',
    loadError: 'Nessun record di analisi per questa esecuzione — esito non registrabile.',
    noRecord: "Nessun record di analisi collegato a questa esecuzione — impossibile registrare l'esito. Riesegui l'analisi dal flusso di caricamento.",
    loading: 'Caricamento record…',
    recordedAt: 'Registrato',
    localNote: 'Salvato solo in questo browser',
  },
  sv: {
    title: 'UTSKRIFTSRESULTAT',
    observed: '[UPMÄTT]',
    caption: 'Vad som faktiskt hände i skrivaren. Poängen ovan är prognoser — här registreras det uppmätta resultatet som verifierar dem.',
    legend: 'Uppmätt resultat',
    statuses: {
      success: 'Lyckad utskrift',
      partial: 'Delvis — efterarbete krävs',
      failure: 'Misslyckad utskrift',
      unknown: 'Okänt',
      not_tested: 'Ej testad',
    } as Record<OutcomeStatus, string>,
    predicted: 'Prognostiserad poäng',
    failureDetails: 'Felinformation (valfritt)',
    failureLayerLabel: 'Misslyckat lager',
    failureLayerPlaceholder: 't.ex. 12',
    failureTypeLabel: 'Feltyp',
    failureTypeNone: 'Ej angivet',
    failureTypes: {
      warping: 'Skevhet',
      layer_adhesion: 'Lagerhäftning',
      layer_shift: 'Lagerförskjutning',
      stringing: 'Trådar',
      under_extrusion: 'Underextrudering',
      over_extrusion: 'Överextrudering',
      clog: 'Tilltäppning',
      dimensional_accuracy: 'Måttnoggrannhet',
      surface_finish: 'Ytfinhet',
      other: 'Övrigt',
    } as Record<FailureType, string>,
    notesLabel: 'Anteckningar / felbeskrivning (valfritt)',
    notesPlaceholder: 't.ex. lager 12 släppte från bädden, hörn skeva…',
    save: 'SPARA RESULTAT',
    saving: 'SPARAR…',
    saved: 'Sparat i lokal historik',
    saveError: 'Sparandet misslyckades — resultatet registrerades INTE.',
    loadError: 'Ingen analyspost för denna körning — resultatet kan inte registreras.',
    noRecord: 'Ingen kopplad analyspost för denna körning — resultatet kan inte registreras. Kör om analysen från uppladdningsflödet.',
    loading: 'Läser in post…',
    recordedAt: 'Registrerat',
    localNote: 'Endast sparat i den här webbläsaren',
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
  const t = pickLang(L, language);
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
