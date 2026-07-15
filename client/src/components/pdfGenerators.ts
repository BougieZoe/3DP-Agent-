import type { UnifiedAnalysis } from "../analysis/types";
import { deriveOhStatus, deriveSupportStatus, deriveWtStatus } from "@/analysis/metrics";
import type { ToneMode, Language } from "./reportTypes";
import {
  getTrafficLight,
  computeWeightRange,
  computeTimeRange,
  buildClientIssues,
  buildDesignerIssues,
} from "./reportUtils";
import {
  C,
  PAGE_W,
  PAGE_H,
  PAGE_M,
  PAGE_CW,
  PAGE_BOT,
  drawHeader,
  drawFooter,
  drawVerdictCard,
  drawSectionLine,
  drawSectionHeader,
  drawDataRow,
  drawIssueBadge,
} from "./pdfLayout";
import type { JsPDF } from "./pdfLayout";

// ─── CLIENT PDF ────────────────────────────────────────────────────────────────

export async function generateClientPDF(
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

export async function generateDesignerPDF(
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
  const wtStatus = metrics != null ? deriveWtStatus(metrics.thinWallRatio ?? 0, metrics.p5WallThicknessMm) : 'good';
  y = drawSectionHeader(doc, "KEY METRICS", y);

  if (metrics?.minWallThicknessMm != null) {
    y = drawDataRow(doc,
      lang === "ja" ? "最小壁厚" : "Min wall thickness",
      `${metrics.minWallThicknessMm.toFixed(3)} mm`,
      y,
      wtStatus !== 'good'
    );
  }
  if (metrics?.p5WallThicknessMm != null) {
    y = drawDataRow(doc,
      lang === "ja" ? "5パーセンタイル壁厚" : "p5 wall thickness",
      `${metrics.p5WallThicknessMm.toFixed(3)} mm`,
      y,
      wtStatus !== 'good'
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
    const supportStatus = deriveSupportStatus(s);
    const statusLabel = supportStatus.status === 'critical' ? 'Critical' : supportStatus.status === 'warning' ? 'Warning' : 'Good';
    y = drawDataRow(doc,
      lang === "ja" ? "サポート" : "Support",
      statusLabel,
      y,
      supportStatus.status !== 'good'
    );
    y = drawDataRow(doc,
      lang === "ja" ? "サポート領域" : "Support regions",
      `${s.supportRegions.length}`,
      y
    );
    y = drawDataRow(doc,
      lang === "ja" ? "最大島比率" : "Largest island",
      `${(s.largestRegionRatio * 100).toFixed(1)}%`,
      y,
      supportStatus.status === 'critical'
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
    const wtStatus = deriveWtStatus(metrics?.thinWallRatio ?? 0, metrics?.p5WallThicknessMm);
    if (wtStatus !== 'good') {
      parts.push(lang === "ja" ? "壁厚を増やしてください" : "Increase wall thickness");
    }
    if (metrics?.overhang.ratio != null && deriveOhStatus(metrics.overhang.ratio) !== 'good') {
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

export async function generateFactoryPDF(
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
    y = drawDataRow(doc, "Min wall thickness", metrics.minWallThicknessMm != null ? `${metrics.minWallThicknessMm.toFixed(3)} mm` : "—", y, false);
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
    const pdfSupportStatus = deriveSupportStatus(s);
    y = drawDataRow(doc, "Status", pdfSupportStatus.status, y, pdfSupportStatus.status !== 'good');
    y = drawDataRow(doc, "Support volume", s.totalSupportVolumeMm3 != null ? `${(s.totalSupportVolumeMm3 / 1000).toFixed(2)} cm³` : "—", y);
    y = drawDataRow(doc, "Support regions", `${s.supportRegions.length}`, y);
    y = drawDataRow(doc, "Largest island %", `${(s.largestRegionRatio * 100).toFixed(1)}%`, y, pdfSupportStatus.status === 'critical');
    y = drawDataRow(doc, "Tall support ratio", `${(s.tallSupportRatio * 100).toFixed(1)}%`, y, pdfSupportStatus.status !== 'good');
    y = drawDataRow(doc, "Directionality", `${(s.directionality * 100).toFixed(1)}%`, y, pdfSupportStatus.status !== 'good');
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
