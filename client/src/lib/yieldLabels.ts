/**
 * Yield panel localisation tables.
 *
 * Labels used to live as Chinese-only constants inside yieldView.ts, which is
 * why switching the language still showed Chinese: the panel never consulted
 * the selector. Every string the panel renders now comes from here, keyed by
 * language, with English as the fallback for languages still being filled in.
 */
import type { CalibrationMethod } from '@shared/domain/fieldCalibration';
import type { EvidenceGrade } from '@shared/domain/evidence';
import type { AxisClaim } from '@shared/domain/fieldOverlay';
import type { FailureCause, OutcomeClass } from '@shared/domain/yieldAttribution';
import type { ContentLang, PartialLangDict } from '@shared/i18n/content';
import { pickLang } from '@shared/i18n/content';

export const OUTCOME_LABELS: PartialLangDict<Record<OutcomeClass, string>> = {
  en: {
    'true-pass': 'Passed and good',
    'false-pass': 'Passed, then scrapped',
    'unverified-block': 'Blocked before printing',
    'false-block': 'Blocked but would have passed',
    'override-failed': 'Override, then scrapped',
    unexercised: 'No verdict recorded',
    'inconclusive-outcome': 'Inconclusive outcome',
  },
  ja: {
    'true-pass': '判定合格・良品',
    'false-pass': '判定合格だが不良',
    'unverified-block': '上機前に遮断',
    'false-block': '遮断だが成功見込み',
    'override-failed': '強行通過後に不良',
    unexercised: '判定記録なし',
    'inconclusive-outcome': '判定不能',
  },
  zh: {
    'true-pass': '判定通过且合格',
    'false-pass': '判定通过却报废',
    'unverified-block': '被拦截未上机',
    'false-block': '拦截但本可成功',
    'override-failed': '强行放行后报废',
    unexercised: '无判定记录',
    'inconclusive-outcome': '判定不确定',
  },
  ko: {
    'true-pass': '판정 통과·양품',
    'false-pass': '판정 통과·폐기',
    'unverified-block': '상기 전 차단',
    'false-block': '차단됐지만 성공 가능',
    'override-failed': '강제 통과 후 폐기',
    unexercised: '판정 기록 없음',
    'inconclusive-outcome': '판정 불가',
  },
  de: {
    'true-pass': 'Freigegeben und gut',
    'false-pass': 'Freigegeben, dann Ausschuss',
    'unverified-block': 'Vor dem Druck blockiert',
    'false-block': 'Blockiert, wäre aber gut',
    'override-failed': 'Übersteuert, dann Ausschuss',
    unexercised: 'Kein Urteil erfasst',
    'inconclusive-outcome': 'Urteil nicht eindeutig',
  },
  es: {
    'true-pass': 'Aprobado y correcto',
    'false-pass': 'Aprobado y desechado',
    'unverified-block': 'Bloqueado antes de imprimir',
    'false-block': 'Bloqueado pero habría salido bien',
    'override-failed': 'Forzado y desechado',
    unexercised: 'Sin veredicto registrado',
    'inconclusive-outcome': 'Resultado no concluyente',
  },
  fr: {
    'true-pass': 'Validé et conforme',
    'false-pass': 'Validé puis rebuté',
    'unverified-block': 'Bloqué avant impression',
    'false-block': 'Bloqué mais aurait réussi',
    'override-failed': 'Forcé puis rebuté',
    unexercised: 'Aucun verdict enregistré',
    'inconclusive-outcome': 'Verdict non concluant',
  },
  it: {
    'true-pass': 'Approvato e conforme',
    'false-pass': 'Approvato ma scartato',
    'unverified-block': 'Bloccato prima della stampa',
    'false-block': 'Bloccato ma sarebbe riuscito',
    'override-failed': 'Forzato e scartato',
    unexercised: 'Nessun verdetto registrato',
    'inconclusive-outcome': 'Esito non conclusivo',
  },
  sv: {
    'true-pass': 'Godkänd och felfri',
    'false-pass': 'Godkänd men kasserad',
    'unverified-block': 'Blockerad före utskrift',
    'false-block': 'Blockerad men hade gått igenom',
    'override-failed': 'Tvingad igenom, sedan kasserad',
    unexercised: 'Inget utfall registrerat',
    'inconclusive-outcome': 'Utfall oklart',
  },
};

