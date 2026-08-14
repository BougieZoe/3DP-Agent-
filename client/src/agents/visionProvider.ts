import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import type { AIProviderId } from '@shared/domain/providers';
import { callLLMProxy, CHAT_COMPLETION_MODELS, CLAUDE_MODEL, GEMINI_MODEL } from '@/lib/llmProxy';

export type VisionIssueCategory =
  | 'thin_wall'
  | 'overhang'
  | 'structural_damage'
  | 'deformation'
  | 'asymmetry'
  | 'missing_feature'
  | 'hole_or_void'
  | 'surface_artifact'
  | 'orientation'
  | 'other';

export interface VisionIssue {
  category: VisionIssueCategory;
  description: string;
}

export interface VisionAnalysisResult {
  qualitativeAssessment: string;
  observedIssues: VisionIssue[];
  confidence: number;
  rawResponse: string;
}

export class VisionProvider {
  private renderCanvas: HTMLCanvasElement | null = null;

  setRenderCanvas(canvas: HTMLCanvasElement | null) {
    this.renderCanvas = canvas;
  }

  async captureScene(): Promise<string | null> {
    if (!this.renderCanvas) return null;

    try {
      const dataUrl = this.renderCanvas.toDataURL('image/png');
      return dataUrl;
    } catch {
      return null;
    }
  }

  async analyzeWithAI(
    screenshotBase64: string,
    geometrySummary: string,
    apiConfig?: { provider: AIProviderId; apiKey: string },
    language?: ContentLang,
    signal?: AbortSignal,
  ): Promise<VisionAnalysisResult> {
    const lang = language ?? 'en';
    if (!apiConfig?.apiKey) {
      return this.fallbackLocalAnalysis(lang);
    }

    try {
      const prompt = this.buildVisionPrompt(geometrySummary, lang);

      if (apiConfig.provider === 'claude' || apiConfig.provider === 'openai'
        || apiConfig.provider === 'kimi' || apiConfig.provider === 'gemini') {
        return await this.callVisionAPI(apiConfig, screenshotBase64, prompt, lang, signal);
      }

      return this.fallbackLocalAnalysis(lang);
    } catch {
      return this.fallbackLocalAnalysis(lang);
    }
  }

  private buildVisionPrompt(geometrySummary: string, language: ContentLang): string {
    const langName = translate(CONTENT, 'prompt.languageName', language);
    const langInstr = translate(CONTENT, 'vision.langInstr', language, { language: langName });
    return `You are a 3D printing geometry analyst. Analyze this STL model render and geometry data.

Geometry Data:
${geometrySummary}

Examine the rendered image and geometry data. Respond in JSON format:
{
  "qualitativeAssessment": "Brief overall assessment of model quality",
  "observedIssues": [
    { "category": "deformation", "description": "Brief, evidence-based issue description" }
  ],
  "confidence": 0.0-1.0
}

Allowed categories: thin_wall, overhang, structural_damage, deformation, asymmetry, missing_feature, hole_or_void, surface_artifact, orientation, other.
Only report visible evidence. Do not infer hidden internal defects from a render. ${langInstr}`;
  }

  private async callVisionAPI(
    apiConfig: { provider: AIProviderId; apiKey: string },
    imageBase64: string,
    prompt: string,
    language: ContentLang,
    signal?: AbortSignal,
  ): Promise<VisionAnalysisResult> {
    const imageData = imageBase64.replace(/^data:image\/png;base64,/, '');
    // Every provider goes through the /api/llm relay (CORS-safe, same origin);
    // the provider-specific body is built here and forwarded verbatim.
    const resp = await callLLMProxy(
      apiConfig.provider,
      apiConfig.apiKey,
      this.buildVisionBody(apiConfig.provider, prompt, imageData),
      signal,
    );
    return this.parseVisionResponse(await resp.text(), language);
  }

  private buildVisionBody(provider: AIProviderId, prompt: string, imageData: string): Record<string, unknown> {
    if (provider === 'claude') {
      return {
        model: CLAUDE_MODEL,
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData } },
          ],
        }],
      };
    }
    if (provider === 'gemini') {
      return {
        model: GEMINI_MODEL,
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/png', data: imageData } },
          ],
        }],
      };
    }
    // OpenAI / Kimi use the chat-completions image_url shape.
    return {
      model: CHAT_COMPLETION_MODELS[provider] ?? 'gpt-4o',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageData}` } },
        ],
      }],
    };
  }

  private parseVisionResponse(responseText: string, language: ContentLang): VisionAnalysisResult {
    try {
      const parsed = JSON.parse(responseText);
      const content = parsed.choices?.[0]?.message?.content
        || parsed.content?.[0]?.text
        || parsed.candidates?.[0]?.content?.parts?.[0]?.text
        || responseText;

      let jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsedJson = JSON.parse(jsonMatch[0]);
        return {
          qualitativeAssessment: parsedJson.qualitativeAssessment || translate(CONTENT, 'vision.noAssessment', language),
          observedIssues: normalizeVisionIssues(parsedJson.observedIssues),
          confidence: typeof parsedJson.confidence === 'number'
            ? Math.max(0, Math.min(1, parsedJson.confidence))
            : 0.5,
          rawResponse: content,
        };
      }

      return {
        qualitativeAssessment: content.slice(0, 200),
        observedIssues: [],
        confidence: 0.5,
        rawResponse: content,
      };
    } catch {
      return this.fallbackLocalAnalysis(language);
    }
  }

  private fallbackLocalAnalysis(language: ContentLang = 'en'): VisionAnalysisResult {
    return {
      qualitativeAssessment: translate(CONTENT, 'vision.unavailable', language),
      observedIssues: [],
      confidence: 0,
      rawResponse: '',
    };
  }
}

const VISION_ISSUE_CATEGORIES = new Set<VisionIssueCategory>([
  'thin_wall', 'overhang', 'structural_damage', 'deformation', 'asymmetry',
  'missing_feature', 'hole_or_void', 'surface_artifact', 'orientation', 'other',
]);

/**
 * Normalizes model output at the trust boundary. String issues are accepted
 * only for backwards compatibility and intentionally become `other`, so they
 * cannot trigger a high-severity production risk through keyword matching.
 */
export function normalizeVisionIssues(value: unknown): VisionIssue[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((issue): VisionIssue[] => {
    if (typeof issue === 'string') {
      const description = issue.trim();
      return description ? [{ category: 'other', description }] : [];
    }
    if (!issue || typeof issue !== 'object') return [];
    const record = issue as Record<string, unknown>;
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    if (!description) return [];
    const category = typeof record.category === 'string' && VISION_ISSUE_CATEGORIES.has(record.category as VisionIssueCategory)
      ? record.category as VisionIssueCategory
      : 'other';
    return [{ category, description }];
  });
}

export const visionProvider = new VisionProvider();
