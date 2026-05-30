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

// ─── Issue Builder ─────────────────────────────────────────────────────────────

function buildIssues(
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
        ? `壁厚 ${m.minWallThicknessMm.toFixed(2)} mm — 推奨最小値 1.2 mm`
        : `Wall ${m.minWallThicknessMm.toFixed(2)} mm — minimum safe is 1.2 mm`
    );
  }

  if (v && !v.isWatertight) {
    issues.push(
      lang === "ja" ? "メッシュ未密閉" : "Mesh not watertight"
    );
    if (v.holeCount > 0) {
      issues.push(
        lang === "ja"
          ? `${v.holeCount}個の穴`
          : `${v.holeCount} hole${v.holeCount > 1 ? "s" : ""}`
      );
    }
  } else if (v && v.holeCount > 0) {
    issues.push(
      lang === "ja"
        ? `${v.holeCount}個の穴`
        : `${v.holeCount} hole${v.holeCount > 1 ? "s" : ""}`
    );
  }

  if (v && v.flippedNormalRatio > 0.05) {
    issues.push(
      lang === "ja"
        ? `面の${(v.flippedNormalRatio * 100).toFixed(0)}% で法線反転`
        : `${(v.flippedNormalRatio * 100).toFixed(0)}% faces inverted`
    );
  }

  if (m) {
    if (m.overhang.severity === "severe") {
      issues.push(lang === "ja" ? "深刻なオーバーハング" : "Severe overhang");
    } else if (m.overhang.severity === "moderate") {
      issues.push(lang === "ja" ? "中程度のオーバーハング" : "Moderate overhang");
    }
  }

  return issues;
}

// ─── Shared PDF helpers ────────────────────────────────────────────────────────

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

const C = {
  red:       [226,  75,  74] as [number, number, number],
  yellow:    [239, 159,  39] as [number, number, number],
  green:     [ 99, 153,  34] as [number, number, number],
  lightRed:  [253, 237, 237] as [number, number, number],
  lightYellow: [254, 246, 223] as [number, number, number],
  lightGreen: [238, 245, 225] as [number, number, number],
  headerBg:  [241, 239, 232] as [number, number, number],
  footerBg:  [245, 244, 239] as [number, number, number],
  ink:       [ 30,  30,  30] as [number, number, number],
  muted:     [110, 110, 110] as [number, number, number],
  white:     [255, 255, 255] as [number, number, number],
};

function drawHeader(doc: JsPDF, W: number, lang: Language, fileName: string, dateStr: string, tierLabel: string) {
  doc.setFillColor(...C.headerBg);
  doc.rect(0, 0, W, 55, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  doc.text(lang === "ja" ? "3DP AGENT · 印刷可能性評価" : "3DP AGENT · PRINTABILITY ASSESSMENT", 20, 13);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...C.ink);
  doc.text(lang === "ja" ? "プリント分析レポート" : "Print Analysis Report", 20, 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(`${fileName} · ${dateStr}`, 20, 40);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  doc.text(tierLabel.toUpperCase(), W - 20, 13, { align: "right" });
}

function drawFooter(doc: JsPDF, H: number, W: number, M: number, score: number) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(...C.footerBg);
    doc.rect(0, H - 15, W, 15, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text("3DP AGENT · 3dp-agent.vercel.app", M, H - 5);
    doc.setFont("helvetica", "bold");
    doc.text(`${score} / 100`, W - M, H - 5, { align: "right" });
  }
}

