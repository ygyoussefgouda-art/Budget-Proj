// Renders the Masrofy mark (mark 11 "Budget line M", Option E colours) into every icon the app ships:
// web PWA icons and the Android launcher icons and splash screens.
//   node scripts/make-icons.mjs        (from the repo root; uses e2e's Playwright Chromium)
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'e2e', 'package.json'));
const { chromium } = require('@playwright/test');

const NIGHT = '#0B0F0D';
const MARK = `<path d="M16 84V20L50 60L84 20V84" fill="none" stroke="#2E3833" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M16 84V20L50 60L84 20V84" pathLength="100" stroke-dasharray="64 100" fill="none" stroke="#B8F25C" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`;

/** w×h image; `shape` = background: 'rounded' | 'square' | 'circle' | 'none'; `scale` = mark size as a share of the shorter side. */
function svg(w, h, shape, scale) {
  const s = Math.min(w, h) * scale;
  const bg =
    shape === 'none' ? '' :
    shape === 'circle' ? `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2}" fill="${NIGHT}"/>` :
    `<rect width="${w}" height="${h}" rx="${shape === 'rounded' ? Math.min(w, h) * 0.22 : 0}" fill="${NIGHT}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg}<svg x="${(w - s) / 2}" y="${(h - s) / 2}" width="${s}" height="${s}" viewBox="0 0 100 100">${MARK}</svg></svg>`;
}

const web = path.join(root, 'web', 'public');
const res = path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'res');
const jobs = [
  [path.join(web, 'icon-192.png'), 192, 192, 'rounded', 0.625],
  [path.join(web, 'icon-512.png'), 512, 512, 'rounded', 0.625],
  // maskable: full bleed, mark inside the 80% safe circle
  [path.join(web, 'icon-maskable-512.png'), 512, 512, 'square', 0.5],
];
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  jobs.push([path.join(res, `mipmap-${d}`, 'ic_launcher.png'), 48 * k, 48 * k, 'rounded', 0.6]);
  jobs.push([path.join(res, `mipmap-${d}`, 'ic_launcher_round.png'), 48 * k, 48 * k, 'circle', 0.56]);
  // adaptive foreground: 108dp canvas, launchers show the middle 66dp, so the mark stays well inside it
  jobs.push([path.join(res, `mipmap-${d}`, 'ic_launcher_foreground.png'), 108 * k, 108 * k, 'none', 0.44]);
}
const splash = {
  drawable: [480, 320], 'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280], 'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920],
};
for (const [dir, [w, h]] of Object.entries(splash)) jobs.push([path.join(res, dir, 'splash.png'), w, h, 'square', 0.3]);

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, w, h, shape, scale] of jobs) {
  await page.setViewportSize({ width: Math.round(w), height: Math.round(h) });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(Math.round(w), Math.round(h), shape, scale)}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: Math.round(w), height: Math.round(h) } });
}
await browser.close();
console.log(`wrote ${jobs.length} icons`);
