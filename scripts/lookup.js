#!/usr/bin/env node
// Address to candidate street photos from the command line.
//   node scripts/lookup.js "200 N Spring St, Los Angeles, CA"              list candidates
//   node scripts/lookup.js "200 N Spring St, Los Angeles, CA" --take 1,3 --out photos/city-hall
//     downloads candidates 1 and 3 plus credits.json; then: node scripts/design.js photos/city-hall/*.jpg
// Needs MAPILLARY_TOKEN for photos; geocoding works without it. Check the photos before designing:
// street-level matches can include the neighbors.
const fs = require('node:fs');
const path = require('node:path');
const { lookupAddress, fetchMapillaryImage } = require('../src/server/lookup');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const out = opt('out', null), take = opt('take', null);
const address = args.join(' ');
if (!address) { console.error('Usage: node scripts/lookup.js "<address>" [--take 1,2,3 --out dir]'); process.exit(2); }

(async () => {
  const r = await lookupAddress(address);
  if (r.place) console.log(`${r.place.label}\n  ${r.place.lat.toFixed(6)}, ${r.place.lon.toFixed(6)}  (${r.place.precision} match, ${r.place.source})`);
  r.notes.forEach((n) => console.log('- ' + n));
  r.photos.forEach((p, i) => console.log(`  ${i + 1}. ${p.distanceM} m, aimed ${p.headingOffDeg} deg off, ${p.capturedAt || 'undated'}, ${p.credit}  ${p.page}`));
  if (!take || !r.photos.length) return;
  const dir = out || `photos/${address.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
  fs.mkdirSync(dir, { recursive: true });
  const credits = [];
  for (const n of take.split(',').map(Number)) {
    const p = r.photos[n - 1]; if (!p) { console.error(`No candidate ${n}`); continue; }
    const img = await fetchMapillaryImage(p.id, process.env.MAPILLARY_TOKEN);
    const file = path.join(dir, `${String(credits.length + 1).padStart(2, '0')}-mapillary-${p.id}.jpg`);
    fs.writeFileSync(file, img.bytes); credits.push({ file: path.basename(file), credit: p.credit, license: p.license, page: p.page });
    console.log(`Saved ${file}`);
  }
  fs.writeFileSync(path.join(dir, 'credits.json'), JSON.stringify({ address, place: r.place, credits }, null, 2));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
