/**
 * Browser-canvas PDF surface.
 *
 * jsPDF's built-in fonts are Latin-1 only, and embedding CJK OTF/CFF fonts is
 * unreliable. Instead of fighting font embedding, we render every page on an
 * HTMLCanvasElement — the BROWSER rasterizes text with whatever system fonts
 * cover the language (ja, zh, ko, cyrillic, …), so correctness is guaranteed
 * for any future language. The finished pages are embedded into the PDF as
 * images via jsPDF.addImage.
 *
 * The surface implements the same minimal drawing API the report generators
 * already use, so the layout code is unchanged.
 */

const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
// 72 dpi * 2x for crisp text.
const SCALE = 2;
const PX_PER_MM = (72 / 25.4) * SCALE;

const FONT_STACK =
  '"Noto Sans JP", "Noto Sans SC", "PingFang SC", "Hiragino Sans", "Microsoft YaHei", "Malgun Gothic", sans-serif';

interface PageCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function mm2px(mm: number): number {
  return mm * PX_PER_MM;
}

export function createPdfCanvasSurface() {
  const pages: PageCanvas[] = [];
  let current: PageCanvas;

  function newPage(): void {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(mm2px(PAGE_W));
    canvas.height = Math.round(mm2px(PAGE_H));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fafaf8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = 'alphabetic';
    current = { canvas, ctx };
    pages.push(current);
  }
  newPage();

  let fontPt = 10;
  let fontBold = false;
  let fillStyle = '#1a1a18';
  let strokeStyle = '#1a1a18';
  let lineWidth = 1;
  let textAlign: CanvasTextAlign = 'left';

  function setFont(_name: string, style?: string): void {
    // Font family is fixed to the CJK-capable stack; the browser resolves per glyph.
    fontBold = style === 'bold';
  }

  function applyFont(): void {
    const weight = fontBold ? 'bold ' : '';
    current.ctx.font = `${weight}${Math.round(fontPt * SCALE)}px ${FONT_STACK}`;
    current.ctx.fillStyle = fillStyle;
    current.ctx.strokeStyle = strokeStyle;
    current.ctx.lineWidth = lineWidth * SCALE;
    current.ctx.textAlign = textAlign;
  }

  function text(s: string | string[], x: number, y: number, opts?: { align?: string }): void {
    applyFont();
    const lines = Array.isArray(s) ? s : [s];
    const align = opts?.align === 'center' ? 'center' : opts?.align === 'right' ? 'right' : 'left';
    current.ctx.textAlign = align;
    const px = mm2px;
    for (let i = 0; i < lines.length; i++) {
      current.ctx.fillText(lines[i], px(x), px(y) + i * fontPt * SCALE * 1.25);
    }
    current.ctx.textAlign = 'left';
  }

  function splitTextToSize(s: string, maxWidthMm: number): string[] {
    applyFont();
    const maxPx = mm2px(maxWidthMm);
    const words = s.split(/\s+/);
    if (words.length <= 1 && s.trim()) return [s];
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (current.ctx.measureText(candidate).width > maxPx && line) {
        lines.push(line);
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [s];
  }

  function getTextWidth(s: string): number {
    applyFont();
    return current.ctx.measureText(s).width / PX_PER_MM;
  }

  const surface = {
    internal: { pageSize: { getWidth: () => PAGE_W, getHeight: () => PAGE_H } },

    setFillColor(r: number, g: number, b: number): void {
      fillStyle = `rgb(${r},${g},${b})`;
    },
    setDrawColor(r: number, g: number, b: number): void {
      strokeStyle = `rgb(${r},${g},${b})`;
    },
    setLineWidth(w: number): void {
      lineWidth = w;
    },
    rect(x: number, y: number, w: number, h: number, style = 'F'): void {
      const c = current.ctx;
      if (style !== 'S') {
        c.fillStyle = fillStyle;
        c.fillRect(mm2px(x), mm2px(y), mm2px(w), mm2px(h));
      }
      if (style !== 'F') {
        c.strokeStyle = strokeStyle;
        c.lineWidth = lineWidth * SCALE;
        c.strokeRect(mm2px(x), mm2px(y), mm2px(w), mm2px(h));
      }
    },
    line(x1: number, y1: number, x2: number, y2: number): void {
      current.ctx.strokeStyle = strokeStyle;
      current.ctx.lineWidth = lineWidth * SCALE;
      current.ctx.beginPath();
      current.ctx.moveTo(mm2px(x1), mm2px(y1));
      current.ctx.lineTo(mm2px(x2), mm2px(y2));
      current.ctx.stroke();
    },
    circle(cx: number, cy: number, r: number, style = 'F'): void {
      const c = current.ctx;
      c.beginPath();
      c.arc(mm2px(cx), mm2px(cy), mm2px(r), 0, Math.PI * 2);
      if (style !== 'S') {
        c.fillStyle = fillStyle;
        c.fill();
      }
      if (style !== 'F') {
        c.strokeStyle = strokeStyle;
        c.stroke();
      }
    },
    setFont,
    setFontSize(size: number): void {
      fontPt = size;
    },
    setTextColor(r: number, g: number, b: number): void {
      fillStyle = `rgb(${r},${g},${b})`;
    },
    text,
    splitTextToSize,
    getTextWidth,
    addPage(): void {
      newPage();
    },
    getNumberOfPages(): number {
      return pages.length;
    },
    setPage(n: number): void {
      current = pages[n - 1];
    },

    /** Flush the rendered pages into a real jsPDF and save the file. */
    async save(filename: string): Promise<void> {
      const { jsPDF } = (await import('jspdf' as never)) as { jsPDF: new (o?: object) => any };
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      for (let i = 0; i < pages.length; i++) {
        if (i > 0) doc.addPage();
        const url = pages[i].canvas.toDataURL('image/png');
        doc.addImage(url, 'PNG', 0, 0, PAGE_W, PAGE_H);
      }
      doc.save(filename);
    },
  };

  return surface;
}
