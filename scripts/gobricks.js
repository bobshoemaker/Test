#!/usr/bin/env node
// Builds src/engine/suppliers.js: exactly which parts GoBricks (GDS compatible bricks) makes in which of
// the engine's colors, with its GDS number and catalog price. It asks GoBricks' part-list matcher once
// about every part the engine uses in every palette color (src/server/gobricks.js; ten requests, a
// pause between them). Stock changes daily, so it isn't stored; the server asks for live stock and
// prices per design (/api/quote).
//   node scripts/gobricks.js           (replies cached in .gobricks-cache/; delete it to ask again)
//   node scripts/gobricks.js --fresh   (asks again, ignoring the cache: the monthly refresh, .github/workflows/gobricks-catalog.yml)
// It says what changed since the last snapshot (part-colors GoBricks dropped or added, price changes) and leaves
// the file alone when nothing did; --report FILE also writes that as Markdown (the refresh's pull request).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { match, readReply, testList, LDRAW_COLOR } = require('../src/server/gobricks.js');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, '.gobricks-cache');
const OUT = path.join(ROOT, 'src/engine/suppliers.js');
const BATCH = 200;
const FRESH = process.argv.includes('--fresh');
const REPORT = process.argv.includes('--report') ? process.argv[process.argv.indexOf('--report') + 1] : null;
// Parts GoBricks makes that its store, Brickwith, can't take in a part-list upload (the importer calls them
// "Unknown Part" in every color), so they can't be ordered the way the Parts tab orders. Checked by
// uploading test lists on 2026-09-28; recheck now and then.
const NOT_ORDERABLE = { 60593: 'Window 1 x 2 x 3: unknown to Brickwith\'s upload, in every color and as 3662' };
// GoBricks' own baseplates, a plate thick (3.2 mm), which have no LEGO number, so the matcher can't find
// them: found in GoBricks' and Brickwith's catalogs by hand (2026-09-29). Prices are in dollars as sold:
// the 32 x 32 at Brickwith; the 48 x 48 at GoBricks' own shop (mygobricks.com), Brickwith's not yet checked.
const OWN_BASEPLATES = {
  32: { gds: 'GDS-2237', name: 'Baseplate 32 x 32 x 3.2 (thick)', color: 'Green', code: '040', usd: 6.40 },
  48: { gds: 'GDS-2238', name: 'Baseplate 48 x 48 x 3.2 (thick)', color: 'Green', code: '040', usd: 14.61 },
};
// one matcher request for a batch of lots, cached by the request itself
let sent = 0;
async function matched(lots) {
  const key = crypto.createHash('sha1').update(JSON.stringify(testList(lots))).digest('hex').slice(0, 12);
  const file = path.join(CACHE, `match-${key}.json`);
  if (!FRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (sent++) await new Promise((r) => setTimeout(r, 3000));
  const reply = await match(lots);
  fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file, JSON.stringify(reply));
  return reply;
}

