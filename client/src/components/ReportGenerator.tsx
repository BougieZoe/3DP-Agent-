/**
 * ReportGenerator.tsx
 * 
 * Drop-in PDF export component for 3DP Agent.
 * 
 * Usage:
 *   import { ReportGenerator } from './ReportGenerator'
 *   <ReportGenerator analysis={unifiedAnalysis} chatHistory={messages} fileName="part.stl" />
 * 
 * Dependencies (already in your package.json):
 *   - jspdf (install: pnpm add jspdf)
 * 
 * Types imported from your existing: client/src/analysis/types.ts
 */

import { useCallback } from "react";
import type { UnifiedAnalysis } from "../analysis/types";

// ─── Types ─────────────────────────────────────────────────────────────────────

type ToneMode = "friendly" | "professional" | "expert";
type Language = "en" | "ja";
type TrafficLight = "green" | "yellow" | "red";

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

  // Japanese character ranges: Hiragana, Katakana, CJK Unified
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

  // Expert signals: technical jargon
  const expertTerms = [
    "topology", "manifold", "watertight", "overhang angle", "infill",
    "layer height", "retraction", "wall thickness", "stl", "mesh",
    "non-manifold", "boolean", "extrusion multiplier",
    "トポロジー", "マニフォールド", "オーバーハング", "インフィル",
  ];
  const expertScore = expertTerms.filter((t) => userText.includes(t)).length;

  // Casual signals: short sentences, informal language
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

// ─── Copy ──────────────────────────────────────────────────────────────────────

