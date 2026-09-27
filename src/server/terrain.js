// Terrain around an address: which way the street lies (OpenStreetMap, via Overpass) and how the
// ground slopes along the street and back into the lot (USGS 3DEP elevations, public domain, via
// the Elevation Point Query Service). The result is a short note for the survey and the design,
// in the model's terms: x runs left to right as seen from the street, the street is at z = 31.
// Street View is not used: Google's terms bar building models from its imagery.
const { distanceM } = require('./lookup');

const UA = `Brickhouse/0.4 (terrain${process.env.BRICKHOUSE_CONTACT ? '; ' + process.env.BRICKHOUSE_CONTACT : ''})`;
// Public Overpass servers are often busy; try each in turn.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const EPQS = 'https://epqs.nationalmap.gov/v1/json';
const FT_PER_COURSE = 2.5; // a story is about 10 ft and 4 courses at 2 ft per stud
const PLATE_M = 32 * 2 * 0.3048; // the baseplate's 64 ft

const SUFFIX = { blvd: 'boulevard', st: 'street', ave: 'avenue', av: 'avenue', dr: 'drive', rd: 'road', ln: 'lane', ct: 'court',
  pl: 'place', ter: 'terrace', terr: 'terrace', pkwy: 'parkway', cir: 'circle', hwy: 'highway', way: 'way', sq: 'square', trl: 'trail',
  n: 'north', s: 'south', e: 'east', w: 'west' };
