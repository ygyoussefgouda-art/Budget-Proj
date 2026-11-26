// Renders the Masrofy mark (2.4.2: the owner's wallet with a rising arrow, scripts/mark.mjs) into every icon
// the app ships: web PWA icons, the favicon, the Orion store icon, and the Android launcher icons and splash.
//   node scripts/make-icons.mjs        (from the repo root; uses e2e's Playwright Chromium)
// Icons: the dark wallet on the brand lime. Splash: the lime wallet on the dark Night background.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARK_PATHS, MARK_VIEWBOX } from './mark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'e2e', 'package.json'));
const { chromium } = require('@playwright/test');

const NIGHT = '#0B0F0D';
const LIME = '#B8F25C';
const INK = '#2E3833';
const [, , vbW, vbH] = MARK_VIEWBOX.split(' ').map(Number);

/**
 * w×h image; `shape` = background: 'rounded' | 'square' | 'circle' | 'none'; `scale` = mark width as a share of the
 * shorter side; `bg`/`fg` = background and mark colours.
 */
function svg(w, h, shape, scale, bg = LIME, fg = INK) {
  const mw = Math.min(w, h) * scale;
  const mh = (mw * vbH) / vbW;
  const back =
    shape === 'none' ? '' :
    shape === 'circle' ? `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2}" fill="${bg}"/>` :
    `<rect width="${w}" height="${h}" rx="${shape === 'rounded' ? Math.min(w, h) * 0.22 : 0}" fill="${bg}"/>`;
  const mark = MARK_PATHS.map((d) => `<path fill="${fg}" d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${back}<svg x="${(w - mw) / 2}" y="${(h - mh) / 2}" width="${mw}" height="${mh}" viewBox="${MARK_VIEWBOX}">${mark}</svg></svg>`;
}

const web = path.join(root, 'web', 'public');
const res = path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'res');
const jobs = [
  [path.join(web, 'icon-192.png'), 192, 192, 'rounded', 0.62],
  [path.join(web, 'icon-512.png'), 512, 512, 'rounded', 0.62],
  // maskable: full bleed, mark inside the 80% safe circle
  [path.join(web, 'icon-maskable-512.png'), 512, 512, 'square', 0.5],
  // Orion Store listing (docs/store/icon-512.png is the raw URL in the submission)
  [path.join(root, 'docs', 'store', 'icon-512.png'), 512, 512, 'rounded', 0.62],
];
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  jobs.push([path.join(res, `mipmap-${d}`, 'ic_launcher.png'), 48 * k, 48 * k, 'rounded', 0.6]);
  jobs.push([path.join(res, `mipmap-${d}`, 'ic_launcher_round.png'), 48 * k, 48 * k, 'circle', 0.56]);
  // adaptive foreground: 108dp canvas, launchers show the middle 66dp, so the mark stays well inside it.
  // The adaptive background colour (lime) is in values/ic_launcher_background.xml.
  jobs.push([path.join(res, `mipmap-${d}`, 'ic_launcher_foreground.png'), 108 * k, 108 * k, 'none', 0.42]);
}
const splash = {
  drawable: [480, 320], 'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280], 'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920],
};
for (const [dir, [w, h]] of Object.entries(splash)) jobs.push([path.join(res, dir, 'splash.png'), w, h, 'square', 0.3, NIGHT, LIME]);

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, w, h, shape, scale, bg, fg] of jobs) {
  await page.setViewportSize({ width: Math.round(w), height: Math.round(h) });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(Math.round(w), Math.round(h), shape, scale, bg, fg)}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: Math.round(w), height: Math.round(h) } });
}
await browser.close();
console.log(`wrote ${jobs.length} icons`);
