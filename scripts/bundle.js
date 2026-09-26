#!/usr/bin/env node
// Build a single self-contained HTML file for one design (to share, or publish as a Claude artifact).
//   node scripts/bundle.js designs/634-unit-a.json [dist/634-unit-a.html]
const fs = require('node:fs');
const path = require('node:path');
const { bundleHtml } = require('../src/server/bundle');
const src = process.argv[2];
if (!src) { console.error('Usage: node scripts/bundle.js <design.json> [out.html]'); process.exit(2); }
const out = process.argv[3] || path.join(path.resolve(__dirname, '..'), 'dist', path.basename(src, '.json') + '.html');
const html = bundleHtml(fs.readFileSync(src, 'utf8'));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);
