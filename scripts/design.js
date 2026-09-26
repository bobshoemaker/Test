#!/usr/bin/env node
// Photos to design from the command line, using the same loop as the server.
//   node scripts/design.js front.jpg side.jpg --notes "garage on the right" --target 1200 --out designs/my-house.json
//   Options: --model claude-opus-5-5  --effort high|xhigh|max  --fake (scripted Claude, no key)
const fs = require('node:fs');
const path = require('node:path');
const { designHouse } = require('../src/server/designer');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const flag = (name) => { const i = args.indexOf('--' + name); if (i >= 0) { args.splice(i, 1); return true; } return false; };
const notes = opt('notes', ''), target = Number(opt('target', 1200)), out = opt('out', null);
const model = opt('model', process.env.BRICKHOUSE_MODEL || 'claude-opus-5-5'), effort = opt('effort', process.env.BRICKHOUSE_EFFORT || null);
const fake = flag('fake');
const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const photos = args.map((f) => {
  const t = types[path.extname(f).toLowerCase()]; if (!t) throw new Error(`Unsupported image type: ${f}`);
  return { mediaType: t, data: fs.readFileSync(f).toString('base64') };
});

(async () => {
  let client;
  if (fake) client = require('../src/server/fakeClient').makeFakeClient({ delayMs: 50 });
  else {
    client = require('../src/server/client').makeAnthropicClient();
    if (!client) { console.error('Set BRICKHOUSE_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY (or pass --fake).'); process.exit(2); }
  }
  const t0 = Date.now();
  const res = await designHouse({ client, model, effort, photos, notes, target,
    onEvent: (ev) => {
      if (ev.type === 'status') console.log(ev.message);
      if (ev.type === 'draft') console.log(`  draft ${ev.n}: ${ev.stats.pieces} pieces, ${ev.errors} errors, ${ev.warnings} warnings`);
    } });
  const s = res.result.stats;
  console.log(`Done in ${Math.round((Date.now() - t0) / 1000)} s: ${s.pieces} pieces, ${res.result.errors.length} errors, ${res.result.warnings.length} warnings${res.note ? ' (' + res.note + ')' : ''}`);
  const u = res.usage;
  if (u) console.log(`Tokens: ${u.input} input, ${u.cacheRead} cache read, ${u.cacheWrite} cache write, ${u.output} output`);
  const file = out || `designs/generated/${(res.design.name || 'house').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  fs.writeFileSync(file, JSON.stringify(res.design, null, 2));
  console.log(`Saved ${file}`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