const norm = (s) => String(s || '').toLowerCase().replace(/[.,#]/g, ' ').split(/\s+/).filter(Boolean).map((w) => SUFFIX[w] || w).join(' ');
// "3221 Griffith Park Blvd, Los Angeles, CA" -> "griffith park boulevard"
const streetOf = (address) => norm(String(address || '').split(',')[0].replace(/^\s*\d+[a-z]?\s+/i, ''));

// Local metres east/north of the place, and back.
function frame(place) {
  const mLat = 111320, mLon = 111320 * Math.cos(place.lat * Math.PI / 180);
  return { toXY: (p) => [(p.lon - place.lon) * mLon, (p.lat - place.lat) * mLat], toLL: ([e, n]) => ({ lat: place.lat + n / mLat, lon: place.lon + e / mLon }) };
}
const unit = (deg) => [Math.sin(deg * Math.PI / 180), Math.cos(deg * Math.PI / 180)];
const compass = (deg) => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];

// Named streets near the place, nearest first: {name, distanceM, bearingTo (house to street), nearest [e, n]}.
async function nearbyStreets(place, { fetchImpl = fetch, radiusM = 80 } = {}) {
  const q = `[out:json][timeout:20];way(around:${radiusM},${place.lat},${place.lon})[highway][name];out geom;`;
  let data = null, last = '';
  for (let attempt = 0; attempt < 4 && !data; attempt++) {
    const base = OVERPASS[attempt % OVERPASS.length];
    try {
      const res = await fetchImpl(`${base}?data=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA } });
      if (res.ok) data = await res.json(); else last = `${res.status}`;
    } catch (e) { last = e.message; }
    if (!data && attempt < 3) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (!data) throw new Error(`OpenStreetMap street query failed (${last})`);
  const { toXY } = frame(place), out = [];
  for (const w of data.elements || []) {
    const g = (w.geometry || []).map(toXY);
    let best = null;
    for (let i = 0; i + 1 < g.length; i++) {
      const [ax, ay] = g[i], [bx, by] = g[i + 1], dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px, py);
      if (!best || d < best.d) best = { d, px, py };
    }
    if (best) out.push({ name: w.tags.name, distanceM: best.d, bearingTo: (Math.atan2(best.px, best.py) * 180 / Math.PI + 360) % 360, nearest: [best.px, best.py] });
  }
  const seen = new Map();
  for (const s of out.sort((a, b) => a.distanceM - b.distanceM)) if (!seen.has(s.name)) seen.set(s.name, s);
  return [...seen.values()];
}

// The address's own street if it's close, else the nearest one.
function pickStreet(streets, address) {
  const want = streetOf(address);
  return streets.find((s) => want && norm(s.name) === want && s.distanceM < 60) || streets[0] || null;
}

// Sample points: along the street (t, metres to the right as seen from the street, facing the house)
// and a grid in the lot (u to the right, v metres back from the street's nearest point).
function samplePlan(street) {
  const back = (street.bearingTo + 180) % 360, right = (back + 90) % 360;
  const [bx, by] = unit(back), [rx, ry] = unit(right), [sx, sy] = street.nearest;
  const pts = [];
  for (const t of [-20, -10, 0, 10, 20]) pts.push({ kind: 'street', t, xy: [sx + t * rx, sy + t * ry] });
  for (const v of [3, 8, 13, 18, 23]) for (const u of [-10, -5, 0, 5, 10]) pts.push({ kind: 'lot', u, v, xy: [sx + u * rx + v * bx, sy + u * ry + v * by] });
  return pts;
}

async function elevations(place, pts, { fetchImpl = fetch, concurrency = 6 } = {}) {
  const { toLL } = frame(place);
  const out = pts.map((p) => ({ ...p, ft: NaN }));
  let next = 0;
  async function worker() {
    for (let i; (i = next++) < out.length;) {
      const ll = toLL(out[i].xy);
      for (let tries = 0; tries < 3 && !Number.isFinite(out[i].ft); tries++) {
        try {
          const res = await fetchImpl(`${EPQS}?x=${ll.lon}&y=${ll.lat}&wkid=4326&units=Feet&includeDate=false`, { headers: { 'user-agent': UA } });
          if (res.ok) { const v = Number((await res.json()).value); if (Number.isFinite(v) && v > -1000) out[i].ft = v; }
        } catch { /* retry */ }
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

// Least-squares slopes: along the street (ft per m to the right) and a plane over the lot.
function analyzeTerrain(samples) {
  const st = samples.filter((p) => p.kind === 'street' && Number.isFinite(p.ft));
  const lot = samples.filter((p) => p.kind === 'lot' && Number.isFinite(p.ft));
  if (st.length < 3 || lot.length < 9) return null;
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const tm = mean(st.map((p) => p.t)), zm = mean(st.map((p) => p.ft));
  const streetSlope = st.reduce((a, p) => a + (p.t - tm) * (p.ft - zm), 0) / st.reduce((a, p) => a + (p.t - tm) ** 2, 0);
  // Plane z = c + gu*u + gv*v over the lot grid (normal equations; the grid is centered in u).
  const um = mean(lot.map((p) => p.u)), vm = mean(lot.map((p) => p.v)), lz = mean(lot.map((p) => p.ft));
  let suu = 0, svv = 0, suv = 0, suz = 0, svz = 0;
  for (const p of lot) { const du = p.u - um, dv = p.v - vm, dz = p.ft - lz; suu += du * du; svv += dv * dv; suv += du * dv; suz += du * dz; svz += dv * dz; }
  const det = suu * svv - suv * suv;
  const gu = (suz * svv - svz * suv) / det, gv = (svz * suu - suz * suv) / det;
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    streetRiseRightFt: r1(streetSlope * PLATE_M), // across the baseplate, left to right as seen from the street
    streetGradePct: r1(Math.abs(streetSlope) / 3.2808 * 100),
    lotRiseBackFt: r1(gv * PLATE_M), // from the street edge to the back of the baseplate
    lotRiseRightFt: r1(gu * PLATE_M),
    streetFt: r1(zm),
  };
}

const courses = (ft) => { const c = Math.abs(ft) / FT_PER_COURSE; return c < 0.75 ? 'under 1 course' : `about ${Math.round(c * 2) / 2} course${Math.round(c * 2) / 2 === 1 ? '' : 's'}`; };

// The note the survey and the design get. Street slope is measured well; the lot's rise less so
// (bare-earth data is smoothed and interpolated under the house), so it's framed as approximate.
function terrainNote(t) {
  if (!t || !t.analysis) return '';
  const a = t.analysis, s = t.street;
  const side = (ft) => (ft > 0 ? 'right' : 'left');
  const others = (t.streets || []).filter((x) => x.name !== s.name && x.distanceM < 40).map((x) => `${x.name} is ${Math.round(x.distanceM)} m to the ${compass(x.bearingTo)}`);
  const parts = [
    `Terrain (USGS elevation data, public domain; street positions from OpenStreetMap): ${s.name} runs past the ${compass(s.bearingTo)} side of the house, about ${Math.round(s.distanceM)} m from the address point; that side faces the street (z = 31).`,
    Math.abs(a.streetRiseRightFt) < 1
      ? 'The street is close to level across the model.'
      : `The street slopes about ${a.streetGradePct}%: across the model's 64 ft it is ${Math.abs(a.streetRiseRightFt)} ft (${courses(a.streetRiseRightFt)}) higher on the ${side(a.streetRiseRightFt)} as seen from the street, so the street, sidewalk and driveway should step up toward x = ${a.streetRiseRightFt > 0 ? 31 : 0}.`,
    `The ground data shows the lot rising about ${a.lotRiseBackFt} ft from the street to the back of the model; it is smoothed and interpolated under the house, so a graded pad or retaining walls can make the real rise at the house larger. Where the photos show more (steps up to the door, a garage below the main floor), go by the photos.`,
    others.length ? `Also nearby: ${others.join('; ')}.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

// Street and slopes for a geocoded place. Returns {street, streets, samples, analysis, note}.
async function lookupTerrain(place, address, { fetchImpl = fetch } = {}) {
  const streets = await nearbyStreets(place, { fetchImpl });
  const street = pickStreet(streets, address);
  if (!street) return { street: null, streets, samples: [], analysis: null, note: '' };
  const samples = await elevations(place, samplePlan(street), { fetchImpl });
  const t = { street, streets, samples, analysis: analyzeTerrain(samples) };
  t.note = terrainNote(t);
  return t;
}

module.exports = { lookupTerrain, nearbyStreets, pickStreet, samplePlan, analyzeTerrain, terrainNote, streetOf, compass, distanceM };
