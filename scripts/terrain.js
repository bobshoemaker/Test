#!/usr/bin/env node
// Street and slope for an address, as the note the survey and design get.
//   node scripts/terrain.js "3221 Griffith Park Blvd, Los Angeles, CA 90027"
// USGS elevations (public domain) and OpenStreetMap street positions; no key needed.
const { geocode } = require('../src/server/lookup');
const { lookupTerrain, compass } = require('../src/server/terrain');

const address = process.argv.slice(2).join(' ');
if (!address) { console.error('Usage: node scripts/terrain.js "<address>"'); process.exit(2); }
(async () => {
  const place = await geocode(address);
  if (!place) throw new Error('Address not found.');
  console.log(`${place.label}\n  ${place.lat.toFixed(6)}, ${place.lon.toFixed(6)} (${place.precision} match)`);
  const t = await lookupTerrain(place, address);
  t.streets.slice(0, 5).forEach((s) => console.log(`  ${s.name}: ${Math.round(s.distanceM)} m to the ${compass(s.bearingTo)}${t.street && s.name === t.street.name ? '  <- faces the street' : ''}`));
  if (!t.analysis) { console.log('No elevation data came back.'); return; }
  const a = t.analysis;
  console.log(`  Street at ${a.streetFt} ft; across the model it rises ${a.streetRiseRightFt} ft left to right (${a.streetGradePct}% grade).`);
  console.log(`  Lot rises ${a.lotRiseBackFt} ft from the street to the back, ${a.lotRiseRightFt} ft left to right.`);
  console.log(`\nNote for the design:\n${t.note}`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
