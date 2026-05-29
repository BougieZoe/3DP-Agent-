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
import type { UnifiedAnalysis } from "./analysis/types";

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

// ─── Issue Builder ─────────────────────────────────────────────────────────────

function buildIssues(
  analysis: UnifiedAnalysis,
  tone: ToneMode,
  lang: Language
): string[] {
  const issues: string[] = [];
  const t = COPY[lang].tone[tone];
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;

  if (v) {
    if (!v.isWatertight) issues.push(t.not_watertight);
    if (v.holeCount > 0) issues.push(t.holes(v.holeCount));
    if (v.flippedNormalRatio > 0.05) issues.push(t.flipped);
  }

  if (m) {
    if (m.minWallThicknessMm !== null && m.minWallThicknessMm < 1.2)
      issues.push(t.wall_thin);
    if (m.overhang.severity === "severe") issues.push(t.overhang_severe);
    else if (m.overhang.severity === "moderate") issues.push(t.overhang_moderate);
  }

  return issues;
}

// ─── PDF Generation ────────────────────────────────────────────────────────────

async function generatePDF(
  analysis: UnifiedAnalysis,
  tone: ToneMode,
  lang: Language,
  fileName: string
): Promise<void> {
  // Dynamic import — only loads jspdf when user clicks export
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
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const copy = COPY[lang];
  const { light, score } = getTrafficLight(analysis);
  const issues = buildIssues(analysis, tone, lang);
  const metrics = analysis.metrics?.result;
  const dims = metrics?.boundingBoxDimensionsMm;
  const printTime = analysis.printTime?.result;
  const support = analysis.support?.result;
  const W = doc.internal.pageSize.getWidth();

  // ── Palette ──
  const COLORS = {
    ink: [20, 20, 20] as [number, number, number],
    muted: [120, 120, 110] as [number, number, number],
    rule: [220, 218, 210] as [number, number, number],
    pageBg: [252, 251, 249] as [number, number, number],
    green: [15, 110, 86] as [number, number, number],
    greenBg: [234, 243, 222] as [number, number, number],
    yellow: [133, 79, 11] as [number, number, number],
    yellowBg: [250, 238, 218] as [number, number, number],
    red: [163, 45, 45] as [number, number, number],
    redBg: [252, 235, 235] as [number, number, number],
  };

  const lightColor = {
    green: { fg: COLORS.green, bg: COLORS.greenBg },
    yellow: { fg: COLORS.yellow, bg: COLORS.yellowBg },
    red: { fg: COLORS.red, bg: COLORS.redBg },
  }[light];

  // ── Page Background ──
  doc.setFillColor(...COLORS.pageBg);
  doc.rect(0, 0, W, 297, "F");

  // ── Header Bar ──
  doc.setFillColor(...lightColor.bg);
  doc.rect(0, 0, W, 52, "F");

  // ── Title ──
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(copy.subtitle.toUpperCase(), 20, 16);

  doc.setFontSize(22);
  doc.setTextColor(...lightColor.fg);
  doc.setFont("helvetica", "bold");
  doc.text(copy.title, 20, 30);

  // ── File Name ──
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.muted);
  doc.text(`${copy.file}: ${fileName}`, 20, 40);

  // ── Timestamp ──
  const ts = new Date().toLocaleString(lang === "ja" ? "ja-JP" : "en-US", {
    dateStyle: "medium", timeStyle: "short",
  });
  doc.text(`${copy.generated}: ${ts}`, 20, 47);

  let y = 68;

  // ─── Verdict Card ───
  doc.setFillColor(...lightColor.fg);
  doc.rect(20, y, W - 40, 22, "F");

  // Traffic light indicator
  const dotColors = { green: [15, 160, 110], yellow: [234, 159, 39], red: [220, 70, 70] };
  doc.setFillColor(...(dotColors[light] as [number, number, number]));
  doc.rect(20, y, 6, 22, "F"); // left accent stripe

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text(copy.verdict[light].label, 32, y + 10);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(copy.verdict[light].desc, 32, y + 17);

  // Score (right-aligned)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(`${score}`, W - 28, y + 13, { align: "right" });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("/ 100", W - 22, y + 13);

  y += 32;

  // ─── Helper: Section Header ───
  const sectionHeader = (title: string) => {
    doc.setDrawColor(...COLORS.rule);
    doc.setLineWidth(0.3);
    doc.line(20, y, W - 20, y);
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.muted);
    doc.text(title.toUpperCase(), 20, y);
    y += 6;
    doc.setTextColor(...COLORS.ink);
  };

  // ─── Helper: Data Row ───
  const dataRow = (label: string, value: string, indent = 20) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.muted);
    doc.text(label, indent, y);
    doc.setTextColor(...COLORS.ink);
    doc.setFont("helvetica", "bold");
    doc.text(value, W - 20, y, { align: "right" });
    y += 6;
  };

  // ─── Dimensions ───
  if (dims) {
    sectionHeader(copy.sections.dimensions);
    dataRow(`${copy.fields.x} (X)`, `${dims.x.toFixed(1)} mm`);
    dataRow(`${copy.fields.y} (Y)`, `${dims.y.toFixed(1)} mm`);
    dataRow(`${copy.fields.z} (Z)`, `${dims.z.toFixed(1)} mm`);
    y += 4;
  }

  // ─── Geometry ───
  if (metrics) {
    sectionHeader(copy.sections.geometry);
    dataRow(copy.fields.volume, `${(metrics.meshVolumeMm3 / 1000).toFixed(2)} cm³`);
    dataRow(copy.fields.surface, `${(metrics.surfaceAreaMm2 / 100).toFixed(2)} cm²`);
    if (analysis.validation?.result) {
      const v = analysis.validation.result;
      dataRow(copy.fields.watertight, v.isWatertight ? copy.fields.yes : copy.fields.no);
      dataRow(copy.fields.holes, v.holeCount > 0 ? `${v.holeCount}` : copy.fields.none);
    }
    y += 4;
  }

  // ─── Printability ───
  if (metrics) {
    sectionHeader(copy.sections.printability);
    if (metrics.minWallThicknessMm !== null)
      dataRow(copy.fields.minWall, `${metrics.minWallThicknessMm.toFixed(2)} mm`);
    if (metrics.avgWallThicknessMm !== null)
      dataRow(copy.fields.avgWall, `${metrics.avgWallThicknessMm.toFixed(2)} mm`);
    dataRow(copy.fields.overhang, ({none:"None",moderate:"Moderate — support advised",severe:"Severe — support required"})[metrics.overhang.severity] ?? metrics.overhang.severity);
    if (support)
      dataRow(copy.fields.support, ({none:"None",easy:"Easy",moderate:"Moderate",difficult:"Difficult",very_difficult:"Requires heavy support"})[support.difficulty] ?? support.difficulty);
    y += 4;
  }

  // ─── Material & Time ───
  if (printTime) {
    sectionHeader(copy.sections.material);
    dataRow(copy.fields.weight, `${printTime.materialWeightGrams.toFixed(1)} g`);
    dataRow(copy.fields.cost, `$${printTime.totalCostUsd.toFixed(2)}`);
    const h = Math.floor(printTime.estimatedPrintTimeMinutes / 60);
    const m = Math.round(printTime.estimatedPrintTimeMinutes % 60);
    dataRow(copy.fields.time, h > 0 ? `${h}h ${m}m` : `${m}m`);
    y += 4;
  }

  // ─── Issues ───
  sectionHeader(copy.sections.issues);

  if (!issues.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.muted);
    doc.text(copy.sections.noIssues, 20, y);
    y += 8;
  } else {
    issues.forEach((issue, i) => {
      // Issue number badge
      doc.setFillColor(...lightColor.fg);
      doc.rect(20, y - 3.5, 5, 5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      doc.text(`${i + 1}`, 22.5, y, { align: "center" });

      // Issue text
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...COLORS.ink);
      const lines = doc.splitTextToSize(issue, W - 52);
      doc.text(lines, 28, y);
      y += lines.length * 5.5 + 3;

      if (y > 265) {
        doc.addPage();
        doc.setFillColor(...COLORS.pageBg);
        doc.rect(0, 0, W, 297, "F");
        y = 20;
      }
    });
  }

  // ─── Footer ───
  y = 280;
  doc.setDrawColor(...COLORS.rule);
  doc.setLineWidth(0.3);
  doc.line(20, y, W - 20, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.muted);
  doc.text("3DP AGENT · 3dp-agent.vercel.app", 20, y);
  doc.text(`${score}/100`, W - 20, y, { align: "right" });
  
  const reportId = `3DP-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Math.floor(Math.random()*9000+1000)}`;
  doc.text(`Report ID: ${reportId}`, W/2, y, { align: "center" });

  // ─── Save ───
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.muted);
  const disclaimer = lang === "ja"
    ? "このレポートは自動推定です。実際の印刷結果は素材・スライサー設定・プリンター校正により異なる場合があります。"
    : "This report is an automated estimate. Actual print results may vary based on material, slicer settings, and printer calibration.";
  const dLines = doc.splitTextToSize(disclaimer, W - 40);
  if (y + dLines.length * 4 > 270) { doc.addPage(); doc.setFillColor(...COLORS.pageBg); doc.rect(0, 0, W, 297, "F"); y = 20; }
  doc.text(dLines, 20, y + 6);
  y += dLines.length * 4 + 10;

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