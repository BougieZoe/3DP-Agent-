import { useCallback, useState } from "react";
import { CONTENT, translate, type ContentLang } from "@shared/i18n/content";
import type { UnifiedAnalysis, NormalOrientation } from "../analysis/types";
import { deriveOhStatus, deriveSupportStatus, deriveWtStatus } from "@/analysis/metrics";
import { createPdfCanvasSurface } from "@/lib/pdfCanvas";
import type { ExpertReview } from "@/agents/expertReview";
import type { ProductionSuitability } from "@/analysis/production";

// ─── Types ─────────────────────────────────────────────────────────────────────

type ToneMode = "friendly" | "professional" | "expert";
type Language = ContentLang;
type TrafficLight = "green" | "yellow" | "red";
type PdfTier = "client" | "designer" | "factory";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ReportGeneratorProps {
  analysis: UnifiedAnalysis;
  chatHistory?: ChatMessage[];
  fileName?: string;
  language?: ContentLang;
  /** AI expert review (if run) — embedded into the exported PDF report. */
  expertReview?: ExpertReview | null;
  /** Production-suitability estimate (computed by the caller) — embedded into the PDF. */
  production?: ProductionSuitability | null;
}

// ─── Language Detection ─────────────────────────────────────────────────────────

function detectLanguage(messages: ChatMessage[]): Language {
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
  const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
  return japanesePattern.test(userText) ? "ja" : "en";
}

// ─── Tone Detection ────────────────────────────────────────────────────────────

function detectTone(messages: ChatMessage[]): ToneMode {
  if (!messages.length) return "professional";
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();
  const expertTerms = [
    "topology", "manifold", "watertight", "overhang angle", "infill",
    "layer height", "retraction", "wall thickness", "stl", "mesh",
    "non-manifold", "boolean", "extrusion multiplier",
    "トポロジー", "マニフォールド", "オーバーハング", "インフィル",
  ];
  const expertScore = expertTerms.filter((t) => userText.includes(t)).length;
  const casualPatterns = [
    /\blol\b/, /\bomg\b/, /gonna/, /wanna/, /u r/, /thx/,
    /haha/, /ugh/, /basically/, /kinda/, /ya know/,
    /なんか/, /てか/, /じゃん/, /だよね/, /感じ/,
  ];
  const casualScore = casualPatterns.filter((p) => p.test(userText)).length;
  const avgWordLength =
    userText.split(/\s+/).reduce((sum, w) => sum + w.length, 0) /
    Math.max(userText.split(/\s+/).length, 1);
  if (expertScore >= 2 || avgWordLength > 8) return "expert";
  if (casualScore >= 2 || avgWordLength < 4) return "friendly";
  return "professional";
}

// ─── Traffic Light Score ───────────────────────────────────────────────────────

export function getTrafficLight(analysis: UnifiedAnalysis): {
  light: TrafficLight;
  score: number;
} {
  let score = 100;
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;
  const s = analysis.support?.result;

  if (v) {
    if (!v.isWatertight) score -= 30;
    if (v.holeCount > 0) score -= v.holeCount * 8;
    if (v.flippedNormalRatio > 0.1) score -= 15;
    if (v.degenerateFaceCount > 10) score -= 10;
  }

  if (m) {
    const wtStatus = deriveWtStatus(m.thinWallRatio ?? 0, m.p5WallThicknessMm);
    if (wtStatus === 'critical') score -= 30;
    else if (wtStatus === 'warning') score -= 15;
    if ((m.averageConfidence ?? 0) < 0.3 && (m.thinWallRatio ?? 0) < 0.02) score -= 3;
    const ohStatus = deriveOhStatus(m.overhang.ratio);
    if (ohStatus === 'critical') score -= 20;
    else if (ohStatus === 'warning') score -= 10;
  }

  if (s) {
    const supportStatus = deriveSupportStatus(s);
    if (supportStatus.status === 'critical') score -= 20;
    else if (supportStatus.status === 'warning') score -= 10;
  }

  score = Math.max(0, Math.min(100, score));

  const light: TrafficLight =
    score >= 75 ? "green" : score >= 45 ? "yellow" : "red";

  return { light, score };
}

// ─── Weight / Time ranges ──────────────────────────────────────────────────────

function computeWeightRange(grams: number, lang: Language): string {
  const lo = (grams * 0.05 * 1.2).toFixed(0);
  const hi = (grams * 1.0 * 1.2).toFixed(0);
  return `${lo}–${hi}g (${translate(CONTENT, 'pdf.labelWeightNote', lang)})`;
}

