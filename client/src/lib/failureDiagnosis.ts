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
  /**
   * Alternatives explicitly considered and ruled out (or not) before the model
   * committed to a failure — e.g. intentional multi-part segmentation for
   * assembly, or a low-poly facet seam that could be misread as a crack.
   */
  ruledOutAlternatives: string[];
  /**
   * 0..1 confidence that a FAILURE actually occurred (vs. intentional design).
   * Kept separate from `confidence` so "I'm not sure this is even a failure"
   * and "I'm sure it failed but not which way" don't collapse into one number.
   */
  isFailure: number;
  failureModes: FailureMode[];
  /** 0..1 confidence in the specific failure mode, GIVEN a failure occurred. */
  confidence: number;
}

export const DIAGNOSE_PROVIDER = 'kimi' as const;

function stripDataUrlPrefix(base64: string): string {
  return base64.replace(/^data:image\/\w+;base64,/, '');
}

export function buildDiagnosisPrompt(materialContext?: string, geometryContext?: string): string {
  const lines = [
    'You are a senior 3D printing failure diagnostician. Look at this photo of a 3D print and decide whether it FAILED or is INTENTIONAL DESIGN.',
  ];
  if (geometryContext) lines.push(`\n${geometryContext}`);
  if (materialContext) lines.push(`\nThe part was printed in: ${materialContext}`);
  lines.push(`
CRITICAL — before committing to a failure diagnosis, actively consider and RULE OUT these alternatives (do not silently assume them away):

1. INTENTIONAL MULTI-PART SEGMENTATION FOR ASSEMBLY. A part is often printed as separate pieces that are assembled afterwards. Cues: consistent handwritten/printed labels or marks on each piece, cut lines/seams that follow planar or near-planar splits rather than stress patterns, pieces of comparable size/shape suggesting a systematic split plan rather than random fracture. If the uploaded 3D file already contains multiple bodies, that fact strongly supports intentional segmentation, NOT "broke apart".

2. PANEL / FACET SEAM vs TRUE INTERLAYER CRACK. On low-poly-faceted prints, straight seam lines are facet boundaries (they match the model's own geometry), not cracks. True delamination cracks are irregular, follow layer lines (horizontal bands), and show a color/texture change at the exposed inner layers.

Respond in JSON only, no markdown fences:
{
  "overallAssessment": "2-3 plain-language sentences",
  "ruledOutAlternatives": ["short sentence on whether segmentation-for-assembly was a better explanation, and why/why not", "short sentence on whether panel-seam was a better explanation, and why/why not"],
  "isFailure": 0.0-1.0,
  "failureModes": [
    { "mode": "warping", "probability": 0.8, "causes": ["..."], "fixes": ["..."] }
  ],
  "confidence": 0.0-1.0
}

- isFailure = how confident you are that a FAILURE actually occurred (vs. intentional design or a facet seam). If you cannot confidently rule out segmentation or a seam, LOWER isFailure and say so in ruledOutAlternatives.
- confidence = how confident you are in the specific failure mode, GIVEN a failure occurred.
- Common failure modes: warping, layer_shift, under_extrusion, over_extrusion, stringing, bed_adhesion, elephant_foot, z_banding, delamination, overhang_sagging, clogged_nozzle, first_layer_failure, other.
- Give 1-3 most likely modes (most sure first). Only report what the photo actually shows — do not guess about hidden internals.`);
  return lines.join('\n');
}

export function buildDiagnosisBody(imageBase64: string, prompt: string): Record<string, unknown> {
  const imageData = stripDataUrlPrefix(imageBase64);
  return {
    model: 'kimi-k3',
    // Kimi k3 is a reasoning model: it spends tokens on reasoning_content
    // before the answer lands in content. Give it room or content comes back
    // empty and the diagnosis parse fails.
    max_tokens: 2000,
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
    const msg = parsed.choices?.[0]?.message ?? {};
    // Kimi reasoning models may put the answer in reasoning_content when
    // content is empty — fall back to it.
    content = (typeof msg.content === 'string' && msg.content.trim())
      ? msg.content
      : (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim())
        ? msg.reasoning_content
        : (parsed.content?.[0]?.text ?? raw);
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

  const ruledOutAlternatives = asStringArray(obj.ruledOutAlternatives);

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
    ruledOutAlternatives,
    isFailure: asNumber(obj.isFailure, confidenceFallback(modes)),
    failureModes: modes,
    confidence: asNumber(obj.confidence, 0.5),
  };
}

/** When the model omits isFailure, derive a cautious default from the modes. */
function confidenceFallback(modes: FailureMode[]): number {
  if (modes.length === 0) return 0.3;
  return modes.reduce((a, m) => a + m.probability, 0) / modes.length;
}

export type DiagnoseError = 'auth' | 'not_configured' | 'quota' | 'timeout' | 'failed';

export async function diagnosePrintFailure(
  imageBase64: string,
  opts: { materialContext?: string; geometryContext?: string; language?: Language; signal?: AbortSignal } = {},
): Promise<{ diagnosis: FailureDiagnosis | null; error: DiagnoseError | null }> {
  const prompt = buildDiagnosisPrompt(opts.materialContext, opts.geometryContext);
  const body = buildDiagnosisBody(imageBase64, prompt);
  // Safety net: don't let the UI hang forever if the vision call stalls.
  const signal = opts.signal ?? AbortSignal.timeout(60_000);
  try {
    const resp = await callLLMProxy(DIAGNOSE_PROVIDER, '', body, signal);
    if (resp.status === 401) return { diagnosis: null, error: 'auth' };
    if (resp.status === 429) return { diagnosis: null, error: 'quota' };
    if (resp.status === 503) {
      const text = await resp.text().catch(() => '');
      return { diagnosis: null, error: text.includes('provider_not_configured') ? 'not_configured' : 'failed' };
    }
    if (!resp.ok) return { diagnosis: null, error: 'failed' };
    return { diagnosis: parseDiagnosis(await resp.text()), error: null };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    return { diagnosis: null, error: aborted ? 'timeout' : 'failed' };
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
