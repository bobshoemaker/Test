#!/usr/bin/env node
// Renders the landing page's pictures of the sample designs (src/viewer/img/) with the viewer in
// headless Chromium. Rerun when a sample design or the viewer's look changes. Needs Playwright.
//   node scripts/landing.js
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { bundleHtml } = require('../src/server/bundle');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src/viewer/img');
// The still pictures behind the live models, each the live model's first frame on a transparent background: the hero
// (savannah-dr), the build (634-unit-a, finished), and the examples' row (each example's turntable, ?hero=spin).
const STILLS = [['savannah-dr', 'window.BRICKHOUSE_HERO = true;', 'hero-house.png'],
  ['634-unit-a', "window.BRICKHOUSE_HERO = 'build'; window.BRICKHOUSE_STILL = true;", 'build-house.png'],
  ['634-unit-a', "window.BRICKHOUSE_HERO = 'spin'; window.BRICKHOUSE_STILL = true;", 'ex-634-unit-a.png'],
  ['savannah-dr', "window.BRICKHOUSE_HERO = 'spin'; window.BRICKHOUSE_STILL = true;", 'ex-savannah-dr.png']];

function playwright() {
  try { return require('playwright'); } catch { /* the global install */ }
  return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
}

(async () => {
  const three = await (await fetch('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js')).text();
  const opts = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
  if (process.env.BRICKHOUSE_CHROMIUM) opts.executablePath = process.env.BRICKHOUSE_CHROMIUM;
  const browser = await playwright().chromium.launch(opts);
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, flags, file] of STILLS) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 1 });
    await page.route('**/three.min.js', (r) => r.fulfill({ body: three, contentType: 'text/javascript' }));
    const html = bundleHtml(fs.readFileSync(path.join(ROOT, 'designs', name + '.json'), 'utf8')).replace('<script', `<script>${flags}</script><script`);
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#cv') && document.querySelector('#cv').width > 0);
    await page.waitForTimeout(2500);
    await page.locator('#cv').screenshot({ path: path.join(OUT, file), omitBackground: true });
    console.log(`${file}: ${Math.round(fs.statSync(path.join(OUT, file)).size / 1024)} KB`);
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