function computeTimeRange(minutes: number, lang: Language): string {
  const lo = Math.round(minutes * 0.7);
  const hi = Math.round(minutes * 1.3);
  const f = (m: number) => `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  return `${f(lo)} – ${f(hi)} (${translate(CONTENT, 'pdf.labelTimeNote', lang)})`;
}

// ─── Issue Builders ────────────────────────────────────────────────────────────

function formatNormalOrientation(o: NormalOrientation): string {
  switch (o) {
    case 'consistent_outward': return 'outward';
    case 'consistent_inward': return 'inward';
    case 'mixed': return 'mixed';
    default: return 'unknown';
  }
}

function buildClientIssues(analysis: UnifiedAnalysis, lang: Language): string[] {
  const issues: string[] = [];
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;
  const s = analysis.support?.result;

  if (m) {
    const twr = (m.thinWallRatio ?? 0);
    const p5 = m.p5WallThicknessMm;
    const wtStatus = deriveWtStatus(twr, p5);
    if (wtStatus === 'critical') {
      issues.push(
        translate(CONTENT, 'pdf.issue.client.thinWallsCritical', lang, { pct: (twr * 100).toFixed(0) })
      );
    } else if (wtStatus === 'warning') {
      issues.push(
        translate(CONTENT, 'pdf.issue.client.thinWallsWarning', lang, { pct: (twr * 100).toFixed(0) })
      );
    } else if ((m.averageConfidence ?? 0) < 0.5) {
      issues.push(
        translate(CONTENT, 'pdf.issue.client.lowConfidence', lang, { prefix: m.minWallThicknessMm != null ? `${m.minWallThicknessMm.toFixed(2)}mm — ` : '' })
      );
    }
  }

  if (v && !v.isWatertight) {
    issues.push(
      translate(CONTENT, 'pdf.issue.client.gaps', lang),
    );
    if (v.holeCount > 0) {
      issues.push(
        translate(CONTENT, 'pdf.issue.client.holes', lang, { count: v.holeCount })
      );
    }
  } else if (v && v.holeCount > 0) {
    issues.push(
      translate(CONTENT, 'pdf.issue.client.holes', lang, { count: v.holeCount })
    );
  }

  if (v && v.flippedNormalRatio > 0.05) {
    issues.push(
      translate(CONTENT, 'pdf.issue.client.flipped', lang),
    );
  }

  if (m) {
    const ohStatus = deriveOhStatus(m.overhang.ratio);
    if (ohStatus === 'critical') {
      issues.push(
        translate(CONTENT, 'pdf.issue.client.overhangCritical', lang),
      );
    } else if (ohStatus === 'warning') {
      issues.push(
        translate(CONTENT, 'pdf.issue.client.overhangWarning', lang),
      );
    }
  }

  if (s) {
    const supportStatus = deriveSupportStatus(s);
    if (supportStatus.status === 'critical') {
      issues.push(
        translate(CONTENT, 'pdf.issue.client.supportCritical', lang),
      );
    } else if (supportStatus.status === 'warning' && supportStatus.reasons.length > 0) {
      issues.push(
        translate(CONTENT, 'pdf.issue.client.supportWarning', lang, { reason: supportStatus.reasons[0] }),
      );
    }
  }

  return issues;
}

function buildDesignerIssues(
  analysis: UnifiedAnalysis,
  _tone: ToneMode,
  lang: Language
): string[] {
  const issues: string[] = [];
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;

  if (m) {
    const twr = (m.thinWallRatio ?? 0);
    const p5 = m.p5WallThicknessMm;
    const p10 = m.p10WallThicknessMm;
    const avg = m.avgWallThicknessMm;
    const conf = m.averageConfidence ?? 0;
    const wtStatus = deriveWtStatus(twr, p5);
    if (wtStatus === 'critical') {
      issues.push(
        translate(CONTENT, 'pdf.issue.designer.wallsCritical', lang, { pct: (twr * 100).toFixed(0), p5: (p5 ?? avg ?? 0).toFixed(2) })
      );
    } else if (wtStatus === 'warning') {
      const display = p10 ?? p5 ?? avg;
      issues.push(
        translate(CONTENT, 'pdf.issue.designer.wallsWarning', lang, { pct: (twr * 100).toFixed(0), p10: (display ?? 0).toFixed(2) })
      );
    } else if (conf < 0.5) {
      issues.push(
        translate(CONTENT, 'pdf.issue.designer.lowConfidence', lang, { conf: (conf * 100).toFixed(0), prefix: m.minWallThicknessMm != null ? `${m.minWallThicknessMm.toFixed(2)} mm は参考値として表示。` : '' })
      );
    }
  }

  if (v && !v.isWatertight) {
    issues.push(
        translate(CONTENT, 'pdf.issue.designer.notWatertight', lang),
    );
    if (v.holeCount > 0) {
      issues.push(
        translate(CONTENT, 'pdf.issue.designer.holes', lang, { count: v.holeCount })
      );
    }
  } else if (v && v.holeCount > 0) {
    issues.push(
      translate(CONTENT, 'pdf.issue.designer.holes', lang, { count: v.holeCount })
    );
  }

  if (v && v.flippedNormalRatio > 0.05) {
    issues.push(
      translate(CONTENT, 'pdf.issue.designer.flipped', lang, { pct: (v.flippedNormalRatio * 100).toFixed(0) })
    );
  }

  if (m) {
    const ohStatus = deriveOhStatus(m.overhang.ratio);
    if (ohStatus === 'critical') {
      issues.push(
        translate(CONTENT, 'pdf.issue.designer.overhangCritical', lang),
      );
    } else if (ohStatus === 'warning') {
      issues.push(
        translate(CONTENT, 'pdf.issue.designer.overhangWarning', lang),
      );
    }
  }

  const s = analysis.support?.result;
  if (s) {
    const supportStatus = deriveSupportStatus(s);
    if (supportStatus.status === 'critical') {
      issues.push(
        supportStatus.reasons[0] ?? translate(CONTENT, 'pdf.issue.designer.supportCritical', lang)
      );
    } else if (supportStatus.status === 'warning') {
      for (const reason of supportStatus.reasons.slice(0, 2)) {
        issues.push(
          translate(CONTENT, 'pdf.issue.designer.supportWarning', lang, { reason })
        );
      }
    }
  }

  return issues;
}

// ─── JsPDF interface ───────────────────────────────────────────────────────────

interface JsPDF {
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
  setFillColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void;
  setLineWidth(w: number): void;
  rect(x: number, y: number, w: number, h: number, style?: string): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  setFont(name: string, style?: string): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g: number, b: number): void;
  text(text: string | string[], x: number, y: number, opts?: object): void;
  splitTextToSize(text: string, maxWidth: number): string[];
  addPage(): void;
  save(filename: string): void;
  getTextWidth(text: string): number;
  circle(x: number, y: number, r: number, style?: string): void;
  getNumberOfPages(): number;
  setPage(n: number): void;
}

// ─── Color Palette ─────────────────────────────────────────────────────────────

const C = {
  red:       [139,  46,  46] as [number, number, number],
  amber:     [166, 124,  61] as [number, number, number],
  green:     [ 45, 106,  79] as [number, number, number],
  lightRed:  [249, 240, 239] as [number, number, number],
  lightAmber:[251, 246, 238] as [number, number, number],
  lightGreen:[239, 245, 241] as [number, number, number],
  pageBg:    [250, 250, 248] as [number, number, number],
  headerBg:  [242, 240, 235] as [number, number, number],
  footerBg:  [242, 240, 235] as [number, number, number],
  sectionLn: [232, 230, 224] as [number, number, number],
  ink:       [ 26,  26,  24] as [number, number, number],
  muted:     [107, 107, 101] as [number, number, number],
  faint:     [155, 155, 148] as [number, number, number],
  white:     [255, 255, 255] as [number, number, number],
} as const;

// ─── Kern helper for letter-spacing approximation ──────────────────────────────

const kern = (s: string): string => s.split("").join(" ");

// Active PDF font — set to a CJK font (via preparePdfFonts) when lang is ja/zh,
// since jsPDF's helvetica cannot render CJK. Also avoid letter-spacing CJK.
let pdfFont = "helvetica";
const kernText = (s: string): string => (/[぀-ヿ一-鿿]/.test(s) ? s : kern(s));

// ─── Shared PDF Helpers ────────────────────────────────────────────────────────

const PAGE_W = 210;
const PAGE_H = 297;
const PAGE_M = 20;
const PAGE_CW = PAGE_W - 2 * PAGE_M;
const PAGE_BOT = PAGE_H - 18;

function drawHeader(
  doc: JsPDF,
  lang: Language,
  fileName: string,
  dateStr: string,
  versionLabel: string
) {
  // Header background
  doc.setFillColor(...C.headerBg);
  doc.rect(0, 0, PAGE_W, 60, "F");

  // Overline — left
  doc.setFont(pdfFont, "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  doc.text(
    kernText(translate(CONTENT, 'pdf.brand', lang)),
    PAGE_M,
    28
  );

  // Version label — right
  doc.setFont(pdfFont, "bold");
  doc.setTextColor(...C.faint);
  doc.text(kern(versionLabel.toUpperCase()), PAGE_W - PAGE_M, 28, { align: "right" });

  // Title
  doc.setFont(pdfFont, "normal");
  doc.setFontSize(20);
  doc.setTextColor(...C.ink);
  doc.text(translate(CONTENT, 'pdf.title', lang), PAGE_M, 36);

  // File name + date
  doc.setFont(pdfFont, "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(`${fileName} · ${dateStr}`, PAGE_M, 45);

  // Traffic light color bar on header bottom
  // (caller must set the color before calling)
}

function drawFooter(
  doc: JsPDF,
  score: number,
  extraRight = ""
) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(...C.footerBg);
    doc.rect(0, PAGE_H - 15, PAGE_W, 15, "F");
    doc.setFont(pdfFont, "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text("3DP AGENT · 3dp-agent.vercel.app", PAGE_M, PAGE_H - 5);
    doc.setFont(pdfFont, "normal");
    doc.setTextColor(...C.faint);
    if (extraRight) {
      doc.text(`${extraRight} · ${score} / 100`, PAGE_W - PAGE_M, PAGE_H - 5, { align: "right" });
    } else {
      doc.text(`${score} / 100`, PAGE_W - PAGE_M, PAGE_H - 5, { align: "right" });
    }
  }
}

function drawVerdictCard(
  doc: JsPDF,
  cardY: number,
  cardH: number,
  light: TrafficLight,
  score: number,
  label: string,
  desc: string
) {
  const accent: [number, number, number] = light === "red" ? C.red : light === "yellow" ? C.amber : C.green;
  const lightBg: [number, number, number] = light === "red" ? C.lightRed : light === "yellow" ? C.lightAmber : C.lightGreen;

  // Background
  doc.setFillColor(...lightBg);
  doc.rect(PAGE_M, cardY, PAGE_CW, cardH, "F");

  // Left 4mm color bar
  doc.setFillColor(...accent);
  doc.rect(PAGE_M, cardY, 4, cardH, "F");

  // Label (12pt)
  doc.setFont(pdfFont, "bold");
  doc.setFontSize(12);
  doc.setTextColor(...C.ink);
  doc.text(label, PAGE_M + 12, cardY + 16);

  // Description (8pt)
  doc.setFont(pdfFont, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  doc.text(desc, PAGE_M + 12, cardY + 26);

  // Score right (28pt)
  doc.setFont(pdfFont, "bold");
  doc.setFontSize(28);
  doc.setTextColor(...accent);
  doc.text(`${score}`, PAGE_W - PAGE_M, cardY + cardH / 2 + 1, { align: "right" });

  // Color bar under header (caller must set color)
  // This is done at the call site so the color matches
}

function drawSectionLine(doc: JsPDF, y: number): number {
  doc.setDrawColor(...C.sectionLn);
  doc.setLineWidth(0.3);
  doc.line(PAGE_M, y, PAGE_W - PAGE_M, y);
  return y + 6;
}

function drawSectionHeader(doc: JsPDF, label: string, y: number): number {
  if (y > PAGE_BOT - 12) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  y = drawSectionLine(doc, y);
  doc.setFont(pdfFont, "bold");
  doc.setFontSize(7);
  doc.setTextColor(...C.faint);
  doc.text(kernText(label), PAGE_M, y);
  return y + 7;
}

function drawDataRow(
  doc: JsPDF,
  label: string,
  value: string,
  y: number,
  warn = false
): number {
  if (y > PAGE_BOT - 8) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  doc.setFont(pdfFont, "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(label, PAGE_M, y);
  doc.setFont(pdfFont, "bold");
  doc.setTextColor(...(warn ? C.red : C.ink));
  doc.text(value, PAGE_W - PAGE_M, y, { align: "right" });
  return y + 7;
}

function drawIssueBadge(
  doc: JsPDF,
  num: number,
  text: string,
  y: number,
  color: [number, number, number]
): number {
  const cx = PAGE_M + 3;
  const cy = y + 2;
  doc.setFillColor(...color);
  doc.circle(cx, cy, 2.5, "F");

  doc.setFont(pdfFont, "bold");
  doc.setFontSize(7);
  doc.setTextColor(...C.white);
  doc.text(`${num}`, cx, cy + 0.5, { align: "center" });

  doc.setFont(pdfFont, "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.ink);
  const lines = doc.splitTextToSize(text, PAGE_CW - 14);
  doc.text(lines, PAGE_M + 10, y + 0.5);

  return y + 6 + lines.length * 5;
}

/**
 * Embed the AI expert review into a PDF page: a section header, the
 * plain-language summary (wrapped), then numbered findings (severity-coloured
 * badges) and next actions. Returns the next free y.
 */
function drawExpertReview(
  doc: JsPDF,
  review: ExpertReview,
  lang: Language,
  y: number,
): number {
  y = drawSectionHeader(doc, translate(CONTENT, 'pdf.expertReview', lang), y);

  // Verdict + plain-language summary in one boxed block.
  const vColor: [number, number, number] =
    review.verdict === 'pass' ? C.green : review.verdict === 'warning' ? C.amber : C.red;
  const verdictLabel =
    review.verdict === 'pass'
      ? translate(CONTENT, 'pdf.verdict.ready', lang)
      : review.verdict === 'warning'
        ? translate(CONTENT, 'pdf.verdict.review', lang)
        : translate(CONTENT, 'pdf.verdict.notReady', lang);
  const label = `[${verdictLabel.toUpperCase()}] ${review.plain}`;
  const plainLines = doc.splitTextToSize(label, PAGE_CW - 14);
  doc.setFont(pdfFont, "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.ink);
  for (const line of plainLines) {
    if (y > PAGE_BOT - 8) { doc.addPage(); y = PAGE_M + 6; }
    doc.text(line, PAGE_M + 3, y);
    y += 5;
  }
  // Verdict accent line
  doc.setDrawColor(...vColor);
  doc.setLineWidth(1);
  doc.line(PAGE_M, y - 2, PAGE_M, y - 2 - plainLines.length * 5);
  doc.setLineWidth(0.3);
  y += 4;

  if (review.findings.length > 0) {
    y = drawSectionHeader(doc, translate(CONTENT, 'pdf.expertFindings', lang), y);
    review.findings.forEach((f, i) => {
      const sev: [number, number, number] =
        f.severity === 'high' ? C.red : f.severity === 'medium' ? C.amber : C.green;
      const text = f.why ? `${f.what} — ${f.why}` : f.what;
      y = drawIssueBadge(doc, i + 1, text, y, sev);
    });
  }

  if (review.actions.length > 0) {
    y = drawSectionHeader(doc, translate(CONTENT, 'pdf.expertActions', lang), y);
    review.actions.forEach((a, i) => {
      y = drawIssueBadge(doc, i + 1, `${a.do}  (impact ${a.impact} · effort ${a.effort})`, y, C.muted);
    });
  }

  return y + 4;
}

/** Production-suitability section: score, parts per build, per-part cost, verdict. */
function drawProductionSection(doc: JsPDF, prod: ProductionSuitability, lang: Language, y: number): number {
  y = drawSectionHeader(doc, translate(CONTENT, 'pdf.production', lang), y);
  const verdictLabel =
    prod.verdict === 'production'
      ? translate(CONTENT, 'pdf.prodProduction', lang)
      : prod.verdict === 'small-batch'
        ? translate(CONTENT, 'pdf.prodSmallBatch', lang)
        : translate(CONTENT, 'pdf.prodPrototype', lang);
  y = drawDataRow(doc, translate(CONTENT, 'pdf.prodPerBatch', lang), `${prod.partsPerBatch}`, y);
  y = drawDataRow(doc, translate(CONTENT, 'pdf.prodPerPartCost', lang), `$${prod.perPartCostUsd.toFixed(2)}`, y);
  y = drawDataRow(doc, translate(CONTENT, 'pdf.prodVerdict', lang), `${prod.score}/100 · ${verdictLabel}`, y);
  y += 2;
  const advisory = translate(CONTENT, 'pdf.prodAdvisory', lang);
  const aLines = doc.splitTextToSize(advisory, PAGE_CW);
  if (y + aLines.length * 4 > PAGE_BOT) { doc.addPage(); y = PAGE_M + 6; }
  doc.setFont(pdfFont, "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...C.faint);
  doc.text(aLines, PAGE_M, y);
  return y + aLines.length * 4 + 4;
}

/** One-line report-boundary note (measured vs AI opinion vs not simulated). */
function drawLimitsNote(doc: JsPDF, lang: Language, y: number): number {
  const line = translate(CONTENT, 'pdf.limitsNote', lang);
  const lines = doc.splitTextToSize(line, PAGE_CW);
  if (y + lines.length * 4 > PAGE_BOT) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  doc.setFont(pdfFont, "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...C.faint);
  doc.text(lines, PAGE_M, y);
  return y + lines.length * 4 + 2;
}

// ─── CLIENT PDF ────────────────────────────────────────────────────────────────

async function generateClientPDF(
  analysis: UnifiedAnalysis,
  lang: Language,
  fileName: string,
  review?: ExpertReview | null,
  production?: ProductionSuitability | null
): Promise<void> {
  const doc = createPdfCanvasSurface();

  const { light, score } = getTrafficLight(analysis);
  const metrics = analysis.metrics?.result;
  const dims = metrics?.boundingBoxDimensionsMm;
  const pt = analysis.printTime?.result;
  const v = analysis.validation?.result;
  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === "ja" ? "ja-JP" : lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const accent: [number, number, number] = light === "red" ? C.red : light === "yellow" ? C.amber : C.green;

  // ── Page background ──
  doc.setFillColor(...C.pageBg);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  // ── Header ──
  drawHeader(doc, lang, fileName, dateStr, "client summary");
  doc.setFillColor(...accent);
  doc.rect(0, 60, PAGE_W, 3, "F");

  // ── Verdict card ──
  const issues = buildClientIssues(analysis, lang);
  const count = issues.length;

  function vl(r: string, a: string, g: string): string {
    return light === "red" ? r : light === "yellow" ? a : g;
  }
  const verdictLabel = vl(
    translate(CONTENT, 'pdf.verdict.notReady', lang),
    translate(CONTENT, 'pdf.verdict.review', lang),
    translate(CONTENT, 'pdf.verdict.ready', lang)
  );
  const verdictDesc = vl(
    translate(CONTENT, 'pdf.verdictDesc.count', lang, { count }),
    translate(CONTENT, 'pdf.verdictDesc.minor', lang),
    translate(CONTENT, 'pdf.verdictDesc.noIssues', lang)
  );

  drawVerdictCard(doc, 68, 38, light, score, verdictLabel, verdictDesc);

  let y = 68 + 38 + 10;

  // ── Section: DIMENSIONS & ESTIMATES ──
  y = drawSectionHeader(doc, translate(CONTENT, 'pdf.section.dimensions', lang), y);

  if (dims) {
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.size', lang),
      `${dims.x.toFixed(0)} × ${dims.y.toFixed(0)} × ${dims.z.toFixed(0)} mm`,
      y
    );
  }
  y = drawDataRow(doc,
    translate(CONTENT, 'pdf.label.weight', lang),
    pt?.materialWeightGrams != null ? computeWeightRange(pt.materialWeightGrams, lang) : "—",
    y
  );
  y = drawDataRow(doc,
    translate(CONTENT, 'pdf.label.time', lang),
    pt?.estimatedPrintTimeMinutes != null ? computeTimeRange(pt.estimatedPrintTimeMinutes, lang) : "—",
    y
  );
  if (pt?.materialCostUsd != null) {
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.cost', lang), `$${pt.materialCostUsd.toFixed(2)}`, y);
  }
  if (metrics?.meshVolumeMm3 != null) {
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.volume', lang), `${(metrics.meshVolumeMm3 / 1000).toFixed(2)} cm³`, y);
  }

  if (v) {
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.watertight', lang),
      v.isWatertight ? (lang === "ja" ? "〇" : "Yes") : (lang === "ja" ? "×" : "No"),
      y,
      !v.isWatertight
    );
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.holes', lang),
      `${v.holeCount}`,
      y,
      v.holeCount > 0
    );
  }

  // ── Section: ISSUES FOUND ──
  y += 4;
  y = drawSectionHeader(doc, translate(CONTENT, 'pdf.section.issuesFound', lang), y);

  if (issues.length > 0) {
    const badgeColor: [number, number, number] = light === "red" ? C.red : light === "yellow" ? C.amber : C.green;
    for (let i = 0; i < issues.length; i++) {
      y = drawIssueBadge(doc, i + 1, issues[i], y, badgeColor);
      if (y > PAGE_BOT - 20) {
        doc.addPage();
        y = PAGE_M + 6;
      }
    }
  } else {
    doc.setFont(pdfFont, "normal");
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(
      translate(CONTENT, 'pdf.noIssues', lang),
      PAGE_M, y
    );
    y += 7;
  }

  // ── AI expert review (if run) ──
  if (review) {
    y = drawExpertReview(doc, review, lang, y);
    y += 4;
  }
  if (production) {
    y = drawProductionSection(doc, production, lang, y);
    y += 4;
  }

  // ── Next step ──
  y += 6;
  doc.setFont(pdfFont, "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(...C.faint);
  const nextStep = translate(CONTENT, 'pdf.nextStep', lang);
  const nsLines = doc.splitTextToSize(nextStep, PAGE_CW);
  if (y + nsLines.length * 4 > PAGE_BOT) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  doc.text(nsLines, PAGE_M, y);
  y += nsLines.length * 4 + 4;

  // ── Footer ──
  y = drawLimitsNote(doc, lang, y);
  drawFooter(doc, score);

  const baseName = fileName.replace(/\.stl$/i, "");
  await doc.save(`${baseName}_client.pdf`);
}

// ─── DESIGNER PDF ──────────────────────────────────────────────────────────────

async function generateDesignerPDF(
  analysis: UnifiedAnalysis,
  tone: ToneMode,
  lang: Language,
  fileName: string,
  review?: ExpertReview | null,
  production?: ProductionSuitability | null
): Promise<void> {
  const doc = createPdfCanvasSurface();

  const { light, score } = getTrafficLight(analysis);
  const metrics = analysis.metrics?.result;
  const dims = metrics?.boundingBoxDimensionsMm;
  const pt = analysis.printTime?.result;
  const v = analysis.validation?.result;
  const t = analysis.topology?.result;
  const s = analysis.support?.result;
  const issues = buildDesignerIssues(analysis, tone, lang);
  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === "ja" ? "ja-JP" : lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const accent: [number, number, number] = light === "red" ? C.red : light === "yellow" ? C.amber : C.green;
  const count = issues.length;

  // ── Page background ──
  doc.setFillColor(...C.pageBg);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  // ── Header ──
  drawHeader(doc, lang, fileName, dateStr, "designer review");
  doc.setFillColor(...accent);
  doc.rect(0, 60, PAGE_W, 3, "F");

  // ── Verdict card ──
  function vl(r: string, a: string, g: string): string {
    return light === "red" ? r : light === "yellow" ? a : g;
  }
  const verdictLabel = vl(
    translate(CONTENT, 'pdf.verdict.issuesFound', lang),
    translate(CONTENT, 'pdf.verdict.review', lang),
    translate(CONTENT, 'pdf.verdict.readyShort', lang)
  );
  const verdictDesc = vl(
    translate(CONTENT, 'pdf.verdictDesc.count', lang, { count }),
    translate(CONTENT, 'pdf.verdictDesc.minor', lang),
    translate(CONTENT, 'pdf.verdictDesc.clean', lang)
  );

  drawVerdictCard(doc, 68, 38, light, score, verdictLabel, verdictDesc);

  let y = 68 + 38 + 10;

  // ── Section: DIMENSIONS ──
  y = drawSectionHeader(doc, translate(CONTENT, 'pdf.section.dimensionsShort', lang), y);

  if (dims) {
    y = drawDataRow(doc,
      lang === "ja" ? "サイズ" : "Size",
      `${dims.x.toFixed(1)} × ${dims.y.toFixed(1)} × ${dims.z.toFixed(1)} mm`,
      y
    );
  }
  y = drawDataRow(doc,
    translate(CONTENT, 'pdf.label.volume', lang),
    metrics?.meshVolumeMm3 != null ? `${(metrics.meshVolumeMm3 / 1000).toFixed(2)} cm³` : "—",
    y
  );
  y = drawDataRow(doc,
    lang === "ja" ? "推定重量" : "Est. weight",
    pt?.materialWeightGrams != null ? computeWeightRange(pt.materialWeightGrams, lang) : "—",
    y
  );
  y = drawDataRow(doc,
    lang === "ja" ? "推定印刷時間" : "Est. print time",
    pt?.estimatedPrintTimeMinutes != null ? computeTimeRange(pt.estimatedPrintTimeMinutes, lang) : "—",
    y
  );

  // ── Section: KEY METRICS ──
  y += 4;
  const wtStatus = metrics != null ? deriveWtStatus(metrics.thinWallRatio ?? 0, metrics.p5WallThicknessMm) : 'good';
  y = drawSectionHeader(doc, "KEY METRICS", y);

  if (metrics?.minWallThicknessMm != null) {
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.minWall', lang),
      `${metrics.minWallThicknessMm.toFixed(3)} mm`,
      y,
      wtStatus !== 'good'
    );
  }
  if (metrics?.p5WallThicknessMm != null) {
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.p5Wall', lang),
      `${metrics.p5WallThicknessMm.toFixed(3)} mm`,
      y,
      wtStatus !== 'good'
    );
  }
  if (metrics) {
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.overhang', lang),
      `${metrics.overhang.faceCount} faces · ${metrics.overhang.severity}`,
      y
    );
  }
  if (s) {
    const supportStatus = deriveSupportStatus(s);
    const statusLabel = supportStatus.status === 'critical' ? translate(CONTENT, 'pdf.status.critical', lang) : supportStatus.status === 'warning' ? translate(CONTENT, 'pdf.status.warning', lang) : translate(CONTENT, 'pdf.status.good', lang);
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.support', lang),
      statusLabel,
      y,
      supportStatus.status !== 'good'
    );
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.supportRegions', lang),
      `${s.supportRegions.length}`,
      y
    );
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.largestIsland', lang),
      `${(s.largestRegionRatio * 100).toFixed(1)}%`,
      y,
      supportStatus.status === 'critical'
    );
  }
  if (v) {
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.watertight', lang),
      v.isWatertight ? (lang === "ja" ? "〇" : "Yes") : (lang === "ja" ? "×" : "No"),
      y,
      !v.isWatertight
    );
  }
  if (t) {
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.manifold', lang),
      t.isManifold ? (lang === "ja" ? "〇" : "Yes") : (lang === "ja" ? "×" : "No"),
      y,
      !t.isManifold
    );
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.shells', lang),
      `${t.shellCount}`,
      y,
      t.shellCount > 1
    );
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.boundaryEdges', lang),
      `${t.boundaryEdgeCount}`,
      y,
      t.boundaryEdgeCount > 0
    );
  }
  if (v) {
    y = drawDataRow(doc,
      translate(CONTENT, 'pdf.label.normalOrientation', lang),
      formatNormalOrientation(v.normalOrientation),
      y,
      v.normalOrientation !== 'consistent_outward'
    );
  }

  // ── Section: ISSUES ──
  y += 4;
  const issuesY = y;
  y = drawSectionHeader(doc, translate(CONTENT, 'pdf.section.issues', lang), y);

  if (issues.length > 0) {
    const badgeColor: [number, number, number] = light === "red" ? C.red : light === "yellow" ? C.amber : C.green;
    let issueY = y;
    for (let i = 0; i < issues.length; i++) {
      const nextY = drawIssueBadge(doc, i + 1, issues[i], issueY, badgeColor);
      if (nextY > PAGE_BOT - 16) {
        doc.addPage();
        issueY = PAGE_M + 6;
        // Re-draw section header on new page
        issueY = drawSectionHeader(doc, translate(CONTENT, 'pdf.section.issuesContinued', lang), issueY);
        issueY = drawIssueBadge(doc, i + 1, issues[i], issueY, badgeColor);
      } else {
        issueY = nextY;
      }
    }
    y = issueY;
  } else {
    doc.setFont(pdfFont, "normal");
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(
      translate(CONTENT, 'pdf.noIssuesDetected', lang),
      PAGE_M, y
    );
    y += 7;
  }

  // ── Modification suggestion ──
  y += 4;
  let suggestion: string;
  if (issues.length === 0) {
    suggestion = translate(CONTENT, 'pdf.suggestion.good', lang);
  } else {
    const parts: string[] = [];
    const wtStatus = deriveWtStatus(metrics?.thinWallRatio ?? 0, metrics?.p5WallThicknessMm);
    if (wtStatus !== 'good') {
      parts.push(translate(CONTENT, 'pdf.suggestion.increaseWall', lang));
    }
    if (metrics?.overhang.ratio != null && deriveOhStatus(metrics.overhang.ratio) !== 'good') {
      parts.push(translate(CONTENT, 'pdf.suggestion.enableSupport', lang));
    }
    if (v && !v.isWatertight) {
      parts.push(translate(CONTENT, 'pdf.suggestion.runRepair', lang));
    }
    suggestion = parts.length > 0
      ? translate(CONTENT, 'pdf.suggest', lang, { parts: parts.join(lang === 'ja' ? '、' : '; ') })
      : (lang === "ja" ? "問題点を確認して調整してください" : "Review issues and adjust");
  }

  // ── AI expert review (if run) ──
  if (review) {
    y = drawExpertReview(doc, review, lang, y);
    y += 4;
  }
  if (production) {
    y = drawProductionSection(doc, production, lang, y);
    y += 4;
  }

  doc.setFont(pdfFont, "italic");
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  const sugLines = doc.splitTextToSize(suggestion, PAGE_CW);
  if (y + sugLines.length * 4 > PAGE_BOT) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  doc.text(sugLines, PAGE_M, y);
  y += sugLines.length * 4 + 4;

  // ── Footer ──
  y = drawLimitsNote(doc, lang, y);
  drawFooter(doc, score);

  const baseName = fileName.replace(/\.stl$/i, "");
  await doc.save(`${baseName}_designer.pdf`);
}

// ─── FACTORY PDF ───────────────────────────────────────────────────────────────

async function generateFactoryPDF(
  analysis: UnifiedAnalysis,
  lang: Language,
  fileName: string,
  review?: ExpertReview | null,
  production?: ProductionSuitability | null
): Promise<void> {
  const doc = createPdfCanvasSurface();

  const { light, score } = getTrafficLight(analysis);
  const metrics = analysis.metrics?.result;
  const dims = metrics?.boundingBoxDimensionsMm;
  const pt = analysis.printTime?.result;
  const v = analysis.validation?.result;
  const t = analysis.topology?.result;
  const s = analysis.support?.result;
  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === "ja" ? "ja-JP" : lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const reportId = `3DP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(Math.floor(Math.random() * 9000 + 1000))}`;
  const accent: [number, number, number] = light === "red" ? C.red : light === "yellow" ? C.amber : C.green;

  // ── Page background ──
  doc.setFillColor(...C.pageBg);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");

  // ── Header ──
  drawHeader(doc, lang, fileName, dateStr, "factory data");
  doc.setFillColor(...accent);
  doc.rect(0, 60, PAGE_W, 3, "F");

  // ── Verdict card ──
  const count = (() => {
    const iss = buildDesignerIssues(analysis, "expert", lang);
    return iss.length;
  })();

  function vl(r: string, a: string, g: string): string {
    return light === "red" ? r : light === "yellow" ? a : g;
  }
  const verdictLabel = vl(
    translate(CONTENT, 'pdf.verdictDesc.count', lang, { count }),
    translate(CONTENT, 'pdf.verdict.review', lang),
    translate(CONTENT, 'pdf.verdict.readyShort', lang)
  );
  const verdictDesc = vl(
    translate(CONTENT, 'pdf.verdictDesc.fixFirst', lang),
    translate(CONTENT, 'pdf.verdictDesc.cautions', lang),
    translate(CONTENT, 'pdf.verdictDesc.clean', lang)
  );

  drawVerdictCard(doc, 68, 38, light, score, verdictLabel, verdictDesc);

  let y = 68 + 38 + 10;

  // ── Section: TOPOLOGY ──
  y = drawSectionHeader(doc, translate(CONTENT, 'pdf.section.topology', lang), y);

  if (t) {
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.triangles', lang), `${t.triangleCount}`, y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.vertices', lang), `${t.vertexCount}`, y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.manifoldEdges', lang), `${t.manifoldEdgeCount}`, y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.nonManifoldEdges', lang), `${t.nonManifoldEdgeCount}`, y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.manifold', lang), `${t.isManifold}`, y, !t.isManifold);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.shells', lang), `${t.shellCount}`, y, t.shellCount > 1);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.boundaryEdges', lang), `${t.boundaryEdgeCount}`, y, t.boundaryEdgeCount > 0);
  }

  // ── Section: VALIDATION ──
  y += 4;
  y = drawSectionHeader(doc, translate(CONTENT, 'pdf.section.validation', lang), y);

  if (v) {
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.watertight', lang), v.isWatertight ? "true" : "false", y, !v.isWatertight);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.holes', lang), `${v.holeCount}`, y, v.holeCount > 0);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.normalOrientation', lang), formatNormalOrientation(v.normalOrientation), y, v.normalOrientation !== 'consistent_outward');
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.flippedNormalRatio', lang), `${(v.flippedNormalRatio * 100).toFixed(2)}%`, y, v.flippedNormalRatio > 0.05);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.degenerateFaces', lang), `${v.degenerateFaceCount}`, y, v.degenerateFaceCount > 10);
  }

  // ── Section: METRICS ──
  y += 4;
  if (y > PAGE_BOT - 60) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  y = drawSectionHeader(doc, translate(CONTENT, 'pdf.section.metrics', lang), y);

  if (metrics) {
    if (dims) {
      y = drawDataRow(doc, translate(CONTENT, 'pdf.label.dimensions', lang), `${dims.x.toFixed(1)} × ${dims.y.toFixed(1)} × ${dims.z.toFixed(1)} mm`, y);
    }
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.volume', lang), metrics.meshVolumeMm3 != null ? `${(metrics.meshVolumeMm3 / 1000).toFixed(2)} cm³` : "—", y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.surfaceArea', lang), metrics.surfaceAreaMm2 != null ? `${(metrics.surfaceAreaMm2 / 100).toFixed(2)} cm²` : "—", y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.minWall', lang), metrics.minWallThicknessMm != null ? `${metrics.minWallThicknessMm.toFixed(3)} mm` : "—", y, false);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.overhangFaces', lang), `${metrics.overhang.faceCount}`, y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.overhangRatio', lang), `${(metrics.overhang.ratio * 100).toFixed(1)}%`, y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.overhangSeverity', lang), metrics.overhang.severity, y);
  }

  // ── Section: SUPPORT ──
  y += 4;
  if (y > PAGE_BOT - 30) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  y = drawSectionHeader(doc, translate(CONTENT, 'pdf.section.support', lang), y);

  if (s) {
    const pdfSupportStatus = deriveSupportStatus(s);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.status', lang), pdfSupportStatus.status, y, pdfSupportStatus.status !== 'good');
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.supportVolume', lang), s.totalSupportVolumeMm3 != null ? `${(s.totalSupportVolumeMm3 / 1000).toFixed(2)} cm³` : "—", y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.supportRegions', lang), `${s.supportRegions.length}`, y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.largestIsland', lang), `${(s.largestRegionRatio * 100).toFixed(1)}%`, y, pdfSupportStatus.status === 'critical');
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.tallSupportRatio', lang), `${(s.tallSupportRatio * 100).toFixed(1)}%`, y, pdfSupportStatus.status !== 'good');
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.directionality', lang), `${(s.directionality * 100).toFixed(1)}%`, y, pdfSupportStatus.status !== 'good');
  }

  // ── Section: PRINT TIME & MATERIAL ──
  y += 4;
  if (y > PAGE_BOT - 60) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  y = drawSectionHeader(doc, translate(CONTENT, 'pdf.section.printTime', lang), y);

  if (pt) {
    const rawMinutes = pt.estimatedPrintTimeMinutes;
    const ph = Math.floor(rawMinutes / 60);
    const pm = Math.round(rawMinutes % 60);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.printTime', lang), `${ph}h ${pm}m`, y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.materialWeight', lang), `${pt.materialWeightGrams} g`, y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.materialCost', lang), `$${pt.materialCostUsd.toFixed(2)}`, y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.totalCost', lang), `$${pt.totalCostUsd.toFixed(2)}`, y);
    y = drawDataRow(doc, translate(CONTENT, 'pdf.label.layerCount', lang), `${pt.layerCount}`, y);
  }

  // ── Section: OVERHANG BREAKDOWN ──
  const ohByAngle = metrics?.overhang.breakdownByAngleDeg;
  if (ohByAngle && ohByAngle.length > 0) {
    y += 4;
    if (y > PAGE_BOT - ohByAngle.length * 7 - 20) {
      doc.addPage();
      y = PAGE_M + 6;
    }
    y = drawSectionHeader(doc, translate(CONTENT, 'pdf.section.overhangBreakdown', lang), y);

    for (const row of ohByAngle) {
      y = drawDataRow(doc,
        `${row.minAngle}°–${row.maxAngle}°`,
        `${row.faceCount} ${translate(CONTENT, 'pdf.label.faces', lang)}`,
        y
      );
    }
  }

  // ── AI expert review (if run) ──
  if (review) {
    y = drawExpertReview(doc, review, lang, y);
    y += 4;
  }
  if (production) {
    y = drawProductionSection(doc, production, lang, y);
    y += 4;
  }

  // ── Disclaimer ──
  y += 6;
  const disclaimer = translate(CONTENT, 'pdf.disclaimer', lang, { id: reportId });
  const dLines = doc.splitTextToSize(disclaimer, PAGE_CW);

  if (y + dLines.length * 4 + 4 > PAGE_BOT) {
    doc.addPage();
    y = PAGE_M + 6;
  }

  doc.setFont(pdfFont, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...C.faint);
  doc.text(dLines, PAGE_M, y);
  y += dLines.length * 4 + 4;

  // ── Footer ──
  y = drawLimitsNote(doc, lang, y);
  drawFooter(doc, score, reportId);

  const baseName = fileName.replace(/\.stl$/i, "");
  await doc.save(`${baseName}_factory.pdf`);
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function ReportGenerator({
  analysis,
  chatHistory = [],
  fileName = "model.stl",
  language = "en",
  expertReview,
  production,
}: ReportGeneratorProps) {
  const tone = detectTone(chatHistory);
  const lang = language ?? detectLanguage(chatHistory);
  const { light, score } = getTrafficLight(analysis);

  const handleExport = useCallback(async (tier: PdfTier) => {
    if (tier === "client") {
      await generateClientPDF(analysis, lang, fileName, expertReview, production);
    } else if (tier === "designer") {
      await generateDesignerPDF(analysis, tone, lang, fileName, expertReview, production);
    } else {
      await generateFactoryPDF(analysis, lang, fileName, expertReview, production);
    }
  }, [analysis, tone, lang, fileName, expertReview, production]);

  const lightStyles: Record<TrafficLight, string> = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    yellow: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };

  const dotStyles: Record<TrafficLight, string> = {
    green: "bg-emerald-500",
    yellow: "bg-amber-500",
    red: "bg-red-500",
  };

  const [tier, setTier] = useState<PdfTier>("client");

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium ${lightStyles[light]}`}>
          <span className={`w-2 h-2 rounded-full ${dotStyles[light]}`} />
          {score}/100
        </div>
        <span className="text-[10px] font-mono text-muted-foreground/50 tracking-wider">{translate(CONTENT, 'pdf.labelQuickCheck', language)}</span>
      </div>
      <div className="text-[10px] font-mono text-muted-foreground/30 leading-relaxed">
        {translate(CONTENT, 'pdf.labelPenalty', language)}
      </div>

      {/* Report boundary legend — what's measured vs AI opinion vs not analyzed */}
      <details className="text-[10px] font-mono border border-border/30 rounded-sm px-2 py-1.5">
        <summary className="cursor-pointer text-muted-foreground/40 tracking-widest select-none">
          {translate(CONTENT, 'pdf.limitsTitle', language)}
        </summary>
        <div className="mt-1.5 space-y-1 text-muted-foreground/55 leading-relaxed">
          <div>✓ {translate(CONTENT, 'pdf.limitsMeasured', language)}</div>
          <div>⚠ {translate(CONTENT, 'pdf.limitsAi', language)}</div>
          <div>✗ {translate(CONTENT, 'pdf.limitsNotAnalyzed', language)}</div>
        </div>
      </details>

      {/* One primary action — export. Tier is a small secondary select. */}
      <div className="flex items-center gap-2">
        <button onClick={() => handleExport(tier)} className="flex-1 py-2.5 text-[11px] font-mono border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground rounded-sm transition-all">
          {translate(CONTENT, 'pdf.exportPdf', language)}
        </button>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as PdfTier)}
          title={translate(CONTENT, 'pdf.labelExport', language)}
          className="text-[10px] font-mono px-2 py-2 border border-border rounded-sm bg-background text-muted-foreground cursor-pointer"
        >
          <option value="client">{translate(CONTENT, 'pdf.tier.client', language)}</option>
          <option value="designer">{translate(CONTENT, 'pdf.tier.designer', language)}</option>
          <option value="factory">{translate(CONTENT, 'pdf.tier.factory', language)}</option>
        </select>
      </div>
    </div>
  );
}
