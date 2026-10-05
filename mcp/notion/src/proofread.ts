/**
 * Deterministic business-tone proofreader for handoff texts (JA/EN/ZH).
 * No LLM, no network — pure rules, so results are stable and testable.
 */

export interface Finding {
  rule: string;
  severity: 'fix' | 'warn';
  before: string;
  after: string;
  why: string;
}

export interface ProofreadResult {
  lang: 'ja' | 'en' | 'zh';
  findings: Finding[];
  fixed: string;
}

type Rule = {
  id: string;
  severity: 'fix' | 'warn';
  why: string;
  apply: (text: string, out: Finding[]) => string;
};

const JA_RULES: Rule[] = [
  {
    id: 'ja-zoukei',
    severity: 'fix',
    why: 'AM業界では「印刷」ではなく「造形」が正式用語。見積書で印刷と言うと素人扱いされる。',
    apply: (t, out) => {
      const hits = ['印刷リスク', '印刷失敗', '印刷時間', 'プリント分析', 'プリント性'];
      let r = t;
      const map: Array<[RegExp, string]> = [
        [/印刷リスク/g, '造形リスク'],
        [/印刷失敗/g, '造形失敗'],
        [/印刷時間/g, '造形時間'],
      ];
      for (const [re, to] of map) {
        if (re.test(r)) {
          out.push({ rule: 'ja-zoukei', severity: 'fix', before: re.source, after: to, why: 'AM正式用語は造形' });
          r = r.replace(re, to);
        }
      }
      void hits;
      return r;
    },
  },
  {
    id: 'ja-desumasu',
    severity: 'warn',
    why: '見積文はですます調に統一。言い切りと混ざると信用が落ちる。',
    apply: (t, out) => {
      if (/算出不可。[^す]*$/m.test(t) && !/ください/.test(t)) {
        out.push({ rule: 'ja-desumasu', severity: 'warn', before: '(文末)', after: 'ください調に統一', why: 'ですます統一' });
      }
      return t;
    },
  },
  {
    id: 'ja-hoshou',
    severity: 'warn',
    why: '「保証」「絶対」は無条件に書くと後で揉める。範囲を添える。',
    apply: (t, out) => {
      for (const w of ['保証します', '絶対']) {
        if (t.includes(w)) {
          out.push({ rule: 'ja-hoshou', severity: 'warn', before: w, after: w + '(+範囲を明記)', why: '無条件の保証はNG' });
        }
      }
      return t;
    },
  },
  {
    id: 'ja-zero',
    severity: 'fix',
    why: '0–0g / $0.00 は未計算の表示漏れ。「—」にしないと客に嘘になる。',
    apply: (t, out) => {
      let r = t;
      for (const pat of ['0–0g', '0-0g', '$0.00', '0h 0m – 0h 0m']) {
        if (r.includes(pat)) {
          out.push({ rule: 'ja-zero', severity: 'fix', before: pat, after: '—', why: '未計算は—表示' });
          r = r.replaceAll(pat, '—');
        }
      }
      return r;
    },
  },
];

const EN_RULES: Rule[] = [
  {
    id: 'en-zero',
    severity: 'fix',
    why: 'Zero estimates mean "not computed" — never show 0–0g / $0.00 to a client.',
    apply: (t, out) => {
      let r = t;
      for (const pat of ['0–0g', '0-0g', '$0.00']) {
        if (r.includes(pat)) {
          out.push({ rule: 'en-zero', severity: 'fix', before: pat, after: '—', why: 'uncomputed → —' });
          r = r.replaceAll(pat, '—');
        }
      }
      return r;
    },
  },
  {
    id: 'en-guarantee',
    severity: 'warn',
    why: 'Bare "guarantee" without scope causes disputes. Attach the scope.',
    apply: (t, out) => {
      if (/\bguarantee\b/i.test(t) && !/within|scope|except/i.test(t)) {
        out.push({ rule: 'en-guarantee', severity: 'warn', before: 'guarantee', after: 'guarantee (+scope)', why: 'scope required' });
      }
      return t;
    },
  },
];

const ZH_RULES: Rule[] = [
  {
    id: 'zh-zero',
    severity: 'fix',
    why: '0类数字表示未计算，必须显示—，否则就是给客户看假数。',
    apply: (t, out) => {
      let r = t;
      for (const pat of ['0–0g', '0-0g', '$0.00', '0h0m']) {
        if (r.includes(pat)) {
          out.push({ rule: 'zh-zero', severity: 'fix', before: pat, after: '—', why: '未计算→—' });
          r = r.replaceAll(pat, '—');
        }
      }
      return r;
    },
  },
];

export function proofread(text: string, lang: 'ja' | 'en' | 'zh'): ProofreadResult {
  const rules = lang === 'ja' ? JA_RULES : lang === 'en' ? EN_RULES : ZH_RULES;
  const findings: Finding[] = [];
  let fixed = text;
  for (const r of rules) fixed = r.apply(fixed, findings);
  return { lang, findings, fixed };
}
