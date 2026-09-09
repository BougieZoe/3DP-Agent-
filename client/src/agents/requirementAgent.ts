/**
 * Requirement Agent — parse free-text customer requests into structured fields.
 *
 * Rule-based v1: keyword matching + regex extraction of numbers+units.
 * No LLM dependency — validates data flow works end-to-end before adding
 * model-based parsing (consistent with project convention: rules first, LLM later).
 */

export interface ParsedRequirement {
  material?: string;
  buildSizeMm?: { widthMm: number; depthMm: number; heightMm: number };
  budgetRange?: string;
  quantity?: number;
  processHint?: string;
  confidence: number;
  missingFields: string[];
}

const ALL_FIELDS = ['material', 'buildSizeMm', 'budgetRange', 'quantity', 'processHint'] as const;

const PROCESS_KEYWORDS: Record<string, string> = {
  fgf: 'FGF', fused: 'FGF',
  sla: 'SLA', resin: 'SLA', dla: 'SLA',
  fdm: 'FDM', '熔融沉积': 'FDM',
  sls: 'SLS', '尼龙': 'SLS',
  mjf: 'MJF',
  pbf: 'PBF', '粉末': 'PBF',
  sdm: 'SDM',
};

const MATERIAL_KEYWORDS: Record<string, string> = {
  pla: 'PLA', petg: 'PETG',
  abs: 'ABS', asa: 'ASA',
  tpu: 'TPU', nylon: 'Nylon',
  '尼龙': 'Nylon', pa: 'Nylon',
  resin: 'Resin',
  '碳纤维': 'Carbon Fiber', cf: 'Carbon Fiber',
  '铝合金': 'Aluminum', aluminum: 'Aluminum', aluminium: 'Aluminum',
  '不锈钢': 'Stainless Steel', steel: 'Stainless Steel',
  concrete: 'Concrete', '混凝土': 'Concrete',
  '光敏树脂': 'Resin',
};

const BUDGET_PATTERNS: RegExp[] = [
  /预算[在为]?\s*[¥$€]?\s*[\d,.]+\s*[万wk]?\s*[元$€]?/i,
  /budget\s*(?:is|:)?\s*[¥$€]?\s*[\d,.]+/i,
  /[\d,.]+\s*(?:元|美元|欧元|usd|eur)/i,
  /[¥$€]\s*[\d,.]+/,
  /(?:不超过|under|below|max|最多)\s*[¥$€]?\s*[\d,.]+/i,
];

function extractNumbers(text: string): number[] {
  const matches = text.match(/[\d,.]+/g) ?? [];
  return matches.map(m => parseFloat(m.replace(/,/g, ''))).filter(n => !isNaN(n) && n > 0);
}

function extractDimensions(text: string): { widthMm: number; depthMm: number; heightMm: number } | undefined {
  // Pattern: "WxHxD" or "W × H × D" or "W*D*D" with optional units
  const dimMatch = text.match(
    /(\d+(?:\.\d+)?)\s*[x×＊*]\s*(\d+(?:\.\d+)?)\s*[x×＊*]\s*(\d+(?:\.\d+)?)/i,
  );
  if (dimMatch) {
    const nums = dimMatch.slice(1).map(Number);
    return { widthMm: nums[0], depthMm: nums[1], heightMm: nums[2] };
  }

  // Pattern: "1800 x 1200 x 1300mm" or similar
  const spacedMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×＊*,/]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×＊*,/]\s*(\d+(?:\.\d+)?)\s*mm/i,
  );
  if (spacedMatch) {
    const nums = spacedMatch.slice(1).map(Number);
    return { widthMm: nums[0], depthMm: nums[1], heightMm: nums[2] };
  }

  return undefined;
}

function extractProcessHint(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [keyword, process] of Object.entries(PROCESS_KEYWORDS)) {
    if (lower.includes(keyword.toLowerCase())) {
      return process;
    }
  }
  return undefined;
}

function extractMaterial(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [keyword, material] of Object.entries(MATERIAL_KEYWORDS)) {
    if (lower.includes(keyword.toLowerCase())) {
      return material;
    }
  }
  return undefined;
}

function extractBudget(text: string): string | undefined {
  for (const pattern of BUDGET_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return undefined;
}

function extractQuantity(text: string): number | undefined {
  // "500个", "1000件", "200 units", "batch of 500"
  const patterns = [
    /(\d+(?:,\d{3})*)\s*(?:个|件|只|台|套|pcs|pieces|units?)/i,
    /(?:batch\s*(?:of\s*)?|quantity\s*(?::|is)?\s*)(\d+(?:,\d{3})*)/i,
    /(\d+(?:,\d{3})*)\s*(?:批量|件)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1].replace(/,/g, ''), 10);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  return undefined;
}

/**
 * Parse a free-text customer requirement into structured fields.
 * Returns a ParsedRequirement with extracted fields, confidence score,
 * and a list of fields that could not be extracted.
 */
export function parseRequirements(text: string): ParsedRequirement {
  const material = extractMaterial(text);
  const buildSizeMm = extractDimensions(text);
  const budgetRange = extractBudget(text);
  const quantity = extractQuantity(text);
  const processHint = extractProcessHint(text);

  const extracted: string[] = [];
  if (material) extracted.push('material');
  if (buildSizeMm) extracted.push('buildSizeMm');
  if (budgetRange) extracted.push('budgetRange');
  if (quantity) extracted.push('quantity');
  if (processHint) extracted.push('processHint');

  const missingFields = ALL_FIELDS.filter(f => !extracted.includes(f));
  const confidence = extracted.length / ALL_FIELDS.length;

  return {
    material,
    buildSizeMm,
    budgetRange,
    quantity,
    processHint,
    confidence,
    missingFields,
  };
}
