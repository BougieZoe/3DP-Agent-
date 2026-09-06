/**
 * Final-round Playwright screenshot capture.
 * Mesh A: thin wall (0.4mm) — red bar histogram
 * Mesh B: stepped wall (0.5mm + 4mm) — bimodal histogram
 *
 * For each mesh: screenshot of histogram, then scroll down to show
 * expanded MESH DIAGNOSTICS + REPAIR & PROCESS.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/bougiezoe/.claude/skills/playwright-skill/node_modules/playwright-core');

import { join } from 'path';
import { existsSync } from 'fs';

const BASE = 'http://localhost:3000';
const STL_DIR = join(import.meta.dirname, '..', 'docs', '_stls');
const OUT_DIR = join(import.meta.dirname, '..', 'docs');

const CASES = [
  { stl: 'thin-wall-04mm.stl',  prefix: '05-thin-wall',       label: 'thin wall 0.4mm (red bar)' },
  { stl: 'stepped-wall.stl',    prefix: '06-stepped-wall',     label: 'stepped wall 0.5+4mm (bimodal)' },
];

async function uploadAndWait(page, stlName) {
  const stlPath = join(STL_DIR, stlName);
  if (!existsSync(stlPath)) throw new Error(`Missing STL: ${stlPath}`);

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('text=DRAG FILE HERE OR CLICK TO BROWSE').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(stlPath);

  // Wait for histogram to appear
  await page.waitForTimeout(2000);
  try {
    await page.locator('text=WALL THICKNESS DISTRIBUTION').first().waitFor({ timeout: 10000 });
  } catch {
    console.log(`    (WALL THICKNESS DISTRIBUTION not found — checking for no-data)`);
  }
}

async function scrollToHistogram(page) {
  await page.evaluate(() => {
    const panel = document.querySelector('.lg\\:overflow-y-auto');
    if (panel) {
      // Find the histogram heading and scroll it into view
      const headings = [...document.querySelectorAll('div')];
      const hist = headings.find(el => {
        const t = el.textContent || '';
        return t.includes('WALL THICKNESS DISTRIBUTION') && el.children.length < 5;
      });
      if (hist) {
        hist.scrollIntoView({ block: 'start', behavior: 'instant' });
        // Scroll the parent container a bit more to show the full histogram
        const scrollable = hist.closest('.lg\\:overflow-y-auto') || panel;
        scrollable.scrollTop = Math.max(0, hist.offsetTop - scrollable.offsetTop - 80);
      }
    }
  });
  await page.waitForTimeout(300);
}

async function expandDiagnosticsAndScroll(page) {
  // Click the MESH DIAGNOSTICS details toggle to expand it
  await page.evaluate(() => {
    const details = [...document.querySelectorAll('details')];
    const diag = details.find(d => {
      const summary = d.querySelector('summary');
      return summary && summary.textContent?.includes('MESH DIAGNOSTICS');
    });
    if (diag && !diag.open) {
      diag.open = true;
    }
  });
  await page.waitForTimeout(300);

  // Scroll to show expanded diagnostics + REPAIR & PROCESS button
  await page.evaluate(() => {
    const panel = document.querySelector('.lg\\:overflow-y-auto');
    if (panel) {
      panel.scrollTop = panel.scrollHeight;
    }
  });
  await page.waitForTimeout(300);
}

async function capturePage(page, outName) {
  const outPath = join(OUT_DIR, outName);
  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`  ✓ ${outName}`);
}

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  console.log(`Navigating to ${BASE}...`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  for (const c of CASES) {
    console.log(`\nUploading ${c.stl} — ${c.label}...`);
    await uploadAndWait(page, c.stl);

    // Screenshot 1: histogram
    await scrollToHistogram(page);
    await capturePage(page, `${c.prefix}-histogram.png`);

    // Screenshot 2: expanded diagnostics + repair
    await expandDiagnosticsAndScroll(page);
    await capturePage(page, `${c.prefix}-diagnostics.png`);

    // Navigate back for next mesh
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
  }

  await browser.close();
  console.log('\nDone — all screenshots captured.');
}

main().catch(err => { console.error(err); process.exit(1); });
