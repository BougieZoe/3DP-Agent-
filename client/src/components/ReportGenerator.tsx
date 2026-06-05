import { useCallback } from "react";
import type { UnifiedAnalysis } from "../analysis/types";

// ─── Types ─────────────────────────────────────────────────────────────────────

type ToneMode = "friendly" | "professional" | "expert";
type Language = "en" | "ja";
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

function getTrafficLight(analysis: UnifiedAnalysis): {
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
    if (m.minWallThicknessMm !== null && m.minWallThicknessMm < 1.2)
      score -= 20;
    if (m.overhang.severity === "severe") score -= 20;
    if (m.overhang.severity === "moderate") score -= 10;
  }

  if (s) {
    if (s.difficulty === "very_difficult") score -= 15;
    if (s.difficulty === "difficult") score -= 8;
  }

  score = Math.max(0, Math.min(100, score));

  const light: TrafficLight =
    score >= 75 ? "green" : score >= 45 ? "yellow" : "red";

  return { light, score };
}

// ─── Weight / Time ranges ──────────────────────────────────────────────────────

function computeWeightRange(grams: number): string {
  const lo = (grams * 0.05 * 1.2).toFixed(0);
  const hi = (grams * 1.0 * 1.2).toFixed(0);
  return `${lo}–${hi}g (varies by infill)`;
}

