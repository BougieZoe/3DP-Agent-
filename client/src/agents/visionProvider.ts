export interface VisionAnalysisResult {
  qualitativeAssessment: string;
  observedIssues: string[];
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
    apiConfig?: { provider: string; apiKey: string },
    language?: string,
  ): Promise<VisionAnalysisResult> {
    if (!apiConfig?.apiKey) {
      return this.fallbackLocalAnalysis(geometrySummary);
    }

    try {
      const prompt = this.buildVisionPrompt(geometrySummary, language);

      if (apiConfig.provider === 'claude' || apiConfig.provider === 'openai') {
        return await this.callVisionAPI(apiConfig, screenshotBase64, prompt);
      }

      return this.fallbackLocalAnalysis(geometrySummary);
    } catch {
      return this.fallbackLocalAnalysis(geometrySummary || '');
    }
  }

  private buildVisionPrompt(geometrySummary: string, language?: string): string {
    const langInstr = language
      ? `\n\nPlease respond in ${language === 'zh' ? 'Simplified Chinese' : language === 'ja' ? 'Japanese' : 'English'}. Use natural and professional ${language === 'zh' ? 'Chinese' : language === 'ja' ? 'Japanese' : 'English'} terms. Current interface language is ${language}.`
      : '';
    return `You are a 3D printing geometry analyst. Analyze this STL model render and geometry data.

Geometry Data:
${geometrySummary}

Examine the rendered image and geometry data. Respond in JSON format:
{
  "qualitativeAssessment": "Brief overall assessment of model quality",
  "observedIssues": ["Issue 1", "Issue 2"],
  "confidence": 0.0-1.0
}

Focus on: visible thin walls, sharp overhangs, potential support needs, surface defects, and orientation issues.${langInstr}`;
  }

  private async callVisionAPI(
    apiConfig: { provider: string; apiKey: string },
    imageBase64: string,
    prompt: string,
  ): Promise<VisionAnalysisResult> {
    const imageData = imageBase64.replace(/^data:image\/png;base64,/, '');

    if (apiConfig.provider === 'openai') {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${imageData}` } },
            ],
          }],
          max_tokens: 500,
        }),
      });
      return this.parseVisionResponse(await resp.text());
    }

    if (apiConfig.provider === 'claude') {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiConfig.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData } },
            ],
          }],
        }),
      });
      return this.parseVisionResponse(await resp.text());
    }

    return this.fallbackLocalAnalysis('');
  }

  private parseVisionResponse(responseText: string): VisionAnalysisResult {
    try {
      const parsed = JSON.parse(responseText);
      const content = parsed.choices?.[0]?.message?.content || parsed.content?.[0]?.text || responseText;

      let jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsedJson = JSON.parse(jsonMatch[0]);
        return {
          qualitativeAssessment: parsedJson.qualitativeAssessment || 'No assessment available',
          observedIssues: parsedJson.observedIssues || [],
          confidence: parsedJson.confidence || 0.5,
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
      return this.fallbackLocalAnalysis('');
    }
  }

  private fallbackLocalAnalysis(_geometrySummary: string): VisionAnalysisResult {
    return {
      qualitativeAssessment: 'Vision analysis unavailable (no API key configured or API call failed)',
      observedIssues: [],
      confidence: 0,
      rawResponse: '',
    };
  }
}

export const visionProvider = new VisionProvider();