(async () => {
  const { SIZE_PARTS, SPECIAL, COLORS, BASEPLATES } = require('../src/engine/engine.js');
  const ours = new Set();
  for (const kind of Object.values(SIZE_PARTS)) for (const no of Object.values(kind)) ours.add(no);
  for (const s of Object.values(SPECIAL)) { ours.add(s.no); if (s.glass) ours.add(s.glass); }
  const colors = Object.keys(COLORS).filter((c) => LDRAW_COLOR[c] !== undefined);
  const lots = [...ours].flatMap((no) => colors.map((color) => ({ no, color, q: 1 })));
  // the baseplates, in every palette color (a design held to GoBricks takes a neutral one it sells), asked
  // about after the parts so the parts' replies stay cached
  const plates = Object.values(BASEPLATES).flatMap((b) => colors.map((color) => ({ no: b.no, color, q: 1 })));
  for (const b of plates) ours.add(b.no);
  // made: part -> color -> catalog price; a GDS number is the part's number and the color's code
  // (GDS-536 in Tan, 031, is GDS-536-031). Out of stock today still counts as made.
  const made = {}, gdsOf = {}, colorCode = {};
  let asked = 0;
  const batches = [];
  for (let k = 0; k * BATCH < lots.length; k++) batches.push(lots.slice(k * BATCH, (k + 1) * BATCH));
  batches.push(plates);
  for (const batch of batches) {
    const r = readReply(await matched(batch), batch);
    asked += batch.length;
    for (const i of [...r.made, ...r.outOfStock]) { const m = /^(GDS-\d+)-(\d+)$/.exec(i.gds || ''); if (!m || !i.color) continue;
      (made[i.no] = made[i.no] || {})[i.color] = i.price;
      gdsOf[i.no] = gdsOf[i.no] || m[1]; colorCode[i.color] = colorCode[i.color] || m[2]; }
    process.stdout.write(`\r${asked} of ${lots.length + plates.length} asked`);
  }
  console.log();
  for (const no of Object.keys(NOT_ORDERABLE)) delete made[no];
  const parts = Object.fromEntries([...ours].filter((no) => gdsOf[no]).map((no) => [no, gdsOf[no]]));
  const madeColors = Object.fromEntries(colors.filter((c) => colorCode[c]).map((c) => [c, colorCode[c]]));
  const sorted = Object.fromEntries(Object.keys(made).sort().map((no) => [no, made[no]]));
  // what changed since the last snapshot; nothing changed, nothing written (not even the date)
  const was = fs.existsSync(OUT) ? require(OUT).SUPPLIERS.gobricks : null;
  const next = { parts, colors: madeColors, made: sorted, baseplates: OWN_BASEPLATES };
  if (was && JSON.stringify(next) === JSON.stringify({ parts: was.parts, colors: was.colors, made: was.made, baseplates: was.baseplates })) {
    console.log(`No change since ${was.asOf}; ${path.relative(ROOT, OUT)} left as it was.`);
    if (REPORT) fs.writeFileSync(REPORT, '');
    return;
  }
  const pairs = (m) => new Set(Object.entries(m || {}).flatMap(([no, cs]) => Object.keys(cs).map((c) => `${no} ${c}`)));
  const before = pairs(was && was.made), after = pairs(sorted);
  const dropped = [...before].filter((k) => !after.has(k)), added = [...after].filter((k) => !before.has(k));
  const repriced = [...after].filter((k) => before.has(k)).filter((k) => { const [no, ...c] = k.split(' '); return was.made[no][c.join(' ')] !== sorted[no][c.join(' ')]; });
  const report = [`GoBricks catalog refresh${was ? `, changes since ${was.asOf}` : ''}:`, '',
    `- **No longer made (${dropped.length})**${dropped.length ? ': ' + dropped.join(', ') + '. Designs using these now get a supplier warning, and existing designs held to GoBricks may need a redesign.' : ''}`,
    `- **Newly made (${added.length})**${added.length ? ': ' + added.join(', ') : ''}`,
    `- **Catalog price changed (${repriced.length})**${repriced.length ? ': ' + repriced.slice(0, 40).join(', ') + (repriced.length > 40 ? ', …' : '') : ''}`].join('\n');
  console.log(report);
  if (REPORT) fs.writeFileSync(REPORT, report + '\n');
  const asOf = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(OUT, `// Compatible-brick suppliers the engine can hold a design to ("supplier" on the design). GoBricks (GDS):
// made[part][color] = catalog price in yuan, for every part and palette color GoBricks makes, from its
// part-list matcher on ${asOf}. A GDS number is parts[part] + '-' + colors[color] (GDS-536-031: 1 x 8 brick, Tan).
// Left out as not orderable (Brickwith's part-list upload doesn't know them): ${Object.keys(NOT_ORDERABLE).join(', ') || 'none'}.
// baseplates[plate size]: GoBricks' own thick baseplates (no LEGO number), with their dollar price.
// Generated by scripts/gobricks.js; don't edit.
const SUPPLIERS = ${JSON.stringify({ gobricks: { name: 'GoBricks', asOf, currency: 'CNY', order: 'https://www.brickwith.com/en/part-list/upload', parts, colors: madeColors, made: sorted, baseplates: OWN_BASEPLATES } })};
if (typeof module !== 'undefined') module.exports = { SUPPLIERS };
`);
  const n = Object.values(made).reduce((t, m) => t + Object.keys(m).length, 0);
  console.log(`Wrote ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB): ${n} of ${lots.length + plates.length} part-colors made, ${Object.keys(made).length} of ${ours.size} parts in some color.`);
  console.log(`Not made in any palette color: ${[...ours].filter((no) => !made[no]).join(', ') || 'none'}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