const COPY = {
  en: {
    title: "Print Analysis Report",
    subtitle: "3DP Agent · Printability Assessment",
    generated: "Generated",
    file: "File",
    verdict: {
      green: { label: "Ready to Print", desc: "No critical issues detected." },
      yellow: { label: "Review Recommended", desc: "Minor issues may affect print quality." },
      red: { label: "Issues Found", desc: "Please review the findings before printing." },
    },
    sections: {
      dimensions: "Dimensions",
      geometry: "Geometry",
      printability: "Printability",
      material: "Material & Time",
      issues: "Issues",
      noIssues: "No issues detected.",
    },
    fields: {
      x: "Width", y: "Depth", z: "Height",
      volume: "Volume", surface: "Surface Area",
      watertight: "Watertight", holes: "Holes",
      minWall: "Min Wall", avgWall: "Avg Wall",
      overhang: "Overhang", support: "Support",
      weight: "Est. Weight", cost: "Est. Cost", time: "Print Time",
      yes: "Yes", no: "No", none: "None",
    },
    tone: {
      friendly: {
        wall_thin: "This part has some thin walls that might break during printing. Try making them a bit thicker.",
        not_watertight: "There are gaps in the model — it's not fully closed. This might cause printing errors.",
        holes: (n: number) => `Found ${n} hole${n > 1 ? "s" : ""} in the mesh. These should be fixed before printing.`,
        overhang_moderate: "Some areas stick out quite a bit. You'll probably need support structures.",
        overhang_severe: "Large overhanging sections detected. Support material will be required.",
        flipped: "Some surfaces are facing the wrong way, which can confuse the printer.",
      },
      professional: {
        wall_thin: "Minimum wall thickness is below the recommended 1.2 mm threshold, which may result in structural failure during printing.",
        not_watertight: "Mesh is not watertight. Open boundaries will cause slicing errors in most slicer applications.",
        holes: (n: number) => `${n} hole${n > 1 ? "s" : ""} detected. Mesh repair is recommended prior to slicing.`,
        overhang_moderate: "Moderate overhang detected. Support structures are advisable for optimal surface quality.",
        overhang_severe: "Severe overhang angle. Support structures are required to achieve a successful print.",
        flipped: "Inverted normals detected on a portion of faces, which may cause slicing artifacts.",
      },
      expert: {
        wall_thin: `Wall thickness below 1.2 mm minimum. Recommend thickening critical sections or adjusting extrusion width / wall count in slicer.`,
        not_watertight: "Non-watertight mesh with open boundary edges. Run mesh repair (MeshMixer, Netfabb, or PrusaSlicer's auto-repair) before slicing.",
        holes: (n: number) => `${n} open boundary loop${n > 1 ? "s" : ""} detected. Boolean repair or manual hole fill required.`,
        overhang_moderate: "Overhang faces >45° detected. Enable support generation; consider orientation optimization to minimize support volume.",
        overhang_severe: "Critical overhang ratio. Evaluate reorientation strategy or topology redesign to reduce support dependency.",
        flipped: `Inverted normal vectors on subset of faces. Recalculate normals or apply manifold repair pass.`,
      },
    },
  },
  ja: {
    title: "プリント分析レポート",
    subtitle: "3DP Agent · 印刷可能性評価",
    generated: "生成日時",
    file: "ファイル",
    verdict: {
      green: { label: "印刷可能", desc: "重大な問題は検出されませんでした。" },
      yellow: { label: "確認を推奨", desc: "軽微な問題が印刷品質に影響する可能性があります。" },
      red: { label: "問題が検出されました", desc: "印刷前に以下の問題を確認してください。" },
    },
    sections: {
      dimensions: "寸法",
      geometry: "ジオメトリ",
      printability: "印刷可能性",
      material: "素材・時間",
      issues: "問題点",
      noIssues: "問題は検出されませんでした。",
    },
    fields: {
      x: "幅", y: "奥行き", z: "高さ",
      volume: "体積", surface: "表面積",
      watertight: "密閉性", holes: "ホール",
      minWall: "最小壁厚", avgWall: "平均壁厚",
      overhang: "オーバーハング", support: "サポート",
      weight: "推定重量", cost: "推定コスト", time: "印刷時間",
      yes: "あり", no: "なし", none: "なし",
    },
    tone: {
      friendly: {
        wall_thin: "一部の壁が薄すぎて、印刷中に折れる可能性があります。少し厚くすることをお勧めします。",
        not_watertight: "モデルに隙間があり、完全に閉じていません。印刷エラーの原因になります。",
        holes: (n: number) => `メッシュに${n}個の穴があります。印刷前に修正してください。`,
        overhang_moderate: "かなり張り出している部分があります。サポート構造が必要になるかもしれません。",
        overhang_severe: "大きなオーバーハング部分があります。サポート材が必要です。",
        flipped: "一部の面が逆向きです。プリンターが混乱する可能性があります。",
      },
      professional: {
        wall_thin: "最小壁厚が推奨値1.2mm未満です。印刷中に構造的な破損が生じる可能性があります。",
        not_watertight: "メッシュが密閉されていません。スライサーでエラーが発生する可能性があります。",
        holes: (n: number) => `${n}個のホールが検出されました。スライス前にメッシュの修復をお勧めします。`,
        overhang_moderate: "中程度のオーバーハングが検出されました。最適な表面品質のためにサポート構造を推奨します。",
        overhang_severe: "深刻なオーバーハング角度です。印刷を成功させるためにサポート構造が必要です。",
        flipped: "一部の面で法線が反転しています。スライスアーティファクトの原因になる可能性があります。",
      },
      expert: {
        wall_thin: "壁厚1.2mm未満。押出幅やウォール数をスライサーで調整するか、該当部分を厚くすることを推奨します。",
        not_watertight: "非密閉メッシュ。MeshMixer、Netfabb、またはPrusaSlicerの自動修復でメッシュ修復を実行してください。",
        holes: (n: number) => `${n}個のオープンバウンダリループを検出。ブーリアン修復または手動ホールフィルが必要です。`,
        overhang_moderate: "45°超の面を検出。サポート生成を有効化し、サポート体積を最小化する向き最適化を検討してください。",
        overhang_severe: "重大なオーバーハング比。リオリエンテーション戦略またはトポロジー再設計を評価してください。",
        flipped: "一部の面で法線ベクトルが反転。法線の再計算またはマニフォールド修復パスを適用してください。",
      },
    },
  },
};

// ─── Issue Builder (with measured values) ─────────────────────────────────────

