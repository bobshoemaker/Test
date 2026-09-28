#!/usr/bin/env node
// Street and slope for an address, as the note the survey and design get.
//   node scripts/terrain.js "3221 Griffith Park Blvd, Los Angeles, CA 90027" [--plate 48]
// USGS elevations (public domain) and OpenStreetMap street positions; no key needed.
const { geocode } = require('../src/server/lookup');
const { lookupTerrain, compass } = require('../src/server/terrain');

const args = process.argv.slice(2), pi = args.indexOf('--plate');
const plate = pi >= 0 ? Number(args.splice(pi, 2)[1]) : 32;
const address = args.join(' ');
if (!address) { console.error('Usage: node scripts/terrain.js "<address>"'); process.exit(2); }
(async () => {
  const place = await geocode(address);
  if (!place) throw new Error('Address not found.');
  console.log(`${place.label}\n  ${place.lat.toFixed(6)}, ${place.lon.toFixed(6)} (${place.precision} match)`);
  const t = await lookupTerrain(place, address, { plate });
  const b = t.building;
  console.log(b ? `  Building: ${b.areaSqFt} sq ft${b.tags.height ? `, ${b.tags.height} m tall` : ''}${b.tags.start_date ? `, built ${b.tags.start_date}` : ''}, ${Math.round(Math.hypot(...[b.center.lat - place.lat, (b.center.lon - place.lon) * Math.cos(place.lat * Math.PI / 180)]) * 111320)} m from the geocoded point; ${b.outbuildings.length} outbuilding(s)`
    : '  Building: not found in OpenStreetMap; measuring from the geocoded point');
  t.streets.slice(0, 5).forEach((s) => console.log(`  ${s.name}: ${Math.round(s.distanceM)} m from the ${b ? 'house' : 'point'}, to the ${compass(s.bearingTo)}${t.frontage.some((f) => f.name === s.name) ? '  <- frontage' : ''}`));
  if (!t.analysis) { console.log('No elevation data came back.'); return; }
  const a = t.analysis;
  a.streets.forEach((st) => console.log(`  ${t.frontage[st.si].name} at ${st.levelFt} ft; across the model it rises ${st.riseRightFt} ft left to right as seen from it (${st.gradePct}% grade).`));
  console.log(`  Lot rises ${a.lotRiseBackFt} ft going back from ${t.frontage[0].name}, ${a.lotRiseRightFt} ft left to right.`);
  console.log(`\nNote for the design:\n${t.note}`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