export const CAUSE_LABELS: PartialLangDict<Record<FailureCause, string>> = {
  en: {
    material: 'Material',
    machine: 'Machine',
    params: 'Process parameters',
    model: 'Model',
    operator: 'Operator',
    'post-process': 'Post-processing',
    design: 'Design',
    unknown: 'Unknown',
  },
  ja: {
    material: '材料',
    machine: '装置',
    params: 'プロセス条件',
    model: 'モデル',
    operator: '作業者',
    'post-process': '後処理',
    design: '設計',
    unknown: '未特定',
  },
  zh: {
    material: '材料',
    machine: '机器',
    params: '工艺参数',
    model: '模型',
    operator: '操作',
    'post-process': '后处理',
    design: '设计',
    unknown: '未查明',
  },
  ko: {
    material: '재료',
    machine: '장비',
    params: '공정 파라미터',
    model: '모델',
    operator: '작업자',
    'post-process': '후처리',
    design: '설계',
    unknown: '미확인',
  },
  de: {
    material: 'Material',
    machine: 'Maschine',
    params: 'Prozessparameter',
    model: 'Modell',
    operator: 'Bediener',
    'post-process': 'Nachbearbeitung',
    design: 'Konstruktion',
    unknown: 'Unbekannt',
  },
  es: {
    material: 'Material',
    machine: 'Máquina',
    params: 'Parámetros de proceso',
    model: 'Modelo',
    operator: 'Operario',
    'post-process': 'Postprocesado',
    design: 'Diseño',
    unknown: 'Sin determinar',
  },
  fr: {
    material: 'Matière',
    machine: 'Machine',
    params: 'Paramètres procédé',
    model: 'Modèle',
    operator: 'Opérateur',
    'post-process': 'Post-traitement',
    design: 'Conception',
    unknown: 'Indéterminé',
  },
  it: {
    material: 'Materiale',
    machine: 'Macchina',
    params: 'Parametri di processo',
    model: 'Modello',
    operator: 'Operatore',
    'post-process': 'Post-processo',
    design: 'Progettazione',
    unknown: 'Non determinato',
  },
  sv: {
    material: 'Material',
    machine: 'Maskin',
    params: 'Processparametrar',
    model: 'Modell',
    operator: 'Operatör',
    'post-process': 'Efterbearbetning',
    design: 'Konstruktion',
    unknown: 'Okänd',
  },
};

export const METHOD_LABELS: PartialLangDict<Record<CalibrationMethod, string>> = {
  en: {
    thermocouple: 'Thermocouple reading',
    'part-measurement': 'Part measurement',
    'slicer-log': 'Slicer log',
    'operator-note': 'Operator note',
  },
  ja: {
    thermocouple: '熱電対の実測',
    'part-measurement': '部品の実測',
    'slicer-log': 'スライサーログ',
    'operator-note': '作業者メモ',
  },
  zh: {
    thermocouple: '热电偶实测',
    'part-measurement': '零件实测',
    'slicer-log': '切片日志',
    'operator-note': '操作员记录',
  },
  ko: {
    thermocouple: '열전대 실측',
    'part-measurement': '부품 실측',
    'slicer-log': '슬라이서 로그',
    'operator-note': '작업자 기록',
  },
  de: {
    thermocouple: 'Thermoelement-Messung',
    'part-measurement': 'Bauteilmessung',
    'slicer-log': 'Slicer-Protokoll',
    'operator-note': 'Bedienernotiz',
  },
  es: {
    thermocouple: 'Medición con termopar',
    'part-measurement': 'Medición de la pieza',
    'slicer-log': 'Registro del slicer',
    'operator-note': 'Nota del operario',
  },
  fr: {
    thermocouple: 'Mesure par thermocouple',
    'part-measurement': 'Mesure sur pièce',
    'slicer-log': 'Journal du slicer',
    'operator-note': 'Note opérateur',
  },
  it: {
    thermocouple: 'Misura con termocoppia',
    'part-measurement': 'Misura sul pezzo',
    'slicer-log': 'Log dello slicer',
    'operator-note': 'Nota operatore',
  },
  sv: {
    thermocouple: 'Mätning med termoelement',
    'part-measurement': 'Mätning på detalj',
    'slicer-log': 'Slicer-logg',
    'operator-note': 'Operatörsanteckning',
  },
};

export const GRADE_LABELS: PartialLangDict<Record<EvidenceGrade, string>> = {
  en: {
    unverified: 'Unverified',
    'vendor-sheet': 'Vendor sheet',
    'two-source': 'Two sources',
    'field-calibrated': 'Field calibrated',
  },
  ja: {
    unverified: '未検証',
    'vendor-sheet': 'メーカー公称',
    'two-source': '二系統の出所',
    'field-calibrated': '現場校正',
  },
  zh: {
    unverified: '未验证',
    'vendor-sheet': '厂商标称',
    'two-source': '双来源',
    'field-calibrated': '现场标定',
  },
  ko: {
    unverified: '미검증',
    'vendor-sheet': '제조사 표기',
    'two-source': '이중 출처',
    'field-calibrated': '현장 교정',
  },
  de: {
    unverified: 'Unbestätigt',
    'vendor-sheet': 'Herstellerangabe',
    'two-source': 'Zwei Quellen',
    'field-calibrated': 'Feldkalibriert',
  },
  es: {
    unverified: 'Sin verificar',
    'vendor-sheet': 'Ficha del fabricante',
    'two-source': 'Dos fuentes',
    'field-calibrated': 'Calibrado en campo',
  },
  fr: {
    unverified: 'Non vérifié',
    'vendor-sheet': 'Fiche fabricant',
    'two-source': 'Deux sources',
    'field-calibrated': 'Calibré sur site',
  },
  it: {
    unverified: 'Non verificato',
    'vendor-sheet': 'Scheda fornitore',
    'two-source': 'Due fonti',
    'field-calibrated': 'Calibrato sul campo',
  },
  sv: {
    unverified: 'Overifierad',
    'vendor-sheet': 'Tillverkaruppgift',
    'two-source': 'Två källor',
    'field-calibrated': 'Fältkalibrerad',
  },
};

