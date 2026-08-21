// client/src/lib/failureDiagnosis.ts
//
// Print-failure diagnosis — the "after the fact" half of the agent loop.
// The user uploads a photo of a FAILED print; a vision-capable model (Kimi k3,
// hosted server-side for signed-in users) identifies the likely failure
// mode(s) and gives causes + fixes. This complements the model-analysis half
// (which answers "will this print?") with the real-world half ("why did it
// fail?").
//
// Honest limit: a photo can only show surface symptoms. The model returns the
// most likely modes with probabilities, not a certainty.

import { callLLMProxy } from './llmProxy';
import { getTranslation, type Language } from '@/lib/i18n';

export interface FailureMode {
  mode: string;
  /** 0..1 how likely this is the cause. */
  probability: number;
  causes: string[];
  fixes: string[];
}

export interface FailureDiagnosis {
  /** Plain-language overall diagnosis. */
  overallAssessment: string;
  failureModes: FailureMode[];
  /** 0..1 confidence in the diagnosis. */
  confidence: number;
}

export const DIAGNOSE_PROVIDER = 'kimi' as const;

function stripDataUrlPrefix(base64: string): string {
  return base64.replace(/^data:image\/\w+;base64,/, '');
}

export function buildDiagnosisPrompt(materialContext?: string): string {
  const context = materialContext
    ? `\nThe part was printed in: ${materialContext}\n`
    : '';
  return `You are a senior 3D printing failure diagnostician. Look at this photo of a FAILED 3D print and diagnose it.${context}

Respond in JSON only, no markdown fences:
{
  "overallAssessment": "2-3 plain-language sentences explaining the main problem",
  "failureModes": [
    { "mode": "warping", "probability": 0.8, "causes": ["uneven cooling", "poor bed adhesion"], "fixes": ["raise bed temperature", "add a brim", "use an enclosure"] }
  ],
  "confidence": 0.0-1.0
}

Common failure modes to consider: warping, layer_shift, under_extrusion, over_extrusion, stringing, bed_adhesion, elephant_foot, z_banding, delamination, overhang_sagging, clogged_nozzle, first_layer_failure, other.
Give 1-3 most likely modes with a probability (the mode you are most sure of first). Only report what the photo actually shows — do not guess about hidden internals.`;
}

export function buildDiagnosisBody(imageBase64: string, prompt: string): Record<string, unknown> {
  const imageData = stripDataUrlPrefix(imageBase64);
  return {
    model: 'kimi-k3',
    max_tokens: 700,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageData}` } },
      ],
    }],
  };
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
}

/** Validate + normalize the model's raw JSON into a typed diagnosis. */
export function parseDiagnosis(raw: string): FailureDiagnosis | null {
  let content = raw;
  try {
    const parsed = JSON.parse(raw);
    content = parsed.choices?.[0]?.message?.content
      || parsed.content?.[0]?.text
      || raw;
  } catch { /* content stays as raw */ }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  const assessment = typeof obj.overallAssessment === 'string' && obj.overallAssessment.trim()
    ? obj.overallAssessment.trim()
    : '';
  if (!assessment) return null;

  const modes: FailureMode[] = Array.isArray(obj.failureModes)
    ? obj.failureModes
        .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
        .map((m) => ({
          mode: typeof m.mode === 'string' && m.mode.trim() ? m.mode : 'other',
          probability: asNumber(m.probability, 0.5),
          causes: asStringArray(m.causes),
          fixes: asStringArray(m.fixes),
        }))
        // Drop only genuinely empty entries (fell back to "other" with no content).
        .filter((m) => m.mode !== 'other' || m.causes.length + m.fixes.length > 0)
        .slice(0, 3)
    : [];

  return {
    overallAssessment: assessment,
    failureModes: modes,
    confidence: asNumber(obj.confidence, 0.5),
  };
}

export type DiagnoseError = 'auth' | 'not_configured' | 'quota' | 'failed';

export async function diagnosePrintFailure(
  imageBase64: string,
  opts: { materialContext?: string; language?: Language; signal?: AbortSignal } = {},
): Promise<{ diagnosis: FailureDiagnosis | null; error: DiagnoseError | null }> {
  const prompt = buildDiagnosisPrompt(opts.materialContext);
  const body = buildDiagnosisBody(imageBase64, prompt);
  try {
    const resp = await callLLMProxy(DIAGNOSE_PROVIDER, '', body, opts.signal);
    if (resp.status === 401) return { diagnosis: null, error: 'auth' };
    if (resp.status === 429) return { diagnosis: null, error: 'quota' };
    if (resp.status === 503) {
      const text = await resp.text().catch(() => '');
      return { diagnosis: null, error: text.includes('provider_not_configured') ? 'not_configured' : 'failed' };
    }
    if (!resp.ok) return { diagnosis: null, error: 'failed' };
    return { diagnosis: parseDiagnosis(await resp.text()), error: null };
  } catch {
    return { diagnosis: null, error: 'failed' };
  }
}

/** Human label for a failure mode, localized. */
export function failureModeLabel(mode: string, language: Language): string {
  const t = (k: keyof typeof import('@/lib/i18n').translations.en) => getTranslation(language, k);
  switch (mode) {
    case 'warping': return t('diagWarping');
    case 'layer_shift': return t('diagLayerShift');
    case 'under_extrusion': return t('diagUnderExtrusion');
    case 'over_extrusion': return t('diagOverExtrusion');
    case 'stringing': return t('diagStringing');
    case 'bed_adhesion': return t('diagBedAdhesion');
    case 'elephant_foot': return t('diagElephantFoot');
    case 'z_banding': return t('diagZBanding');
    case 'delamination': return t('diagDelamination');
    case 'overhang_sagging': return t('diagOverhangSagging');
    case 'clogged_nozzle': return t('diagCloggedNozzle');
    case 'first_layer_failure': return t('diagFirstLayer');
    default: return mode;
  }
}
