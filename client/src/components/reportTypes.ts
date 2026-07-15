import type { UnifiedAnalysis } from "../analysis/types";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ToneMode = "friendly" | "professional" | "expert";
export type Language = "en" | "ja" | "zh";
export type TrafficLight = "green" | "yellow" | "red";
export type PdfTier = "client" | "designer" | "factory";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ReportGeneratorProps {
  analysis: UnifiedAnalysis;
  chatHistory?: ChatMessage[];
  fileName?: string;
}
