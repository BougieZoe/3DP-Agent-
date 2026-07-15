import type { Language, TrafficLight } from "./reportTypes";

// ─── JsPDF interface ───────────────────────────────────────────────────────────

export interface JsPDF {
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

export const C = {
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

export const kern = (s: string): string => s.split("").join(" ");

// ─── Shared PDF Helpers ────────────────────────────────────────────────────────

export const PAGE_W = 210;
export const PAGE_H = 297;
export const PAGE_M = 20;
export const PAGE_CW = PAGE_W - 2 * PAGE_M;
export const PAGE_BOT = PAGE_H - 18;

export function drawHeader(
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

export function drawFooter(
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

export function drawVerdictCard(
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

export function drawSectionLine(doc: JsPDF, y: number): number {
  doc.setDrawColor(...C.sectionLn);
  doc.setLineWidth(0.3);
  doc.line(PAGE_M, y, PAGE_W - PAGE_M, y);
  return y + 6;
}

export function drawSectionHeader(doc: JsPDF, label: string, y: number): number {
  y = drawSectionLine(doc, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...C.faint);
  doc.text(kern(label), PAGE_M, y);
  return y + 7;
}

export function drawDataRow(
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

export function drawIssueBadge(
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
