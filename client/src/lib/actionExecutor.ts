/**
 * Action Executor
 *
 * Maps parsed intents to actual application functions:
 * - analyze → runAnalysisPipeline
 * - slice → callSliceAPI
 * - print → submitToPrinter
 * - settings → updatePrintSettings
 * - query → getPrintStatus
 * - export → exportModel
 */

import type { UserIntent, IntentAction } from './intentParser';
import type { GeometryModel } from '@/analysis/geometryModel';
import type { UnifiedAnalysis } from '@/analysis/types';

export interface ExecutionContext {
  model: GeometryModel | null;
  analysis: UnifiedAnalysis | null;
  material: string;
  language: string;
}

export interface ActionResult {
  success: boolean;
  action: IntentAction;
  message: string;
  data?: any;
}

// ── Action Handlers ────────────────────────────────────────────────────────

async function handleAnalyze(
  ctx: ExecutionContext,
  params: Record<string, any>
): Promise<ActionResult> {
  if (!ctx.model) {
    return { success: false, action: 'analyze', message: 'No model loaded' };
  }

  // Analysis is triggered by the caller — here we just confirm
  return {
    success: true,
    action: 'analyze',
    message: 'Starting analysis...',
    data: { triangleCount: ctx.model.triangleCount },
  };
}

async function handleSlice(
  ctx: ExecutionContext,
  params: Record<string, any>
): Promise<ActionResult> {
  if (!ctx.model) {
    return { success: false, action: 'slice', message: 'No model loaded' };
  }

  // Slice is triggered via API — here we just confirm
  return {
    success: true,
    action: 'slice',
    message: 'Starting slicing...',
    data: { material: params.material || ctx.material },
  };
}

async function handlePrint(
  ctx: ExecutionContext,
  params: Record<string, any>
): Promise<ActionResult> {
  if (!ctx.model) {
    return { success: false, action: 'print', message: 'No model loaded' };
  }

  // Print submission is handled by the caller
  return {
    success: true,
    action: 'print',
    message: 'Preparing to send to printer...',
    data: { material: params.material || ctx.material },
  };
}

async function handleSettings(
  ctx: ExecutionContext,
  params: Record<string, any>
): Promise<ActionResult> {
  const settingsApplied: string[] = [];

  if (params.material) {
    settingsApplied.push(`Material: ${params.material}`);
  }
  if (params.layerHeight) {
    settingsApplied.push(`Layer Height: ${params.layerHeight}mm`);
  }
  if (params.infill) {
    settingsApplied.push(`Infill: ${params.infill}%`);
  }

  if (settingsApplied.length === 0) {
    return {
      success: false,
      action: 'settings',
      message: 'No settings recognized',
    };
  }

  return {
    success: true,
    action: 'settings',
    message: `Settings updated: ${settingsApplied.join(', ')}`,
    data: params,
  };
}

async function handleQuery(
  ctx: ExecutionContext,
  params: Record<string, any>
): Promise<ActionResult> {
  if (!ctx.analysis) {
    return {
      success: false,
      action: 'query',
      message: 'No analysis results available',
    };
  }

  const queryType = params.type || 'summary';
  let message = '';

  switch (queryType) {
    case 'time':
      const time = ctx.analysis.printTime?.result?.estimatedPrintTimeMinutes;
      message = time
        ? `Estimated print time: ${time.toFixed(0)} minutes`
        : 'Print time not estimated yet';
      break;
    case 'score':
      const score = ctx.analysis.validation?.result;
      message = score
        ? `Printability score available in analysis results`
        : 'No score available';
      break;
    case 'supports':
      const supports = ctx.analysis.support?.result;
      message = supports
        ? supports.supportFaceCount > 0
          ? `Supports needed: ${supports.supportFaceCount} faces`
          : 'No supports needed'
        : 'Support analysis not run';
      break;
    default:
      message = 'Analysis results available in the report panel';
  }

  return {
    success: true,
    action: 'query',
    message,
    data: { queryType },
  };
}

async function handleExport(
  ctx: ExecutionContext,
  params: Record<string, any>
): Promise<ActionResult> {
  const format = params.format || 'stl';

  if (!ctx.model) {
    return { success: false, action: 'export', message: 'No model to export' };
  }

  return {
    success: true,
    action: 'export',
    message: `Exporting as ${format.toUpperCase()}...`,
    data: { format },
  };
}

async function handleShare(
  ctx: ExecutionContext,
  params: Record<string, any>
): Promise<ActionResult> {
  return {
    success: true,
    action: 'share',
    message: 'Generating share link...',
    data: {},
  };
}

async function handleHelp(
  ctx: ExecutionContext,
  params: Record<string, any>
): Promise<ActionResult> {
  return {
    success: true,
    action: 'help',
    message: 'Available commands: analyze, slice, print, settings, query, export, share',
    data: {},
  };
}

// ── Handler Map ────────────────────────────────────────────────────────────

const HANDLERS: Record<IntentAction, (ctx: ExecutionContext, params: Record<string, any>) => Promise<ActionResult>> = {
  analyze: handleAnalyze,
  slice: handleSlice,
  print: handlePrint,
  settings: handleSettings,
  query: handleQuery,
  export: handleExport,
  share: handleShare,
  help: handleHelp,
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Execute an intent
 */
export async function executeIntent(
  intent: UserIntent,
  context: ExecutionContext
): Promise<ActionResult> {
  const handler = HANDLERS[intent.action];
  if (!handler) {
    return {
      success: false,
      action: intent.action,
      message: `Unknown action: ${intent.action}`,
    };
  }

  try {
    return await handler(context, intent.params);
  } catch (err) {
    return {
      success: false,
      action: intent.action,
      message: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}
