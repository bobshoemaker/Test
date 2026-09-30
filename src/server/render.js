// Renders a design to PNG images with the viewer page in headless Chromium, so the design loop
// can show Claude what its draft looks like next to the photos. Also draws a floor plan with a
// labeled pixel grid (for reading coordinates off it) and a footprint laid over the plan.
// Optional: needs Playwright (a local or global install); makeRenderer returns null without it.
const path = require('node:path');
const { execSync } = require('node:child_process');
const { bundleHtml } = require('./bundle');

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const VIEWS = [{ id: 'f', label: 'front, as seen from the street' }, { id: 'q', label: 'three-quarter view from the front' },
  { id: 'bl', label: 'three-quarter view from the back, on the opposite corner' }, { id: 'br', label: 'three-quarter view from the other back corner' }];

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
        await page.evaluate((id) => setView(id), v.id); // eslint-disable-line no-undef
        await page.waitForTimeout(400);
        const png = await page.locator('#cv').screenshot({ type: 'png' });
        out.push({ label: v.label, data: png.toString('base64') });
      }
      return out;
    } finally { await page.close(); }
  }

  // Draws a page's canvas and screenshots it. draw runs in the page with the given argument.
  async function canvasPng(w, h, draw, arg) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    try {
      await page.setContent(`<body style="margin:0;background:#fff"><canvas id="c" width="${w}" height="${h}"></canvas></body>`);
      await page.evaluate(draw, arg);
      return (await page.locator('#c').screenshot({ type: 'png' })).toString('base64');
    } finally { await page.close(); }
  }
  const loadImg = `(src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; })`;

  // The plan at 2x with a line every 10 plan pixels and labels every 50, in original plan pixels.
  async function gridPlan(plan) {
    const src = `data:${plan.mediaType};base64,${plan.data}`;
    const page = await browser.newPage();
    let wh;
    try {
      await page.setContent('<body></body>');
      wh = await page.evaluate(async (a) => { const i = await (eval(a.loadImg))(a.src); return [i.naturalWidth, i.naturalHeight]; }, { src, loadImg });
    } finally { await page.close(); }
    const k = 2, [W, H] = wh;
    const data = await canvasPng(W * k + 36, H * k + 20, async (a) => {
      const img = await (eval(a.loadImg))(a.src), c = document.getElementById('c'), x = c.getContext('2d'), k = a.k, L = 36, T = 20;
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, L, T, a.W * k, a.H * k);
      x.font = '11px sans-serif';
      for (let v = 0; v <= a.W; v += 10) {
        x.strokeStyle = v % 50 ? 'rgba(220,0,0,.22)' : 'rgba(220,0,0,.75)'; x.beginPath(); x.moveTo(L + v * k + .5, T); x.lineTo(L + v * k + .5, T + a.H * k); x.stroke();
        if (v % 50 === 0) { x.fillStyle = '#c00'; x.fillText(String(v), L + v * k + 2, 13); }
      }
      for (let v = 0; v <= a.H; v += 10) {
        x.strokeStyle = v % 50 ? 'rgba(0,0,220,.22)' : 'rgba(0,0,220,.75)'; x.beginPath(); x.moveTo(L, T + v * k + .5); x.lineTo(L + a.W * k, T + v * k + .5); x.stroke();
        if (v % 50 === 0) { x.fillStyle = '#00c'; x.fillText(String(v), 2, T + v * k + 4); }
      }
    }, { src, loadImg, k, W, H });
    return { data, mediaType: 'image/png', width: W, height: H };
  }

  // The plan drawn in stud space (as laid out) with the locked walls, doors and stairs on top.
  async function footprintOverlay(plan, locked, { size = 32, px = 20 } = {}) {
    const src = `data:${plan.mediaType};base64,${plan.data}`;
    return canvasPng(size * px, size * px, async (a) => {
      const img = await (eval(a.loadImg))(a.src), c = document.getElementById('c'), x = c.getContext('2d'), S = a.px, m = a.locked.map;
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      x.save(); x.globalAlpha = 0.75; x.setTransform(S * m.a, S * m.b, S * m.c, S * m.d, S * m.e, S * m.f); x.drawImage(img, 0, 0); x.restore();
      x.strokeStyle = 'rgba(0,0,0,.12)';
      for (let i = 0; i <= a.size; i++) { x.beginPath(); x.moveTo(i * S, 0); x.lineTo(i * S, c.height); x.stroke(); x.beginPath(); x.moveTo(0, i * S); x.lineTo(c.width, i * S); x.stroke(); }
      x.fillStyle = '#333'; x.font = '10px sans-serif';
      for (let i = 0; i < a.size; i += 5) { x.fillText(String(i), i * S + 2, 10); x.fillText(String(i), 2, i * S + 11); }
      const colors = ['rgba(31,111,235,.6)', 'rgba(142,68,173,.6)', 'rgba(22,160,133,.6)', 'rgba(211,84,0,.6)', 'rgba(52,73,94,.6)'];
      a.locked.blocks.forEach((b, i) => {
        x.fillStyle = colors[i % colors.length];
        for (const [cx, cz] of b.cells) x.fillRect(cx * S + 1, cz * S + 1, S - 2, S - 2);
        const r = b.cellRects[0]; x.fillStyle = '#000'; x.font = 'bold 12px sans-serif'; x.fillText(b.name, (r[0] + 1.2) * S, (r[1] + 1.8) * S);
        for (const o of b.openings) {
          x.fillStyle = /garage/.test(o.kind) ? '#111' : '#e0301e';
          for (let ox = o.cells[0]; ox <= o.cells[2]; ox++) for (let oz = o.cells[1]; oz <= o.cells[3]; oz++) x.fillRect(ox * S + 4, oz * S + 4, S - 8, S - 8);
        }
      });
      x.strokeStyle = '#e67e22'; x.lineWidth = 3;
      for (const s of a.locked.stairs || []) { const r = s.rect; x.strokeRect(r[0] * S, r[1] * S, (r[2] - r[0] + 1) * S, (r[3] - r[1] + 1) * S); }
      x.fillStyle = '#555'; x.fillRect(0, (a.size - 1) * S, c.width, S); x.fillStyle = '#fff'; x.font = 'bold 11px sans-serif'; x.fillText(`STREET (z = ${a.size - 1})`, 6, a.size * S - 6);
    }, { src, loadImg, locked, size, px });
  }

  // A drawing: a background image placed by an affine transform (image pixels to canvas pixels), then shapes
  // in canvas pixels, in order: {poly: [[x, y]...], stroke, width, dash, fill}, {line: [x0, y0, x1, y1], stroke,
  // width, dash}, {circle: [x, y, r], fill, stroke, width}, {text, x, y, size, color, bg, bold, align}.
  // Returns a JPEG (base64): aerial photos stay small in the request.
  async function drawLayers({ width, height, background = '#ffffff', image = null, shapes = [], quality = 88 }) {
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      await page.setContent(`<body style="margin:0"><canvas id="c" width="${width}" height="${height}"></canvas></body>`);
      await page.evaluate(async (a) => {
        const c = document.getElementById('c'), x = c.getContext('2d');
        x.fillStyle = a.background; x.fillRect(0, 0, c.width, c.height);
        if (a.image) {
          const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = a.image.src; });
          x.save(); x.setTransform(...a.image.transform); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0); x.restore();
        }
        for (const s of a.shapes) {
          x.save(); x.setLineDash(s.dash || []); x.lineWidth = s.width || 2; x.strokeStyle = s.stroke || '#000'; x.fillStyle = s.fill || 'transparent';
          if (s.poly) { x.beginPath(); s.poly.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); if (s.fill) x.fill(); if (s.stroke) x.stroke(); }
          else if (s.line) { x.beginPath(); x.moveTo(s.line[0], s.line[1]); x.lineTo(s.line[2], s.line[3]); x.stroke(); }
          else if (s.circle) { x.beginPath(); x.arc(s.circle[0], s.circle[1], s.circle[2], 0, Math.PI * 2); if (s.fill) x.fill(); if (s.stroke) x.stroke(); }
          else if (s.text != null) {
            x.font = `${s.bold ? 'bold ' : ''}${s.size || 13}px sans-serif`; x.textBaseline = 'middle'; x.textAlign = s.align || 'left';
            if (s.bg) { const w = x.measureText(s.text).width, h = (s.size || 13) + 6, lx = s.align === 'center' ? s.x - w / 2 : s.align === 'right' ? s.x - w : s.x;
              x.fillStyle = s.bg; x.fillRect(lx - 3, s.y - h / 2, w + 6, h); }
            x.fillStyle = s.color || '#000'; x.fillText(s.text, s.x, s.y);
          }
          x.restore();
        }
      }, { background, image, shapes });
      return (await page.locator('#c').screenshot({ type: 'jpeg', quality })).toString('base64');
    } finally { await page.close(); }
  }

  return { render, gridPlan, footprintOverlay, drawLayers, close: () => browser.close() };
}

module.exports = { makeRenderer, VIEWS };
