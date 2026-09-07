import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { BlenderAdapter } from './blenderAdapter';
import { renderMultiView, type MultiViewResult, type ViewAngle, STANDARD_8_VIEWS } from './visualVerifier';

// ── Types ──

export type Severity = 'ok' | 'warning' | 'critical';

export interface Finding {
  category: string;
  severity: Severity;
  description: string;
  viewAngle?: string;
}

export interface VerificationReport {
  fileName: string;
  timestamp: string;
  modelUsed: string;
  viewsRendered: number;
  findings: Finding[];
  overallVerdict: Severity;
  summary: string;
}

export interface VisionModelConfig {
  provider: 'openai' | 'anthropic' | 'mock';
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

// ── Prompt ──

const VERIFICATION_PROMPT = `You are a 3D printing expert analyzing rendered views of a 3D part.

For each view angle provided, analyze the geometry and identify issues:

1. **Geometry Anomalies** — Non-manifold edges, holes, self-intersections, inverted normals
2. **Wall Thickness** — Thin walls that may break during printing (< 1mm for FDM, < 0.3mm for SLA)
3. **Overhang Risk** — Surfaces angled > 45° that need support material
4. **Assembly Fit** — If multiple parts visible, check clearances and tolerances
5. **Print Orientation** — Is the current orientation optimal? Suggest improvements
6. **Surface Quality** — Visible defects, layer lines, artifacts

Respond in JSON format:
{
  "findings": [
    {
      "category": "geometry|wall_thickness|overhang|assembly|orientation|surface",
      "severity": "ok|warning|critical",
      "description": "specific issue found",
      "viewAngle": "front|back|left|right|top|bottom|iso1|iso2"
    }
  ],
  "overallVerdict": "ok|warning|critical",
  "summary": "1-2 sentence overall assessment"
}

If everything looks good, return findings with severity "ok". Be specific about measurements when visible.`;

// ── Vision Model Callers ──

async function callOpenAI(
  images: Buffer[],
  config: VisionModelConfig
): Promise<{ findings: Finding[]; overallVerdict: Severity; summary: string }> {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key required (set OPENAI_API_KEY or pass in config)');

  const model = config.model || 'gpt-4o';
  const imageContent = images.map((buf, i) => ({
    type: 'image_url' as const,
    image_url: {
      url: `data:image/png;base64,${buf.toString('base64')}`,
      detail: 'low' as const,
    },
  }));

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: config.maxTokens || 2000,
      messages: [
        { role: 'system', content: VERIFICATION_PROMPT },
        { role: 'user', content: [
          { type: 'text' as const, text: `Analyze these ${images.length} views of a 3D part for printing issues:` },
          ...imageContent,
        ]},
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json() as { choices: { message: { content: string } }[] };
  const content = data.choices[0]?.message?.content || '';

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${content.slice(0, 200)}`);

  return JSON.parse(jsonMatch[0]);
}

async function callMock(): Promise<{ findings: Finding[]; overallVerdict: Severity; summary: string }> {
  return {
    findings: [
      { category: 'geometry', severity: 'ok', description: 'No non-manifold edges detected', viewAngle: 'iso1' },
      { category: 'wall_thickness', severity: 'ok', description: 'Minimum wall thickness adequate (>1mm)', viewAngle: 'front' },
      { category: 'overhang', severity: 'ok', description: 'No overhangs exceeding 45° threshold', viewAngle: 'side' },
      { category: 'orientation', severity: 'ok', description: 'Current orientation appears reasonable', viewAngle: 'iso2' },
      { category: 'surface', severity: 'ok', description: 'No visible surface defects', viewAngle: 'top' },
    ],
    overallVerdict: 'ok',
    summary: 'Mock analysis: part appears suitable for 3D printing with no critical issues detected.',
  };
}

// ── Main Pipeline ──

export async function verifyPart(
  adapter: BlenderAdapter,
  filePath: string,
  config: VisionModelConfig = { provider: 'mock' }
): Promise<VerificationReport> {
  // 1. Import mesh
  await adapter.importMesh(filePath);

  // 2. Render 8 angles
  const multiView = await renderMultiView(adapter, { width: 800, height: 600 });

  // 3. Read rendered images
  const images: Buffer[] = [];
  for (const view of multiView.views) {
    const buf = await readFile(view.render.imagePath);
    images.push(buf);
  }

  // 4. Call vision model
  let result: { findings: Finding[]; overallVerdict: Severity; summary: string };
  switch (config.provider) {
    case 'openai':
      result = await callOpenAI(images, config);
      break;
    case 'mock':
    default:
      result = await callMock();
      break;
  }

  // 5. Build report
  return {
    fileName: basename(filePath),
    timestamp: new Date().toISOString(),
    modelUsed: config.provider === 'openai' ? (config.model || 'gpt-4o') : 'mock',
    viewsRendered: multiView.views.length,
    findings: result.findings,
    overallVerdict: result.overallVerdict,
    summary: result.summary,
  };
}