function buildIssues(
  analysis: UnifiedAnalysis,
  _tone: ToneMode,
  lang: Language
): string[] {
  const issues: string[] = [];
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;

  if (m && m.minWallThicknessMm !== null && m.minWallThicknessMm < 1.2) {
    const val = m.minWallThicknessMm.toFixed(2);
    issues.push(
      lang === "ja"
        ? `壁厚 ${val} mm — 推奨最小値は 1.2 mm です。印刷中に破損する可能性があります。`
        : `Wall thickness ${val} mm — minimum safe is 1.2 mm. This part will likely break during printing.`
    );
  }

  if (v && !v.isWatertight) {
    issues.push(
      lang === "ja"
        ? "メッシュが密閉されていません。スライサーでエラーが発生する可能性があります。"
        : "Mesh is not watertight. Open boundaries will cause slicing errors in most slicer applications."
    );
    if (v.holeCount > 0) {
      issues.push(
        lang === "ja"
          ? `メッシュに${v.holeCount}個の穴があります。印刷前に修正してください。`
          : `${v.holeCount} hole${v.holeCount > 1 ? "s" : ""} detected in the mesh. These should be repaired before printing.`
      );
    }
  } else if (v && v.holeCount > 0) {
    issues.push(
      lang === "ja"
        ? `メッシュに${v.holeCount}個の穴があります。印刷前に修正してください。`
        : `${v.holeCount} hole${v.holeCount > 1 ? "s" : ""} detected in the mesh. These should be repaired before printing.`
    );
  }

  if (v && v.flippedNormalRatio > 0.05) {
    const pct = (v.flippedNormalRatio * 100).toFixed(0);
    issues.push(
      lang === "ja"
        ? `面の${pct}%で法線が反転しています。スライスアーティファクトの原因になる可能性があります。`
        : `Inverted normals detected on ${pct}% of faces, which may cause slicing artifacts.`
    );
  }

  if (m) {
    if (m.overhang.severity === "severe") {
      issues.push(
        lang === "ja"
          ? "深刻なオーバーハング角度です。印刷を成功させるためにサポート構造が必要です。"
          : "Severe overhang detected. Support structures are required to achieve a successful print."
      );
    } else if (m.overhang.severity === "moderate") {
      issues.push(
        lang === "ja"
          ? "中程度のオーバーハングが検出されました。サポート構造を推奨します。"
          : "Moderate overhang detected. Support structures are advisable for optimal surface quality."
      );
    }
  }

  return issues;
}

// ─── PDF Generation (Japanese-style single-page layout) ──────────────────────

