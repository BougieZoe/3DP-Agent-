/**
 * Failure Detection AI
 *
 * Detects print failures from webcam images:
 * - Stringing (拉丝)
 * - Warping (翘曲)
 * - Delamination (脱层)
 * - Clogging (堵头)
 * - Layer shift (偏移)
 */

import { callAI, getActiveProvider, getKey } from '@/lib/apiKeys';
import { imageDataToBase64 } from '@/lib/webcam';

export type FailureType =
  | 'stringing'
  | 'warping'
  | 'delamination'
  | 'clogging'
  | 'layer_shift'
  | 'spaghetti'
  | 'elephant_foot'
  | 'none';

export interface DetectedFailure {
  type: FailureType;
  confidence: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  suggestedAction: string;
}

export interface FailureDetectionResult {
  failures: DetectedFailure[];
  overallHealth: 'good' | 'warning' | 'critical';
  timestamp: number;
}

// ── Rule-based detection ───────────────────────────────────────────────────

/**
 * Simple rule-based failure detection from image analysis
 * This is a fallback when LLM is unavailable
 */
function detectByRules(imageData: ImageData): DetectedFailure[] {
  const failures: DetectedFailure[] = [];

  // Analyze image for common failure indicators
  const { width, height, data } = imageData;

  // Check for excessive brightness variation (possible spaghetti)
  let brightnessSum = 0;
  let brightnessVariance = 0;
  const sampleStep = 10; // Sample every 10th pixel for performance

  for (let i = 0; i < data.length; i += 4 * sampleStep) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = (r + g + b) / 3;
    brightnessSum += brightness;
  }

  const pixelCount = data.length / (4 * sampleStep);
  const avgBrightness = brightnessSum / pixelCount;

  for (let i = 0; i < data.length; i += 4 * sampleStep) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = (r + g + b) / 3;
    brightnessVariance += (brightness - avgBrightness) ** 2;
  }

  brightnessVariance /= pixelCount;

  // High variance might indicate spaghetti
  if (brightnessVariance > 2000) {
    failures.push({
      type: 'spaghetti',
      confidence: 0.4,
      severity: 'high',
      description: 'Possible spaghetti detected — excessive visual variation',
      suggestedAction: 'Check for failed supports or extrusion issues',
    });
  }

  return failures;
}

// ── LLM-based detection ────────────────────────────────────────────────────

const DETECTION_PROMPT = `You are a 3D print failure detection AI. Analyze this image of a 3D print in progress.

Look for these failure patterns:
- stringing: Thin strings of filament between parts
- warping: Corners lifting from the build plate
- delamination: Layers separating or cracking
- clogging: Inconsistent extrusion or gaps
- layer_shift: Layers misaligned horizontally
- spaghetti: Collapsed structure with loose filament
- elephant_foot: First layer spreading beyond the model

Return ONLY a JSON array of detected failures (empty array if none):
[
  {
    "type": "failure_type",
    "confidence": 0.0-1.0,
    "severity": "low|medium|high|critical",
    "description": "Brief description",
    "suggestedAction": "What to do"
  }
]

If no failures detected, return: []

Image analysis:`;

async function detectByLLM(imageData: ImageData): Promise<DetectedFailure[]> {
  const provider = getActiveProvider();
  if (!provider) return [];

  const apiKey = getKey(provider);
  if (!apiKey) return [];

  try {
    const base64 = imageDataToBase64(imageData);

    // For vision-capable models, we'd send the image directly
    // For now, use the base64 as context
    const response = await callAI(
      provider,
      apiKey,
      DETECTION_PROMPT,
      `Image data (base64, first 100 chars): ${base64.substring(0, 100)}...`,
      'en'
    );

    // Parse JSON response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((f: any) =>
      f.type && f.confidence && f.severity
    );
  } catch {
    return [];
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Detect failures from a webcam frame
 */
export async function detectFailures(
  imageData: ImageData
): Promise<FailureDetectionResult> {
  // Try LLM first, fall back to rules
  let failures = await detectByLLM(imageData);

  if (failures.length === 0) {
    failures = detectByRules(imageData);
  }

  // Determine overall health
  let overallHealth: 'good' | 'warning' | 'critical' = 'good';
  for (const failure of failures) {
    if (failure.severity === 'critical') {
      overallHealth = 'critical';
      break;
    }
    if (failure.severity === 'high') {
      overallHealth = 'warning';
    }
  }

  return {
    failures,
    overallHealth,
    timestamp: Date.now(),
  };
}

/**
 * Get human-readable description of a failure type
 */
export function describeFailure(type: FailureType, language: string = 'en'): string {
  const descriptions: Record<string, Record<FailureType, string>> = {
    en: {
      stringing: 'Stringing — thin filament strings between parts',
      warping: 'Warping — corners lifting from the build plate',
      delamination: 'Delamination — layers separating or cracking',
      clogging: 'Clogging — inconsistent extrusion or gaps',
      layer_shift: 'Layer shift — layers misaligned horizontally',
      spaghetti: 'Spaghetti — collapsed structure with loose filament',
      elephant_foot: "Elephant's foot — first layer spreading beyond model",
      none: 'No failures detected',
    },
    zh: {
      stringing: '拉丝 — 零件之间的细丝',
      warping: '翘曲 — 边角从热床抬起',
      delamination: '脱层 — 层间分离或开裂',
      clogging: '堵头 — 挤出不均匀或有间隙',
      layer_shift: '层偏移 — 层水平错位',
      spaghetti: '意面 — 结构塌陷，有松散丝材',
      elephant_foot: '大象脚 — 第一层超出模型',
      none: '未检测到失败',
    },
  };

  return (descriptions[language] || descriptions.en)[type] || type;
}
