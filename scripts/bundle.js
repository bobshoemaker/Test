#!/usr/bin/env node
// Build a single self-contained HTML file for one design (to share, or publish as a Claude artifact).
//   node scripts/bundle.js designs/634-unit-a.json [dist/634-unit-a.html]
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const src = process.argv[2];
if (!src) { console.error('Usage: node scripts/bundle.js <design.json> [out.html]'); process.exit(2); }
const out = process.argv[3] || path.join(ROOT, 'dist', path.basename(src, '.json') + '.html');
let html = fs.readFileSync(path.join(ROOT, 'src/viewer/index.html'), 'utf8');
const design = fs.readFileSync(src, 'utf8');
const engine = fs.readFileSync(path.join(ROOT, 'src/engine/engine.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'src/viewer/app.js'), 'utf8');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
// Function replacement: the code contains "$'" sequences that a string replacement would expand.
html = html.replace('<script src="/engine.js"></script>\n<script src="/viewer/app.js"></script>',
  () => `<script type="application/json" id="designJson">\n${safe(design)}\n</script>\n<script>\n${safe(engine)}\n</script>\n<script>\n${safe(app)}\n</script>`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);