async function generatePDF(
  analysis: UnifiedAnalysis,
  _tone: ToneMode,
  lang: Language,
  fileName: string
): Promise<void> {
  const { jsPDF } = await import("jspdf" as never) as { jsPDF: new (o?: object) => jsPDFInstance };

  interface jsPDFInstance {
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

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();  // 210
  const H = doc.internal.pageSize.getHeight();  // 297
  const M = 20;
  const CW = W - 2 * M;

  const { light, score } = getTrafficLight(analysis);
  const issues = buildIssues(analysis, _tone, lang);
  const metrics = analysis.metrics?.result;
  const dims = metrics?.boundingBoxDimensionsMm;
  const printTime = analysis.printTime?.result;

  // ── Palette ──
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

  const accent: [number, number, number] = { red: C.red, yellow: C.yellow, green: C.green }[light];
  const lightBg: [number, number, number] = { red: C.lightRed, yellow: C.lightYellow, green: C.lightGreen }[light];
  const RED: [number, number, number] = C.red;

  // ── Verdict text ──
  const count = issues.length;
  const verdictLabel = {
    red:    lang === "ja" ? "問題が検出されました — 印刷しないでください" : "Issues found — do not print yet",
    yellow: lang === "ja" ? "確認を推奨" : "Review recommended",
    green:  lang === "ja" ? "印刷可能" : "Ready to print",
  }[light];

  const verdictDesc = {
    red:    lang === "ja" ? `${count}件の問題が印刷前に確認が必要です` : `${count} issue${count !== 1 ? "s" : ""} require attention before printing`,
    yellow: lang === "ja" ? "軽微な問題が印刷品質に影響する可能性があります" : "Minor issues may affect print quality",
    green:  lang === "ja" ? "重大な問題は検出されませんでした" : "No critical issues detected",
  }[light];

  // ── Date ──
  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === "ja" ? "ja-JP" : "en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  // ════════════════════════════════ PAGE 1 ═════════════════════════════════

  // ── Header bg (#F1EFE8) ──
  doc.setFillColor(...C.headerBg);
  doc.rect(0, 0, W, 55, "F");

  // Overline
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  doc.text(lang === "ja" ? "3DP AGENT · 印刷可能性評価" : "3DP AGENT · PRINTABILITY ASSESSMENT", M, 13);

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...C.ink);
  doc.text(lang === "ja" ? "プリント分析レポート" : "Print Analysis Report", M, 28);

  // File name + date
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(`${fileName} · ${dateStr}`, M, 40);

  // Traffic light line
  doc.setFillColor(...accent);
  doc.rect(0, 55, W, 3, "F");

  // ── Verdict Card ──
  const cardY = 64;
  const cardH = 44;

  doc.setFillColor(...lightBg);
  doc.rect(M, cardY, CW, cardH, "F");

  // Left circle badge
  const cx = 38;
  const cy = cardY + cardH / 2;
  const cr = 16;

  doc.setFillColor(...accent);
  doc.circle(cx, cy, cr, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...C.white);
  doc.text(`${score}`, cx, cy + 1, { align: "center" });

  // Middle verdict text (large + small)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...C.ink);
  doc.text(verdictLabel, 62, cardY + 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(verdictDesc, 62, cardY + 28);

  // Right score (large)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(...accent);
  doc.text(`${score}`, W - M, cardY + cardH / 2 + 1, { align: "right" });

  // ── Dimensions (3 rows) ──
  let y = cardY + cardH + 12;

  if (dims) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "幅 × 奥行き × 高さ" : "Width × Depth × Height", M, y);
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

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...C.muted);
    doc.text(lang === "ja" ? "推定重量" : "Est. weight", M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.ink);
    const wt = printTime?.materialWeightGrams != null ? printTime.materialWeightGrams.toFixed(1) : "—";
    doc.text(`${wt} g`, W - M, y, { align: "right" });
    y += 10;
  }

  // ── Issues Section ──
  y += 4;

  // Pre-calculate total issues height
  const HEADER_H = 12;
  let issuesTotalH = issues.length > 0 ? HEADER_H : HEADER_H + 8;
  const prepLines: string[][] = [];

  for (const issue of issues) {
    const lines = doc.splitTextToSize(issue, CW - 22);
    prepLines.push(lines);
    issuesTotalH += 6 + lines.length * 5 + 3;
  }

  const PAGE_BOTTOM = 273;

  /**
   * Draw all issues + disclaimer on the current page starting at `startY`.
   * Returns the y-coordinate after the disclaimer.
   */
  const drawIssuesAndDisclaimer = (startY: number): number => {
    let py = startY;

    // Section header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...C.ink);
    doc.text(lang === "ja" ? "問題点" : "Issues Found", M, py);
    py += 10;

    if (issues.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...C.muted);
      doc.text(lang === "ja" ? "問題は検出されませんでした" : "No issues detected.", M, py);
      py += 8;
    } else {
      for (let i = 0; i < issues.length; i++) {
        const lines = prepLines[i];

        // Red square badge
        doc.setFillColor(...RED);
        doc.rect(M, py - 2, 7, 7, "F");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...C.white);
        doc.text(`${i + 1}`, M + 3.5, py + 1.5, { align: "center" });

        // Issue text
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...C.ink);
        doc.text(lines, M + 14, py + 0.5);

        py += 6 + lines.length * 5 + 3;
      }
    }

    // ── Disclaimer ──
    py += 4;
    const reportId = `3DP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(Math.floor(Math.random() * 9000 + 1000))}`;
    const disclaimer = lang === "ja"
      ? `このレポートは自動推定です。実際の印刷結果は素材・スライサー設定・プリンター校正により異なる場合があります。レポート ID: ${reportId}`
      : `This report is an automated estimate. Actual print results may vary based on material, slicer settings, and printer calibration. Report ID: ${reportId}`;
    const dLines = doc.splitTextToSize(disclaimer, CW);

    if (py + dLines.length * 4 + 4 > PAGE_BOTTOM) {
      doc.addPage();
      py = 25;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text(dLines, M, py);
    py += dLines.length * 4 + 4;

    return py;
  };

  if (issues.length === 0) {
    // No issues → everything always fits on page 1
    drawIssuesAndDisclaimer(y);
  } else if (y + issuesTotalH <= PAGE_BOTTOM) {
    // All issues fit on page 1
    drawIssuesAndDisclaimer(y);
  } else {
    // Issues overflow → draw nothing issues-related on page 1,
    // add page 2 for all issues + disclaimer
    doc.addPage();
    drawIssuesAndDisclaimer(25);
  }

  // ── Footer on every page ──
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

  // ── Save ──
  const baseName = fileName.replace(/\.stl$/i, "");
  doc.save(`${baseName}_report.pdf`);
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

  const handleExport = useCallback(async () => {
    await generatePDF(analysis, tone, lang, fileName);
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

  return (
    <div className="flex items-center gap-3">
      {/* Score pill */}
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium ${lightStyles[light]}`}>
        <span className={`w-2 h-2 rounded-full ${dotStyles[light]}`} />
        {score}/100
      </div>

      {/* Export button */}
      <button
        onClick={handleExport}
        className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1v8M4 6l3 3 3-3M2 10v2a1 1 0 001 1h8a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Export PDF
      </button>
    </div>
  );
}