export const APPLICABILITY_LABELS: PartialLangDict<Record<AxisClaim['applicability'], string>> = {
  en: { stated: 'Stated', absent: 'Not offered', unknown: 'Unknown' },
  ja: { stated: '公称あり', absent: '該当なし', unknown: '不明' },
  zh: { stated: '已标称', absent: '无此能力', unknown: '未知' },
  ko: { stated: '표기됨', absent: '해당 없음', unknown: '알 수 없음' },
  de: { stated: 'Angegeben', absent: 'Nicht vorhanden', unknown: 'Unbekannt' },
  es: { stated: 'Declarado', absent: 'No disponible', unknown: 'Desconocido' },
  fr: { stated: 'Déclaré', absent: 'Non proposé', unknown: 'Inconnu' },
  it: { stated: 'Dichiarato', absent: 'Non disponibile', unknown: 'Non noto' },
  sv: { stated: 'Angiven', absent: 'Saknas', unknown: 'Okänd' },
};

export type YieldLabels = {
  outcome: Record<OutcomeClass, string>;
  cause: Record<FailureCause, string>;
  method: Record<CalibrationMethod, string>;
  grade: Record<EvidenceGrade, string>;
  applicability: Record<AxisClaim['applicability'], string>;
};

export function yieldLabels(lang: ContentLang): YieldLabels {
  return {
    outcome: pickLang(OUTCOME_LABELS, lang),
    cause: pickLang(CAUSE_LABELS, lang),
    method: pickLang(METHOD_LABELS, lang),
    grade: pickLang(GRADE_LABELS, lang),
    applicability: pickLang(APPLICABILITY_LABELS, lang),
  };
}

/** Sentence templates the view layer fills in. Kept separate from the tags above. */
export type YieldSentences = {
  samplesOne: (units: number) => string;
  samplesMany: (samples: number, units: number) => string;
  contradiction: (observed: number, ceiling: number) => string;
  verdict: (state: string, policy: string) => string;
  noVerdict: string;
  exclusionStamped: (n: number, versions: string) => string;
  exclusionUnstamped: (n: number) => string;
  exclusionPrefix: (body: string) => string;
  separator: string;
};

