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
// [design, view, file, zoom (smaller is closer)]
const SHOTS = [['634-unit-a', 'q', 'sample-634.jpg', 0.72], ['savannah-dr', 'q', 'sample-savannah.jpg', 0.8]];

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
  for (const [name, view, file, zoom] of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1232, height: 1100 }, deviceScaleFactor: 1 });
    await page.route('**/three.min.js', (r) => r.fulfill({ body: three, contentType: 'text/javascript' }));
    await page.setContent(bundleHtml(fs.readFileSync(path.join(ROOT, 'designs', name + '.json'), 'utf8')), { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#cv') && document.querySelector('#cv').width > 0);
    await page.addStyleTag({ content: '.tools,.showcase,.modebadge{visibility:hidden!important} .grid{grid-template-columns:1fr!important} .panel,header{display:none!important} .stage{height:860px!important;border-radius:0!important}' });
    await page.evaluate(([v, z]) => { window.dispatchEvent(new Event('resize')); setView(v); goal.radius *= z; }, [view, zoom]); // eslint-disable-line no-undef
    await page.waitForTimeout(1500);
    await page.locator('#cv').screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 86 });
    console.log(`${file}: ${Math.round(fs.statSync(path.join(OUT, file)).size / 1024)} KB`);
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