function drawVerdictCard(doc: JsPDF, M: number, CW: number, cardY: number, cardH: number, light: TrafficLight, score: number, verdictLabel: string, verdictDesc: string, W: number) {
  const accent: [number, number, number] = { red: C.red, yellow: C.yellow, green: C.green }[light];
  const lightBg: [number, number, number] = { red: C.lightRed, yellow: C.lightYellow, green: C.lightGreen }[light];

  doc.setFillColor(...lightBg);
  doc.rect(M, cardY, CW, cardH, "F");

  const cx = 38;
  const cy = cardY + cardH / 2;
  const cr = 16;

  doc.setFillColor(...accent);
  doc.circle(cx, cy, cr, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...C.white);
  doc.text(`${score}`, cx, cy + 1, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...C.ink);
  doc.text(verdictLabel, 62, cardY + 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(verdictDesc, 62, cardY + 28);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(...accent);
  doc.text(`${score}`, W - M, cardY + cardH / 2 + 1, { align: "right" });

  // Traffic light line under header
  doc.setFillColor(...accent);
  doc.rect(0, 55, W, 3, "F");
}

// ─── CLIENT PDF ────────────────────────────────────────────────────────────────

async function generateClientPDF(
  analysis: UnifiedAnalysis,
  lang: Language,
  fileName: string
): Promise<void> {
  const { jsPDF } = await import("jspdf" as never) as { jsPDF: new (o?: object) => JsPDF };
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 20;
  const CW = W - 2 * M;

  const { light, score } = getTrafficLight(analysis);
  const metrics = analysis.metrics?.result;
  const dims = metrics?.boundingBoxDimensionsMm;
  const pt = analysis.printTime?.result;
  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === "ja" ? "ja-JP" : "en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const issues = buildIssues(analysis, "friendly", lang);
  const count = issues.length;

  const verdictLabel = {
    red:    lang === "ja" ? "印刷には不向きです" : "Not ready to print",
    yellow: lang === "ja" ? "要確認" : "Review recommended",
    green:  lang === "ja" ? "印刷可能です" : "Ready to print",
  }[light];

  const verdictDesc = {
    red:    lang === "ja" ? `${count}件の問題があります` : `${count} issue${count !== 1 ? "s" : ""} found`,
    yellow: lang === "ja" ? "軽微な問題があります" : "Minor issues found",
    green:  lang === "ja" ? "特に問題はありません" : "No issues detected",
  }[light];

  drawHeader(doc, W, lang, fileName, dateStr, "client summary");
  drawVerdictCard(doc, M, CW, 64, 44, light, score, verdictLabel, verdictDesc, W);

  let y = 64 + 44 + 12;

  if (dims) {
    // Size in plain language
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "サイズ" : "Size", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.ink);
    doc.text(`${dims.x.toFixed(0)} × ${dims.y.toFixed(0)} × ${dims.z.toFixed(0)} mm`, W - M, y, { align: "right" });
    y += 10;

    // Weight range
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "重さ" : "Weight", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.ink);
    doc.text(pt?.materialWeightGrams != null ? computeWeightRange(pt.materialWeightGrams) : "—", W - M, y, { align: "right" });
    y += 10;

    // Time range
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "印刷時間" : "Print time", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.ink);
    doc.text(pt?.estimatedPrintTimeMinutes != null ? computeTimeRange(pt.estimatedPrintTimeMinutes) : "—", W - M, y, { align: "right" });
    y += 10;
  }

  y += 6;

  // Plain language assessment
  const wallOk = metrics?.minWallThicknessMm == null || metrics.minWallThicknessMm >= 1.2;
  const ohSevere = metrics?.overhang.severity === "severe";
  const ohModerate = metrics?.overhang.severity === "moderate";
  const watertight = analysis.validation?.result?.isWatertight ?? true;

  let assessment: string;
  if (light === "green") {
    assessment = lang === "ja"
      ? "このパーツは問題なく印刷できます。特別な調整は必要ありません。"
      : "This part looks good to print. No special adjustments needed.";
  } else if (light === "red") {
    assessment = lang === "ja"
      ? "いくつかの問題があります。印刷前に修正することをおすすめします。"
      : "There are some issues to address before printing.";
  } else {
    assessment = lang === "ja"
      ? "おおむね良好ですが、いくつか気をつける点があります。"
      : "Mostly fine, but a few things to watch out for.";
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...C.ink);
  const assessLines = doc.splitTextToSize(assessment, CW);
  doc.text(assessLines, M, y);
  y += assessLines.length * 5 + 6;

  // Recommendation
  let rec: string;
  if (light === "green") {
    rec = lang === "ja" ? "この設定で問題なく印刷を始められます。" : "You're good to go with your current settings.";
  } else if (!wallOk && (ohSevere || ohModerate)) {
    rec = lang === "ja"
      ? "壁を少し厚くし、サポート材を使うことをおすすめします。"
      : "Consider thickening thin walls and using supports for overhangs.";
  } else if (!wallOk) {
    rec = lang === "ja"
      ? "壁の厚さを確認し、必要に応じて補強してください。"
      : "Check the wall thickness and reinforce if needed.";
  } else if (ohSevere || ohModerate) {
    rec = lang === "ja"
      ? "サポート材を有効にして印刷してください。"
      : "Enable support structures for the overhanging areas.";
  } else if (!watertight) {
    rec = lang === "ja"
      ? "モデルの隙間を埋めてから印刷してください。"
      : "Fill any gaps in the model before printing.";
  } else {
    rec = lang === "ja"
      ? "問題点を確認し、必要に応じて修正してください。"
      : "Review the issues and make adjustments as needed.";
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  const recLines = doc.splitTextToSize(rec, CW);
  doc.text(recLines, M, y);

  drawFooter(doc, H, W, M, score);

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
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 20;
  const CW = W - 2 * M;

  const { light, score } = getTrafficLight(analysis);
  const metrics = analysis.metrics?.result;
  const dims = metrics?.boundingBoxDimensionsMm;
  const pt = analysis.printTime?.result;
  const v = analysis.validation?.result;
  const s = analysis.support?.result;
  const issues = buildIssues(analysis, tone, lang);
  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === "ja" ? "ja-JP" : "en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const count = issues.length;
  const verdictLabel = {
    red:    lang === "ja" ? "問題が検出されました" : "Issues found",
    yellow: lang === "ja" ? "確認を推奨" : "Review recommended",
    green:  lang === "ja" ? "印刷可能" : "Ready to print",
  }[light];
  const verdictDesc = {
    red:    lang === "ja" ? `${count}件の問題` : `${count} issue${count !== 1 ? "s" : ""}`,
    yellow: lang === "ja" ? "軽微な問題" : "Minor issues",
    green:  lang === "ja" ? "問題なし" : "No issues",
  }[light];

  drawHeader(doc, W, lang, fileName, dateStr, "designer review");
  drawVerdictCard(doc, M, CW, 64, 44, light, score, verdictLabel, verdictDesc, W);

  let y = 64 + 44 + 12;

  // Dimensions + Volume
  if (dims) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "サイズ" : "Dimensions", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.ink);
    doc.text(`${dims.x.toFixed(1)} × ${dims.y.toFixed(1)} × ${dims.z.toFixed(1)} mm`, W - M, y, { align: "right" });
    y += 10;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "体積" : "Volume", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.ink);
    const vol = metrics?.meshVolumeMm3 != null ? (metrics.meshVolumeMm3 / 1000).toFixed(2) : "—";
    doc.text(`${vol} cm³`, W - M, y, { align: "right" });
    y += 10;

    // Weight range
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "重量" : "Weight", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.ink);
    doc.text(pt?.materialWeightGrams != null ? computeWeightRange(pt.materialWeightGrams) : "—", W - M, y, { align: "right" });
    y += 10;

    // Time range
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "印刷時間" : "Print time", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.ink);
    doc.text(pt?.estimatedPrintTimeMinutes != null ? computeTimeRange(pt.estimatedPrintTimeMinutes) : "—", W - M, y, { align: "right" });
    y += 10;
  }

  // Key metrics section
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.ink);
  doc.text(lang === "ja" ? "主要指標" : "Key Metrics", M, y);
  y += 10;

  // Wall thickness
  if (metrics?.minWallThicknessMm != null) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "最小壁厚" : "Min wall thickness", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.ink);
    const wallStatus = metrics.minWallThicknessMm < 1.2 ? " (!)" : "";
    doc.text(`${metrics.minWallThicknessMm.toFixed(2)} mm${wallStatus}`, W - M, y, { align: "right" });
    y += 9;
  }

  // Overhang
  if (metrics) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "オーバーハング" : "Overhang", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.ink);
    doc.text(`${metrics.overhang.faceCount} faces · ${metrics.overhang.severity}`, W - M, y, { align: "right" });
    y += 9;
  }

  // Support
  if (s) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "サポート" : "Support", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.ink);
    const diffLabel = s.difficulty === "easy" ? "Easy" : s.difficulty === "moderate" ? "Moderate" : s.difficulty === "difficult" ? "Difficult" : "Very difficult";
    doc.text(diffLabel, W - M, y, { align: "right" });
    y += 9;
  }

  // Watertight
  if (v) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "密閉性" : "Watertight", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.ink);
    doc.text(v.isWatertight ? (lang === "ja" ? "〇" : "Yes") : (lang === "ja" ? "×" : "No"), W - M, y, { align: "right" });
    y += 9;
  }

  // Issues section
  y += 6;

  if (issues.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...C.ink);
    doc.text(lang === "ja" ? "問題点" : "Issues", M, y);
    y += 10;

    for (let i = 0; i < issues.length; i++) {
      const lines = doc.splitTextToSize(issues[i], CW - 22);

      doc.setFillColor(...C.red);
      doc.rect(M, y - 2, 7, 7, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...C.white);
      doc.text(`${i + 1}`, M + 3.5, y + 1.5, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...C.ink);
      doc.text(lines, M + 14, y + 0.5);

      y += 6 + lines.length * 5 + 3;
    }
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...C.ink);
    doc.text(lang === "ja" ? "問題点" : "Issues", M, y);
    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "問題は検出されませんでした" : "No issues detected.", M, y);
    y += 8;
  }

  // Suggestions
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

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  const sugLines = doc.splitTextToSize(suggestion, CW);
  doc.text(sugLines, M, y);

  drawFooter(doc, H, W, M, score);

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
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 20;
  const CW = W - 2 * M;

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

  drawHeader(doc, W, lang, fileName, dateStr, "factory data");

  // --- PAGE 1: verdict + topology + validation ---

  const { light: _, ...verdict } = getTrafficLight(analysis);
  const count = (() => {
    const issues = buildIssues(analysis, "expert", lang);
    return issues.length;
  })();
  const verdictLabel = {
    red:    lang === "ja" ? `問題 ${count}件` : `${count} issue(s)`,
    yellow: lang === "ja" ? "要確認" : "Review recommended",
    green:  lang === "ja" ? "印刷可能" : "Ready to print",
  }[light];
  const verdictDesc = {
    red:    lang === "ja" ? "印刷前に修正推奨" : "Fix before print",
    yellow: lang === "ja" ? "軽微な注意点あり" : "Minor cautions",
    green:  lang === "ja" ? "問題なし" : "No issues",
  }[light];

  drawVerdictCard(doc, M, CW, 64, 44, light, score, verdictLabel, verdictDesc, W);

  let y = 64 + 44 + 12;

  // ── Topology ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.ink);
  doc.text("TOPOLOGY", M, y);
  y += 9;

  if (t) {
    const rows: [string, string][] = [
      ["Triangles", `${t.triangleCount}`],
      ["Vertices",  `${t.vertexCount}`],
      ["Manifold edges", `${t.manifoldEdgeCount}`],
      ["Non-manifold edges", `${t.nonManifoldEdgeCount}`],
    ];
    for (const [k, val] of rows) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text(k, M, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...C.ink);
      doc.text(val, W - M, y, { align: "right" });
      y += 7;
    }
    y += 4;
  }

  // ── Validation ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.ink);
  doc.text("VALIDATION", M, y);
  y += 9;

  if (v) {
    const rows: [string, string][] = [
      ["Watertight", v.isWatertight ? "true" : "false"],
      ["Holes", `${v.holeCount}`],
      ["Flipped normal ratio", `${(v.flippedNormalRatio * 100).toFixed(2)}%`],
      ["Degenerate faces", `${v.degenerateFaceCount}`],
    ];
    for (const [k, val] of rows) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text(k, M, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...C.ink);
      doc.text(val, W - M, y, { align: "right" });
      y += 7;
    }
    y += 4;
  }

  // Check if we need page 2 for metrics + support + print time
  const needsPage2 = y > 200;

  if (needsPage2) {
    doc.addPage();
    y = 25;
  } else {
    y += 2;
  }

  // ── Metrics ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.ink);
  doc.text("METRICS", M, y);
  y += 9;

  if (metrics) {
    const vol = metrics.meshVolumeMm3 != null ? `${(metrics.meshVolumeMm3 / 1000).toFixed(2)} cm³` : "—";
    const sa = metrics.surfaceAreaMm2 != null ? `${(metrics.surfaceAreaMm2 / 100).toFixed(2)} cm²` : "—";
    const rows: [string, string][] = [
      ["Volume", vol],
      ["Surface area", sa],
      ["Min wall thickness", metrics.minWallThicknessMm != null ? `${metrics.minWallThicknessMm.toFixed(3)} mm` : "—"],
      ["Overhang faces", `${metrics.overhang.faceCount}`],
      ["Overhang ratio", `${(metrics.overhang.ratio * 100).toFixed(1)}%`],
      ["Overhang severity", metrics.overhang.severity],
    ];
    if (dims) {
      rows.unshift(["Dimensions", `${dims.x.toFixed(1)} × ${dims.y.toFixed(1)} × ${dims.z.toFixed(1)} mm`]);
    }
    for (const [k, val] of rows) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text(k, M, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...C.ink);
      doc.text(val, W - M, y, { align: "right" });
      y += 7;
    }
    y += 4;
  }

  // ── Support ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.ink);
  doc.text("SUPPORT", M, y);
  y += 9;

  if (s) {
    const rows: [string, string][] = [
      ["Difficulty", `${s.difficulty}`],
      ["Support volume", s.totalSupportVolumeMm3 != null ? `${(s.totalSupportVolumeMm3 / 1000).toFixed(2)} cm³` : "—"],
    ];
    for (const [k, val] of rows) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text(k, M, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...C.ink);
      doc.text(val, W - M, y, { align: "right" });
      y += 7;
    }
    y += 4;
  }

  // ── Print Time ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.ink);
  doc.text("PRINT TIME & MATERIAL", M, y);
  y += 9;

  if (pt) {
    const rawMinutes = pt.estimatedPrintTimeMinutes;
    const ph = Math.floor(rawMinutes / 60);
    const pm = Math.round(rawMinutes % 60);
    const rows: [string, string][] = [
      ["Print time", `${ph}h ${pm}m`],
      ["Material weight", `${pt.materialWeightGrams} g`],
      ["Material cost", `$${pt.materialCostUsd.toFixed(2)}`],
      ["Total cost", `$${pt.totalCostUsd.toFixed(2)}`],
      ["Layer count", `${pt.layerCount}`],
      ["Printer", `${pt.printerProfile.name}`],
    ];
    for (const [k, val] of rows) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text(k, M, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...C.ink);
      doc.text(val, W - M, y, { align: "right" });
      y += 7;
    }
    y += 4;
  }

  // Overhang angle breakdown
  const ohByAngle = metrics?.overhang.breakdownByAngleDeg;
  if (ohByAngle && ohByAngle.length > 0) {
    // Check page space
    const needed = 12 + ohByAngle.length * 7 + 8;
    if (y + needed > 260) {
      doc.addPage();
      y = 25;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...C.ink);
    doc.text("OVERHANG BREAKDOWN", M, y);
    y += 9;

    for (const row of ohByAngle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text(`${row.minAngle}°–${row.maxAngle}°`, M, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...C.ink);
      doc.text(`${row.faceCount} faces`, W - M, y, { align: "right" });
      y += 7;
    }
    y += 6;
  }

  // ── Disclaimer on page 2+ ──
  // Ensure we're on the last page for disclaimer
  const disclaimer = lang === "ja"
    ? `このレポートは自動推定です。実際の印刷結果は素材・スライサー設定・プリンター校正により異なる場合があります。レポート ID: ${reportId}`
    : `This report is an automated estimate. Actual print results may vary based on material, slicer settings, and printer calibration. Report ID: ${reportId}`;
  const dLines = doc.splitTextToSize(disclaimer, CW);

  if (y + dLines.length * 4 + 8 > H - 20) {
    doc.addPage();
    y = 25;
  }

  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  doc.text(dLines, M, y);

  drawFooter(doc, H, W, M, score);

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
      {/* Score pill */}
      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium ${lightStyles[light]}`}>
          <span className={`w-2 h-2 rounded-full ${dotStyles[light]}`} />
          {score}/100
        </div>
      </div>

      {/* Three-tier export */}
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