export const YIELD_SENTENCES: PartialLangDict<YieldSentences> = {
  en: {
    samplesOne: (units) => `${units} units sampled`,
    samplesMany: (samples, units) => `${samples} samples · ${units} units`,
    contradiction: (observed, ceiling) => `Field reading ${observed} exceeds vendor ceiling ${ceiling}`,
    verdict: (state, policy) => `Verdict ${state} · policy ${policy}`,
    noVerdict: 'No verdict recorded',
    exclusionStamped: (n, versions) => `${n} under an older policy (${versions})`,
    exclusionUnstamped: (n) => `${n} without a policy version`,
    exclusionPrefix: (body) => `Plus ${body} — not counted`,
    separator: '; plus ',
  },
  ja: {
    samplesOne: (units) => `サンプル ${units} 台`,
    samplesMany: (samples, units) => `サンプル ${samples} · ${units} 台`,
    contradiction: (observed, ceiling) => `現場値 ${observed} がメーカー上限 ${ceiling} を超過`,
    verdict: (state, policy) => `判定 ${state} · ポリシー ${policy}`,
    noVerdict: '判定記録なし',
    exclusionStamped: (n, versions) => `${n} 件は旧ポリシー（${versions}）`,
    exclusionUnstamped: (n) => `${n} 件はポリシー版の記載なし`,
    exclusionPrefix: (body) => `他に ${body} は集計外`,
    separator: '、他に ',
  },
  zh: {
    samplesOne: (units) => `样本 ${units} 台`,
    samplesMany: (samples, units) => `样本 ${samples} · ${units} 台`,
    contradiction: (observed, ceiling) => `现场读数 ${observed} 已超厂商上限 ${ceiling}`,
    verdict: (state, policy) => `判定 ${state} · 策略 ${policy}`,
    noVerdict: '无判定记录',
    exclusionStamped: (n, versions) => `${n} 条属旧策略（${versions}）`,
    exclusionUnstamped: (n) => `${n} 条未标注策略版本`,
    exclusionPrefix: (body) => `另有 ${body} 未计入`,
    separator: '；另有 ',
  },
  ko: {
    samplesOne: (units) => `샘플 ${units}대`,
    samplesMany: (samples, units) => `샘플 ${samples} · ${units}대`,
    contradiction: (observed, ceiling) => `현장 측정값 ${observed}이(가) 제조사 상한 ${ceiling}을(를) 초과`,
    verdict: (state, policy) => `판정 ${state} · 정책 ${policy}`,
    noVerdict: '판정 기록 없음',
    exclusionStamped: (n, versions) => `${n}건은 이전 정책(${versions})`,
    exclusionUnstamped: (n) => `${n}건은 정책 버전 미표기`,
    exclusionPrefix: (body) => `추가로 ${body}은(는) 미집계`,
    separator: '; 추가로 ',
  },
  de: {
    samplesOne: (units) => `${units} Einheiten beprobt`,
    samplesMany: (samples, units) => `${samples} Stichproben · ${units} Einheiten`,
    contradiction: (observed, ceiling) => `Feldwert ${observed} über Herstellerobergrenze ${ceiling}`,
    verdict: (state, policy) => `Urteil ${state} · Richtlinie ${policy}`,
    noVerdict: 'Kein Urteil erfasst',
    exclusionStamped: (n, versions) => `${n} nach älterer Richtlinie (${versions})`,
    exclusionUnstamped: (n) => `${n} ohne Richtlinienversion`,
    exclusionPrefix: (body) => `Zusätzlich ${body} — nicht gezählt`,
    separator: '; zusätzlich ',
  },
  es: {
    samplesOne: (units) => `${units} unidades muestreadas`,
    samplesMany: (samples, units) => `${samples} muestras · ${units} unidades`,
    contradiction: (observed, ceiling) => `La lectura en campo ${observed} supera el límite del fabricante ${ceiling}`,
    verdict: (state, policy) => `Veredicto ${state} · política ${policy}`,
    noVerdict: 'Sin veredicto registrado',
    exclusionStamped: (n, versions) => `${n} con política anterior (${versions})`,
    exclusionUnstamped: (n) => `${n} sin versión de política`,
    exclusionPrefix: (body) => `Además ${body} — no contabilizado`,
    separator: '; además ',
  },
  fr: {
    samplesOne: (units) => `${units} unités échantillonnées`,
    samplesMany: (samples, units) => `${samples} échantillons · ${units} unités`,
    contradiction: (observed, ceiling) => `La mesure terrain ${observed} dépasse le plafond fabricant ${ceiling}`,
    verdict: (state, policy) => `Verdict ${state} · politique ${policy}`,
    noVerdict: 'Aucun verdict enregistré',
    exclusionStamped: (n, versions) => `${n} sous une politique antérieure (${versions})`,
    exclusionUnstamped: (n) => `${n} sans version de politique`,
    exclusionPrefix: (body) => `En plus ${body} — non compté`,
    separator: ' ; en plus ',
  },
  it: {
    samplesOne: (units) => `${units} unità campionate`,
    samplesMany: (samples, units) => `${samples} campioni · ${units} unità`,
    contradiction: (observed, ceiling) => `La lettura in campo ${observed} supera il limite del fornitore ${ceiling}`,
    verdict: (state, policy) => `Verdetto ${state} · policy ${policy}`,
    noVerdict: 'Nessun verdetto registrato',
    exclusionStamped: (n, versions) => `${n} con policy precedente (${versions})`,
    exclusionUnstamped: (n) => `${n} senza versione di policy`,
    exclusionPrefix: (body) => `Inoltre ${body} — non conteggiato`,
    separator: '; inoltre ',
  },
  sv: {
    samplesOne: (units) => `${units} enheter provtagna`,
    samplesMany: (samples, units) => `${samples} prover · ${units} enheter`,
    contradiction: (observed, ceiling) => `Fältvärde ${observed} överstiger tillverkarens tak ${ceiling}`,
    verdict: (state, policy) => `Utfall ${state} · policy ${policy}`,
    noVerdict: 'Inget utfall registrerat',
    exclusionStamped: (n, versions) => `${n} enligt äldre policy (${versions})`,
    exclusionUnstamped: (n) => `${n} utan policyversion`,
    exclusionPrefix: (body) => `Dessutom ${body} — ej medräknat`,
    separator: '; dessutom ',
  },
};

export function yieldSentences(lang: ContentLang): YieldSentences {
  return pickLang(YIELD_SENTENCES, lang);
}
