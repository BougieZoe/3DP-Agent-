/**
 * Playwright screenshot capture for wall-thickness histogram states.
 *
 * Produces 4 distinct screenshots:
 *   01-watertight-normal.png   — watertight cube, all-identical thickness (single bin)
 *   02-multi-bin-histogram.png — tall cylinder, varying wall thickness (multiple bins)
 *   03-not-watertight-warning.png — open cube, missing face → watertight warning + histogram
 *   04-sparse-histogram.png    — single triangle, near-zero samples → sparse warning
 *
 * Usage:  node scripts/capture-histogram-screenshots.mjs
 * Requires: dev server running on http://localhost:3000, playwright installed.
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
  { stl: 'watertight-cube.stl',     out: '01-watertight-normal.png',       label: 'watertight cube (single bin)' },
  { stl: 'tall-cylinder.stl',       out: '02-multi-bin-histogram.png',     label: 'tall cylinder (multi bin)' },
  { stl: 'open-cube.stl',           out: '03-not-watertight-warning.png',  label: 'open cube (not watertight)' },
  { stl: 'sparse-mesh.stl',         out: '04-sparse-histogram.png',        label: 'sparse mesh (near-zero samples)' },
];

async function uploadAndWait(page, stlName) {
  const stlPath = join(STL_DIR, stlName);
  if (!existsSync(stlPath)) throw new Error(`Missing STL: ${stlPath}`);

  const fileChooserPromise = page.waitForEvent('filechooser');
  // Click the drop zone to trigger the hidden file input
  await page.locator('text=DRAG FILE HERE OR CLICK TO BROWSE').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(stlPath);

  // Wait for analysis to complete — look for the geometry tab content
  // The histogram or "no data" panel should appear
  await page.waitForTimeout(3000);

  // Wait for the WALL THICKNESS header or the histogram "no data" text to appear
  try {
    await page.locator('text=WALL THICKNESS').first().waitFor({ timeout: 8000 });
  } catch {
    console.log(`    (WALL THICKNESS header not found — may be below fold)`);
  }
}

async function scrollIntoView(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, selector);
}

async function capture(page, outName, label) {
  // Scroll the right-panel scrollable container to reveal the histogram at the bottom
  await page.evaluate(() => {
    // The right panel is: div.lg:w-1/2.lg:h-[calc(100vh-3.5rem)].lg:overflow-y-auto
    const panel = document.querySelector('.lg\\:overflow-y-auto');
    if (panel) {
      // Scroll to bottom to reveal histogram
      panel.scrollTop = panel.scrollHeight;
    }
  });

  await page.waitForTimeout(600);

  // Full-page screenshot — shows entire layout including scrolled panel
  const outPath = join(OUT_DIR, outName);
  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`  ✓ ${outName} — ${label}`);
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
    await capture(page, c.out, c.label);

    // Navigate back to home for next upload (clear state)
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
  }

  await browser.close();
  console.log('\nDone — all screenshots captured.');
}

main().catch(err => { console.error(err); process.exit(1); });