function computeTimeRange(minutes: number): string {
  const lo = Math.round(minutes * 0.7);
  const hi = Math.round(minutes * 1.3);
  const f = (m: number) => `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  return `${f(lo)} – ${f(hi)} (excl. supports)`;
}

// ─── Issue Builders ────────────────────────────────────────────────────────────

function buildClientIssues(analysis: UnifiedAnalysis, lang: Language): string[] {
  const issues: string[] = [];
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;

  if (m && m.minWallThicknessMm !== null && m.minWallThicknessMm < 1.2) {
    issues.push(
      lang === "ja"
        ? "壁が薄すぎる部分があります。印刷中に壊れる可能性があります。"
        : "Some walls are very thin and might break during printing."
    );
  }

  if (v && !v.isWatertight) {
    issues.push(
      lang === "ja"
        ? "モデルに隙間があり、完全に閉じていません。"
        : "The model has gaps — it's not fully closed."
    );
    if (v.holeCount > 0) {
      issues.push(
        lang === "ja"
          ? `${v.holeCount}ヶ所に穴があります。`
          : `${v.holeCount} hole${v.holeCount > 1 ? "s" : ""} found in the model.`
      );
    }
  } else if (v && v.holeCount > 0) {
    issues.push(
      lang === "ja"
        ? `${v.holeCount}ヶ所に穴があります。`
        : `${v.holeCount} hole${v.holeCount > 1 ? "s" : ""} found in the model.`
    );
  }

  if (v && v.flippedNormalRatio > 0.05) {
    issues.push(
      lang === "ja"
        ? "一部の面が裏返しになっています。見た目に影響するかもしれません。"
        : "Some surfaces are facing the wrong way — this may affect appearance."
    );
  }

  if (m) {
    if (m.overhang.severity === "severe") {
      issues.push(
        lang === "ja"
          ? "大きく張り出した部分があります。サポート材が必要です。"
          : "Large overhanging areas will need support material."
      );
    } else if (m.overhang.severity === "moderate") {
      issues.push(
        lang === "ja"
          ? "やや張り出した部分があります。サポート材を検討してください。"
          : "Some areas stick out — consider using supports."
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

  if (m && m.minWallThicknessMm !== null && m.minWallThicknessMm < 1.2) {
    issues.push(
      lang === "ja"
        ? `壁厚 ${m.minWallThicknessMm.toFixed(2)} mm — 推奨最小値 1.2 mm。印刷中に破損の可能性。`
        : `Wall thickness ${m.minWallThicknessMm.toFixed(2)} mm — minimum safe is 1.2 mm. Risk of failure during print.`
    );
  }

  if (v && !v.isWatertight) {
    issues.push(
      lang === "ja"
        ? "メッシュが密閉されていません。スライサーエラーの原因になります。"
        : "Mesh is not watertight. May cause slicing errors."
    );
    if (v.holeCount > 0) {
      issues.push(
        lang === "ja"
          ? `メッシュに${v.holeCount}個の穴があります。印刷前に修正してください。`
          : `${v.holeCount} hole${v.holeCount > 1 ? "s" : ""} found. Repair before slicing.`
      );
    }
  } else if (v && v.holeCount > 0) {
    issues.push(
      lang === "ja"
        ? `メッシュに${v.holeCount}個の穴があります。印刷前に修正してください。`
        : `${v.holeCount} hole${v.holeCount > 1 ? "s" : ""} found. Repair before slicing.`
    );
  }

  if (v && v.flippedNormalRatio > 0.05) {
    issues.push(
      lang === "ja"
        ? `面の${(v.flippedNormalRatio * 100).toFixed(0)}% で法線が反転しています。スライスアーティファクトの原因に。`
        : `${(v.flippedNormalRatio * 100).toFixed(0)}% of faces have inverted normals. May cause slicing artifacts.`
    );
  }

  if (m) {
    if (m.overhang.severity === "severe") {
      issues.push(
        lang === "ja"
          ? "深刻なオーバーハング。サポート構造が必須です。"
          : "Severe overhang. Support structures are required."
      );
    } else if (m.overhang.severity === "moderate") {
      issues.push(
        lang === "ja"
          ? "中程度のオーバーハング。サポート構造を推奨します。"
          : "Moderate overhang. Support structures are advisable."
      );
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
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  doc.text(
    kern("3DP AGENT · PRINTABILITY ASSESSMENT"),
    PAGE_M,
    28
  );

  // Version label — right
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C.faint);
  doc.text(kern(versionLabel.toUpperCase()), PAGE_W - PAGE_M, 28, { align: "right" });

  // Title
  doc.setFont("helvetica", "normal");
  doc.setFontSize(20);
  doc.setTextColor(...C.ink);
  doc.text(lang === "ja" ? "プリント分析レポート" : "Print Analysis Report", PAGE_M, 36);

  // File name + date
  doc.setFont("helvetica", "normal");
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
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text("3DP AGENT · 3dp-agent.vercel.app", PAGE_M, PAGE_H - 5);
    doc.setFont("helvetica", "normal");
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
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...C.ink);
  doc.text(label, PAGE_M + 12, cardY + 16);

  // Description (8pt)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  doc.text(desc, PAGE_M + 12, cardY + 26);

  // Score right (28pt)
  doc.setFont("helvetica", "bold");
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
  y = drawSectionLine(doc, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...C.faint);
  doc.text(kern(label), PAGE_M, y);
  return y + 7;
}

function drawDataRow(
  doc: JsPDF,
  label: string,
  value: string,
  y: number,
  warn = false
): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(label, PAGE_M, y);
  doc.setFont("helvetica", "bold");
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

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...C.white);
  doc.text(`${num}`, cx, cy + 0.5, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.ink);
  const lines = doc.splitTextToSize(text, PAGE_CW - 14);
  doc.text(lines, PAGE_M + 10, y + 0.5);

  return y + 6 + lines.length * 5;
}

// ─── CLIENT PDF ────────────────────────────────────────────────────────────────

async function generateClientPDF(
  analysis: UnifiedAnalysis,
  lang: Language,
  fileName: string
): Promise<void> {
  const { jsPDF } = await import("jspdf" as never) as { jsPDF: new (o?: object) => JsPDF };
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const { light, score } = getTrafficLight(analysis);
  const metrics = analysis.metrics?.result;
  const dims = metrics?.boundingBoxDimensionsMm;
  const pt = analysis.printTime?.result;
  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === "ja" ? "ja-JP" : "en-US", {
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
    lang === "ja" ? "印刷には不向きです" : "Not ready to print",
    lang === "ja" ? "要確認" : "Review recommended",
    lang === "ja" ? "印刷可能です" : "Ready to print"
  );
  const verdictDesc = vl(
    lang === "ja" ? `${count}件の問題があります` : `${count} issue${count !== 1 ? "s" : ""} found`,
    lang === "ja" ? "軽微な問題があります" : "Minor issues found",
    lang === "ja" ? "特に問題はありません" : "No issues detected"
  );

  drawVerdictCard(doc, 68, 38, light, score, verdictLabel, verdictDesc);

  let y = 68 + 38 + 10;

  // ── Section: DIMENSIONS & ESTIMATES ──
  y = drawSectionHeader(doc, "DIMENSIONS & ESTIMATES", y);

  if (dims) {
    y = drawDataRow(doc,
      lang === "ja" ? "サイズ" : "Size",
      `${dims.x.toFixed(0)} × ${dims.y.toFixed(0)} × ${dims.z.toFixed(0)} mm`,
      y
    );
  }
  y = drawDataRow(doc,
    lang === "ja" ? "推定重量" : "Est. weight",
    pt?.materialWeightGrams != null ? computeWeightRange(pt.materialWeightGrams) : "—",
    y
  );
  y = drawDataRow(doc,
    lang === "ja" ? "推定印刷時間" : "Est. print time",
    pt?.estimatedPrintTimeMinutes != null ? computeTimeRange(pt.estimatedPrintTimeMinutes) : "—",
    y
  );

  // ── Section: ISSUES FOUND ──
  y += 4;
  y = drawSectionHeader(doc, "ISSUES FOUND", y);

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
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(
      lang === "ja" ? "問題は見つかりませんでした。" : "No issues found.",
      PAGE_M, y
    );
    y += 7;
  }

  // ── Next step ──
  y += 6;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(...C.faint);
  const nextStep = lang === "ja"
    ? "次のステップ: このレポートをデザイナーと共有するか、3dp-agent.vercel.app にアクセスして支援を受けてください。"
    : "Next step: share this report with your designer, or visit 3dp-agent.vercel.app for assistance.";
  const nsLines = doc.splitTextToSize(nextStep, PAGE_CW);
  if (y + nsLines.length * 4 > PAGE_BOT) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  doc.text(nsLines, PAGE_M, y);

  // ── Footer ──
  drawFooter(doc, score);

  const baseName = fileName.replace(/\.stl$/i, "");
  doc.save(`${baseName}_client.pdf`);
}

// ─── DESIGNER PDF ──────────────────────────────────────────────────────────────

async function generateDesignerPDF(
  analysis: UnifiedAnalysis,
  tone: ToneMode,
  lang: Language,
  fileName: string
): Promise<void> {
  const { jsPDF } = await import("jspdf" as never) as { jsPDF: new (o?: object) => JsPDF };
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const { light, score } = getTrafficLight(analysis);
  const metrics = analysis.metrics?.result;
  const dims = metrics?.boundingBoxDimensionsMm;
  const pt = analysis.printTime?.result;
  const v = analysis.validation?.result;
  const s = analysis.support?.result;
  const issues = buildDesignerIssues(analysis, tone, lang);
  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === "ja" ? "ja-JP" : "en-US", {
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
    lang === "ja" ? "問題が検出されました" : "Issues found",
    lang === "ja" ? "確認を推奨" : "Review recommended",
    lang === "ja" ? "印刷可能" : "Ready to print"
  );
  const verdictDesc = vl(
    lang === "ja" ? `${count}件の問題` : `${count} issue${count !== 1 ? "s" : ""}`,
    lang === "ja" ? "軽微な問題" : "Minor issues",
    lang === "ja" ? "問題なし" : "No issues"
  );

  drawVerdictCard(doc, 68, 38, light, score, verdictLabel, verdictDesc);

  let y = 68 + 38 + 10;

  // ── Section: DIMENSIONS ──
  y = drawSectionHeader(doc, "DIMENSIONS", y);

  if (dims) {
    y = drawDataRow(doc,
      lang === "ja" ? "サイズ" : "Size",
      `${dims.x.toFixed(1)} × ${dims.y.toFixed(1)} × ${dims.z.toFixed(1)} mm`,
      y
    );
  }
  y = drawDataRow(doc,
    lang === "ja" ? "体積" : "Volume",
    metrics?.meshVolumeMm3 != null ? `${(metrics.meshVolumeMm3 / 1000).toFixed(2)} cm³` : "—",
    y
  );
  y = drawDataRow(doc,
    lang === "ja" ? "推定重量" : "Est. weight",
    pt?.materialWeightGrams != null ? computeWeightRange(pt.materialWeightGrams) : "—",
    y
  );
  y = drawDataRow(doc,
    lang === "ja" ? "推定印刷時間" : "Est. print time",
    pt?.estimatedPrintTimeMinutes != null ? computeTimeRange(pt.estimatedPrintTimeMinutes) : "—",
    y
  );

  // ── Section: KEY METRICS ──
  y += 4;
  y = drawSectionHeader(doc, "KEY METRICS", y);

  if (metrics?.minWallThicknessMm != null) {
    y = drawDataRow(doc,
      lang === "ja" ? "最小壁厚" : "Min wall thickness",
      `${metrics.minWallThicknessMm.toFixed(2)} mm`,
      y,
      metrics.minWallThicknessMm < 1.2
    );
  }
  if (metrics) {
    y = drawDataRow(doc,
      lang === "ja" ? "オーバーハング" : "Overhang",
      `${metrics.overhang.faceCount} faces · ${metrics.overhang.severity}`,
      y
    );
  }
  if (s) {
    const diffLabel = s.difficulty === "easy" ? "Easy" : s.difficulty === "moderate" ? "Moderate" : s.difficulty === "difficult" ? "Difficult" : "Very difficult";
    y = drawDataRow(doc,
      lang === "ja" ? "サポート" : "Support",
      diffLabel,
      y
    );
  }
  if (v) {
    y = drawDataRow(doc,
      lang === "ja" ? "密閉性" : "Watertight",
      v.isWatertight ? (lang === "ja" ? "〇" : "Yes") : (lang === "ja" ? "×" : "No"),
      y,
      !v.isWatertight
    );
  }

  // ── Section: ISSUES ──
  y += 4;
  const issuesY = y;
  y = drawSectionHeader(doc, "ISSUES", y);

  if (issues.length > 0) {
    const badgeColor: [number, number, number] = light === "red" ? C.red : light === "yellow" ? C.amber : C.green;
    let issueY = y;
    for (let i = 0; i < issues.length; i++) {
      const nextY = drawIssueBadge(doc, i + 1, issues[i], issueY, badgeColor);
      if (nextY > PAGE_BOT - 16) {
        doc.addPage();
        issueY = PAGE_M + 6;
        // Re-draw section header on new page
        issueY = drawSectionHeader(doc, "ISSUES (continued)", issueY);
        issueY = drawIssueBadge(doc, i + 1, issues[i], issueY, badgeColor);
      } else {
        issueY = nextY;
      }
    }
    y = issueY;
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(
      lang === "ja" ? "問題は検出されませんでした。" : "No issues detected.",
      PAGE_M, y
    );
    y += 7;
  }

  // ── Modification suggestion ──
  y += 4;
  let suggestion: string;
  if (issues.length === 0) {
    suggestion = lang === "ja"
      ? "このモデルは良好です。そのまま印刷してください。"
      : "This model looks good. Proceed with printing.";
  } else {
    const parts: string[] = [];
    if (metrics?.minWallThicknessMm != null && metrics.minWallThicknessMm < 1.2) {
      parts.push(lang === "ja" ? "壁厚を1.2mm以上に増やしてください" : "Increase wall thickness to ≥1.2 mm");
    }
    if (metrics?.overhang.severity === "severe" || metrics?.overhang.severity === "moderate") {
      parts.push(lang === "ja" ? "サポート材を有効にしてください" : "Enable support structures");
    }
    if (v && !v.isWatertight) {
      parts.push(lang === "ja" ? "メッシュ修復を実行してください" : "Run mesh repair");
    }
    suggestion = parts.length > 0
      ? (lang === "ja" ? `推奨: ${parts.join("、")}` : `Suggest: ${parts.join("; ")}`)
      : (lang === "ja" ? "問題点を確認して調整してください" : "Review issues and adjust");
  }

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  const sugLines = doc.splitTextToSize(suggestion, PAGE_CW);
  if (y + sugLines.length * 4 > PAGE_BOT) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  doc.text(sugLines, PAGE_M, y);

  // ── Footer ──
  drawFooter(doc, score);

  const baseName = fileName.replace(/\.stl$/i, "");
  doc.save(`${baseName}_designer.pdf`);
}

// ─── FACTORY PDF ───────────────────────────────────────────────────────────────

async function generateFactoryPDF(
  analysis: UnifiedAnalysis,
  lang: Language,
  fileName: string
): Promise<void> {
  const { jsPDF } = await import("jspdf" as never) as { jsPDF: new (o?: object) => JsPDF };
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const { light, score } = getTrafficLight(analysis);
  const metrics = analysis.metrics?.result;
  const dims = metrics?.boundingBoxDimensionsMm;
  const pt = analysis.printTime?.result;
  const v = analysis.validation?.result;
  const t = analysis.topology?.result;
  const s = analysis.support?.result;
  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === "ja" ? "ja-JP" : "en-US", {
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
    lang === "ja" ? `問題 ${count}件` : `${count} issue(s)`,
    lang === "ja" ? "要確認" : "Review recommended",
    lang === "ja" ? "印刷可能" : "Ready to print"
  );
  const verdictDesc = vl(
    lang === "ja" ? "印刷前に修正推奨" : "Fix before print",
    lang === "ja" ? "軽微な注意点あり" : "Minor cautions",
    lang === "ja" ? "問題なし" : "No issues"
  );

  drawVerdictCard(doc, 68, 38, light, score, verdictLabel, verdictDesc);

  let y = 68 + 38 + 10;

  // ── Section: TOPOLOGY ──
  y = drawSectionHeader(doc, "TOPOLOGY", y);

  if (t) {
    y = drawDataRow(doc, "Triangles", `${t.triangleCount}`, y);
    y = drawDataRow(doc, "Vertices", `${t.vertexCount}`, y);
    y = drawDataRow(doc, "Manifold edges", `${t.manifoldEdgeCount}`, y);
    y = drawDataRow(doc, "Non-manifold edges", `${t.nonManifoldEdgeCount}`, y);
  }

  // ── Section: VALIDATION ──
  y += 4;
  y = drawSectionHeader(doc, "VALIDATION", y);

  if (v) {
    y = drawDataRow(doc, "Watertight", v.isWatertight ? "true" : "false", y, !v.isWatertight);
    y = drawDataRow(doc, "Holes", `${v.holeCount}`, y, v.holeCount > 0);
    y = drawDataRow(doc, "Flipped normal ratio", `${(v.flippedNormalRatio * 100).toFixed(2)}%`, y, v.flippedNormalRatio > 0.05);
    y = drawDataRow(doc, "Degenerate faces", `${v.degenerateFaceCount}`, y, v.degenerateFaceCount > 10);
  }

  // ── Section: METRICS ──
  y += 4;
  if (y > PAGE_BOT - 60) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  y = drawSectionHeader(doc, "METRICS", y);

  if (metrics) {
    if (dims) {
      y = drawDataRow(doc, "Dimensions", `${dims.x.toFixed(1)} × ${dims.y.toFixed(1)} × ${dims.z.toFixed(1)} mm`, y);
    }
    y = drawDataRow(doc, "Volume", metrics.meshVolumeMm3 != null ? `${(metrics.meshVolumeMm3 / 1000).toFixed(2)} cm³` : "—", y);
    y = drawDataRow(doc, "Surface area", metrics.surfaceAreaMm2 != null ? `${(metrics.surfaceAreaMm2 / 100).toFixed(2)} cm²` : "—", y);
    y = drawDataRow(doc, "Min wall thickness", metrics.minWallThicknessMm != null ? `${metrics.minWallThicknessMm.toFixed(3)} mm` : "—", y, metrics.minWallThicknessMm != null && metrics.minWallThicknessMm < 1.2);
    y = drawDataRow(doc, "Overhang faces", `${metrics.overhang.faceCount}`, y);
    y = drawDataRow(doc, "Overhang ratio", `${(metrics.overhang.ratio * 100).toFixed(1)}%`, y);
    y = drawDataRow(doc, "Overhang severity", metrics.overhang.severity, y);
  }

  // ── Section: SUPPORT ──
  y += 4;
  if (y > PAGE_BOT - 30) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  y = drawSectionHeader(doc, "SUPPORT", y);

  if (s) {
    y = drawDataRow(doc, "Difficulty", `${s.difficulty}`, y);
    y = drawDataRow(doc, "Support volume", s.totalSupportVolumeMm3 != null ? `${(s.totalSupportVolumeMm3 / 1000).toFixed(2)} cm³` : "—", y);
  }

  // ── Section: PRINT TIME & MATERIAL ──
  y += 4;
  if (y > PAGE_BOT - 60) {
    doc.addPage();
    y = PAGE_M + 6;
  }
  y = drawSectionHeader(doc, "PRINT TIME & MATERIAL", y);

  if (pt) {
    const rawMinutes = pt.estimatedPrintTimeMinutes;
    const ph = Math.floor(rawMinutes / 60);
    const pm = Math.round(rawMinutes % 60);
    y = drawDataRow(doc, "Print time", `${ph}h ${pm}m`, y);
    y = drawDataRow(doc, "Material weight", `${pt.materialWeightGrams} g`, y);
    y = drawDataRow(doc, "Material cost", `$${pt.materialCostUsd.toFixed(2)}`, y);
    y = drawDataRow(doc, "Total cost", `$${pt.totalCostUsd.toFixed(2)}`, y);
    y = drawDataRow(doc, "Layer count", `${pt.layerCount}`, y);
  }

  // ── Section: OVERHANG BREAKDOWN ──
  const ohByAngle = metrics?.overhang.breakdownByAngleDeg;
  if (ohByAngle && ohByAngle.length > 0) {
    y += 4;
    if (y > PAGE_BOT - ohByAngle.length * 7 - 20) {
      doc.addPage();
      y = PAGE_M + 6;
    }
    y = drawSectionHeader(doc, "OVERHANG BREAKDOWN", y);

    for (const row of ohByAngle) {
      y = drawDataRow(doc,
        `${row.minAngle}°–${row.maxAngle}°`,
        `${row.faceCount} faces`,
        y
      );
    }
  }

  // ── Disclaimer ──
  y += 6;
  const disclaimer = lang === "ja"
    ? `このレポートは自動推定です。実際の印刷結果は素材・スライサー設定・プリンター校正により異なる場合があります。レポート ID: ${reportId}`
    : `This report is an automated estimate. Actual print results may vary based on material, slicer settings, and printer calibration. Report ID: ${reportId}`;
  const dLines = doc.splitTextToSize(disclaimer, PAGE_CW);

  if (y + dLines.length * 4 + 4 > PAGE_BOT) {
    doc.addPage();
    y = PAGE_M + 6;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...C.faint);
  doc.text(dLines, PAGE_M, y);

  // ── Footer ──
  drawFooter(doc, score, reportId);

  const baseName = fileName.replace(/\.stl$/i, "");
  doc.save(`${baseName}_factory.pdf`);
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function ReportGenerator({
  analysis,
  chatHistory = [],
  fileName = "model.stl",
}: ReportGeneratorProps) {
  const tone = detectTone(chatHistory);
  const lang = detectLanguage(chatHistory);
  const { light, score } = getTrafficLight(analysis);

  const handleExport = useCallback(async (tier: PdfTier) => {
    if (tier === "client") {
      await generateClientPDF(analysis, lang, fileName);
    } else if (tier === "designer") {
      await generateDesignerPDF(analysis, tone, lang, fileName);
    } else {
      await generateFactoryPDF(analysis, lang, fileName);
    }
  }, [analysis, tone, lang, fileName]);

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

  const tierBtn =
    "flex-1 text-[10px] font-mono px-2 py-2 border border-border/40 bg-card text-muted-foreground hover:text-primary hover:border-primary/40 rounded-sm transition-all";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium ${lightStyles[light]}`}>
          <span className={`w-2 h-2 rounded-full ${dotStyles[light]}`} />
          {score}/100
        </div>
      </div>

      <div>
        <div className="text-[10px] font-mono text-muted-foreground/30 tracking-widest mb-2">EXPORT REPORT</div>
        <div className="flex gap-2">
          <button onClick={() => handleExport("client")} className={tierBtn}>CLIENT</button>
          <button onClick={() => handleExport("designer")} className={tierBtn}>DESIGNER</button>
          <button onClick={() => handleExport("factory")} className={tierBtn}>FACTORY</button>
        </div>
      </div>
    </div>
  );
}
