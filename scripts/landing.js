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
// [design, view, file, zoom (smaller is closer), building-guide step as a share of the build (optional)],
// drawn on the page's warm background
const SHOTS = [['634-unit-a', 'q', 'sample-634.jpg', 0.72], ['savannah-dr', 'q', 'sample-savannah.jpg', 0.8]];
const BACKGROUND = '#EFE6D8';
// the hero's still picture: the viewer's hero mode (the live model's first frame) on a transparent background

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
  for (const [name, view, file, zoom, step] of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1232, height: 1100 }, deviceScaleFactor: 1 });
    await page.route('**/three.min.js', (r) => r.fulfill({ body: three, contentType: 'text/javascript' }));
    await page.setContent(bundleHtml(fs.readFileSync(path.join(ROOT, 'designs', name + '.json'), 'utf8')), { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#cv') && document.querySelector('#cv').width > 0);
    await page.addStyleTag({ content: `.tools,.showcase,.modebadge{visibility:hidden!important} .grid{grid-template-columns:1fr!important} .panel,header{display:none!important} .stage{height:860px!important;border-radius:0!important} :root{--stage:${BACKGROUND}!important}` });
    await page.evaluate(([v, z, st]) => { // eslint-disable-line no-undef
      window.dispatchEvent(new Event('resize')); applyTheme(); setView(v); goal.radius *= z;
      if (st != null) { document.querySelector('[data-tab="manual"]').click(); const s = document.getElementById('slider');
        s.value = Math.round(st * Number(s.max)); s.dispatchEvent(new Event('input')); }
    }, [view, zoom, step]);
    await page.waitForTimeout(1500);
    await page.locator('#cv').screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 86 });
    console.log(`${file}: ${Math.round(fs.statSync(path.join(OUT, file)).size / 1024)} KB`);
    await page.close();
  }
  // the still pictures behind the live models: the hero (savannah-dr) and the build (634-unit-a, finished)
  for (const [name, flags, file] of [['savannah-dr', 'window.BRICKHOUSE_HERO = true;', 'hero-house.png'],
    ['634-unit-a', "window.BRICKHOUSE_HERO = 'build'; window.BRICKHOUSE_STILL = true;", 'build-house.png']]) {
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
