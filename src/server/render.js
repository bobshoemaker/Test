// Renders a design to PNG images with the viewer page in headless Chromium, so the design loop
// can show Claude what its draft looks like next to the photos. Optional: needs Playwright
// (a local or global install) and returns null from makeRenderer when it isn't available.
const path = require('node:path');
const { execSync } = require('node:child_process');
const { bundleHtml } = require('./bundle');

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const VIEWS = [{ id: 'f', label: 'front, as seen from the street' }, { id: 'q', label: 'three-quarter view from the front' }];

function loadPlaywright() {
  try { return require('playwright'); } catch { /* try the global install */ }
  try { return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch { return null; }
}

// Returns render(design) -> [{label, data (base64 PNG)}], plus close(); or null without Playwright.
async function makeRenderer({ width = 800, height = 600 } = {}) {
  const pw = loadPlaywright();
  if (!pw) return null;
  // The page loads three.js from a CDN; fetch it once here and serve it to the page, since the
  // headless browser may not reach the CDN itself.
  const three = await (await fetch(THREE_URL)).text();
  const opts = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
  if (process.env.BRICKHOUSE_CHROMIUM) opts.executablePath = process.env.BRICKHOUSE_CHROMIUM;
  const browser = await pw.chromium.launch(opts);
  async function render(design) {
    const page = await browser.newPage({ viewport: { width, height: height + 160 } });
    try {
      await page.route('**/three.min.js', (r) => r.fulfill({ body: three, contentType: 'text/javascript' }));
      await page.setContent(bundleHtml(JSON.stringify(design)), { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelector('#cv') && document.querySelector('#cv').width > 0);
      await page.addStyleTag({ content: '.tools,.showcase,.modebadge{visibility:hidden!important}' });
      const out = [];
      for (const v of VIEWS) {
        await page.evaluate((id) => document.querySelector(`button[data-view="${id}"]`).click(), v.id);
        await page.waitForTimeout(400);
        const png = await page.locator('#cv').screenshot({ type: 'png' });
        out.push({ label: v.label, data: png.toString('base64') });
      }
      return out;
    } finally { await page.close(); }
  }
  return { render, close: () => browser.close() };
}

module.exports = { makeRenderer, VIEWS };
