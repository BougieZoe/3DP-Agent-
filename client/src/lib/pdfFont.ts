import type { Language } from '@/lib/i18n';

/**
 * jsPDF uses the standard 14 fonts (helvetica) which are Latin-1 only — any
 * CJK text renders as mojibake. Register a Unicode CJK font per language and
 * return the font name to setFont() with. Fonts live in client/public/fonts
 * and are fetched once then cached in base64 (jsPDF's addFileToVFS).
 */

const CJK_FONTS: Partial<Record<Language, { name: string; url: string }>> = {
  ja: { name: 'NotoSansJP', url: '/fonts/NotoSansJP-Regular.otf' },
  zh: { name: 'NotoSansSC', url: '/fonts/NotoSansSC-Regular.otf' },
};

const fontCache = new Map<string, string>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    for (let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j]);
  }
  return btoa(binary);
}

export interface PdfFontHost {
  addFileToVFS: (name: string, base64: string) => void;
  addFont: (name: string, family: string, style: string) => void;
}

/** Register the CJK font (if needed) on a jsPDF doc; returns the font to setFont. */
export async function preparePdfFonts(doc: PdfFontHost, lang: Language): Promise<string> {
  const cfg = CJK_FONTS[lang];
  if (!cfg) return 'helvetica';

  let base64 = fontCache.get(lang);
  if (!base64) {
    const buf = await (await fetch(cfg.url)).arrayBuffer();
    base64 = bytesToBase64(new Uint8Array(buf));
    fontCache.set(lang, base64);
  }
  doc.addFileToVFS(cfg.name, base64);
  doc.addFont(cfg.name, cfg.name, 'normal');
  return cfg.name;
}
