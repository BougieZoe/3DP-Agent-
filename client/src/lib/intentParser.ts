/**
 * Intent Parser
 *
 * Parses natural language user commands into structured intents:
 * - Uses LLM for complex intent extraction
 * - Rule-based fallback for simple commands
 * - Multi-language support
 */

import { callAI, getActiveProvider, getKey } from '@/lib/apiKeys';

export type IntentAction =
  | 'analyze'
  | 'slice'
  | 'print'
  | 'settings'
  | 'query'
  | 'export'
  | 'share'
  | 'help';

export interface UserIntent {
  action: IntentAction;
  params: Record<string, any>;
  confidence: number;
  raw: string;
}

// ── Rule-based patterns ────────────────────────────────────────────────────

interface IntentPattern {
  patterns: RegExp[];
  action: IntentAction;
  extractParams?: (match: RegExpMatchArray) => Record<string, any>;
}

const INTENT_PATTERNS: IntentPattern[] = [
  // Analyze
  {
    patterns: [
      /analy[sz]e\s+(this|the|my)/i,
      /check\s+(this|the|my)/i,
      /inspect\s+(this|the|my)/i,
      /查看|分析|检查/,
    ],
    action: 'analyze',
  },
  // Slice
  {
    patterns: [
      /slice\s+(this|the|my)/i,
      /切片|分割/,
    ],
    action: 'slice',
  },
  // Print
  {
    patterns: [
      /print\s+(this|the|my)/i,
      /send\s+to\s+printer/i,
      /打印|印刷/,
    ],
    action: 'print',
  },
  // Settings
  {
    patterns: [
      /(?:set|change|use|switch)\s+(?:to\s+)?(\w+)/i,
      /(?:layer|height|infill|material)\s*(?:to|=|:)\s*(\S+)/i,
      /设置|调整|修改/,
    ],
    action: 'settings',
    extractParams: (match) => {
      const text = match[0].toLowerCase();
      const params: Record<string, any> = {};

      // Material detection
      if (/petg|pla|abs|tpu|nylon|pc|asa|pva/i.test(text)) {
        const materialMatch = text.match(/(petg|pla|abs|tpu|nylon|pc|asa|pva)/i);
        if (materialMatch) params.material = materialMatch[1].toUpperCase();
      }

      // Layer height detection
      const layerMatch = text.match(/(?:layer|height)\s*(?:to|=|:)\s*([\d.]+)/i);
      if (layerMatch) params.layerHeight = parseFloat(layerMatch[1]);

      // Infill detection
      const infillMatch = text.match(/infill\s*(?:to|=|:)\s*(\d+)/i);
      if (infillMatch) params.infill = parseInt(infillMatch[1]);

      return params;
    },
  },
  // Query
  {
    patterns: [
      /what(?:'s| is| are)\s+(?:the\s+)?/i,
      /how\s+(?:long|much|many)/i,
      /多久|多少|什么/,
    ],
    action: 'query',
  },
  // Export
  {
    patterns: [
      /export\s+(?:as|to)\s+(\w+)/i,
      /save\s+(?:as|to)\s+(\w+)/i,
      /导出|保存/,
    ],
    action: 'export',
    extractParams: (match) => {
      const formatMatch = match[0].match(/(?:as|to)\s+(\w+)/i);
      return { format: formatMatch?.[1]?.toLowerCase() || 'stl' };
    },
  },
  // Help
  {
    patterns: [
      /help/i,
      /what\s+can\s+you\s+do/i,
      /帮助|功能/,
    ],
    action: 'help',
  },
];

// ── Rule-based parsing ─────────────────────────────────────────────────────

function parseByRules(text: string): UserIntent | null {
  const trimmed = text.trim();

  for (const { patterns, action, extractParams } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        return {
          action,
          params: extractParams ? extractParams(match) : {},
          confidence: 0.8,
          raw: text,
        };
      }
    }
  }

  return null;
}

// ── LLM-based parsing ──────────────────────────────────────────────────────

const INTENT_PROMPT = `You are an intent parser for a 3D printing application.
Parse the user's command into a structured intent.

Available actions: analyze, slice, print, settings, query, export, share, help

Return ONLY a JSON object (no explanation):
{
  "action": "action_name",
  "params": { "key": "value" },
  "confidence": 0.0-1.0
}

Examples:
- "Analyze this model" → {"action": "analyze", "params": {}, "confidence": 0.95}
- "Use PETG material" → {"action": "settings", "params": {"material": "PETG"}, "confidence": 0.9}
- "How long will this take?" → {"action": "query", "params": {"type": "time"}, "confidence": 0.85}
- "Export as STL" → {"action": "export", "params": {"format": "stl"}, "confidence": 0.9}

User command: `;

async function parseByLLM(text: string): Promise<UserIntent | null> {
  try {
    const provider = getActiveProvider();
    if (!provider) return null;
    const apiKey = getKey(provider);
    if (!apiKey) return null;

    const response = await callAI(
      provider,
      apiKey,
      'You are an intent parser for a 3D printing application. Parse the user command into a structured intent. Return ONLY a JSON object with action, params, and confidence fields.',
      text,
      'en'
    );

    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.action || !['analyze', 'slice', 'print', 'settings', 'query', 'export', 'share', 'help'].includes(parsed.action)) {
      return null;
    }

    return {
      action: parsed.action,
      params: parsed.params || {},
      confidence: parsed.confidence || 0.7,
      raw: text,
    };
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse user input into a structured intent
 * Tries rule-based first, falls back to LLM
 */
export async function parseIntent(text: string): Promise<UserIntent> {
  // Try rule-based first (instant, no API call)
  const ruleBased = parseByRules(text);
  if (ruleBased && ruleBased.confidence >= 0.8) {
    return ruleBased;
  }

  // Fall back to LLM
  const llmResult = await parseByLLM(text);
  if (llmResult) {
    return llmResult;
  }

  // Default: treat as query
  return {
    action: 'query',
    params: { query: text },
    confidence: 0.3,
    raw: text,
  };
}

/**
 * Get suggested commands
 */
export function getSuggestedCommands(language: string = 'en'): string[] {
  if (language === 'zh') {
    return [
      '分析这个模型',
      '用 PETG 打印',
      '预测打印时间',
      '导出为 STL',
      '需要支撑吗？',
    ];
  }
  if (language === 'ja') {
    return [
      'このモデルを分析して',
      'PETGで印刷して',
      '印刷時間を予測して',
      'STLにエクスポート',
      'サポートが必要？',
    ];
  }
  return [
    'Analyze this model',
    'Print with PETG',
    'How long will this take?',
    'Export as STL',
    'Do I need supports?',
  ];
}
