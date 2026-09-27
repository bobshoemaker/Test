// Terrain around an address: the house's own building outline and the streets it fronts
// (OpenStreetMap, via Overpass), and how the ground slopes along each street and back into the
// lot (USGS 3DEP elevations, public domain, via the Elevation Point Query Service). The result is
// a short note for the survey and the design, stated relative to each street ("as seen from the
// street, facing the house"), so it needs no compass directions on the plan. A corner lot gets
// both streets. Street View is not used: Google's terms bar building models from its imagery.
const UA = `Brickhouse/0.4 (terrain${process.env.BRICKHOUSE_CONTACT ? '; ' + process.env.BRICKHOUSE_CONTACT : ''})`;
// Public Overpass servers are often busy; try each in turn.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const EPQS = 'https://epqs.nationalmap.gov/v1/json';
const { scaleFor } = require('./scale');
const FRONTAGE_M = 20; // a street this close to the building's outline is one the lot fronts

const SUFFIX = { blvd: 'boulevard', st: 'street', ave: 'avenue', av: 'avenue', dr: 'drive', rd: 'road', ln: 'lane', ct: 'court',
  pl: 'place', ter: 'terrace', terr: 'terrace', pkwy: 'parkway', cir: 'circle', hwy: 'highway', way: 'way', sq: 'square', trl: 'trail',
  n: 'north', s: 'south', e: 'east', w: 'west' };
const norm = (s) => String(s || '').toLowerCase().replace(/[.,#]/g, ' ').split(/\s+/).filter(Boolean).map((w) => SUFFIX[w] || w).join(' ');
// "3221 Griffith Park Blvd, Los Angeles, CA" -> number "3221", street "griffith park boulevard"
const numberOf = (address) => (/^\s*(\d+[a-z]?)\s/i.exec(String(address || '')) || [])[1] || '';
const streetOf = (address) => norm(String(address || '').split(',')[0].replace(/^\s*\d+[a-z]?\s+/i, ''));

// Local metres east/north of an origin, and back.
function frame(origin) {
  const mLat = 111320, mLon = 111320 * Math.cos(origin.lat * Math.PI / 180);
  return { toXY: (p) => [(p.lon - origin.lon) * mLon, (p.lat - origin.lat) * mLat], toLL: ([e, n]) => ({ lat: origin.lat + n / mLat, lon: origin.lon + e / mLon }) };
}
const unit = (deg) => [Math.sin(deg * Math.PI / 180), Math.cos(deg * Math.PI / 180)];
const LANE_KINDS = ['service', 'track', 'unclassified', 'living_street'], LANE_M = 12;
const compass = (deg) => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];

async function overpass(q, fetchImpl) {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetchImpl(`${OVERPASS[attempt % OVERPASS.length]}?data=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA } });
      if (res.ok) return await res.json();
      last = `${res.status}`;
    } catch (e) { last = e.message; }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`OpenStreetMap query failed (${last})`);
}

// Closest points between a point and a polyline, and between two polylines ([e, n] metres).
function nearestOnLine(p, line) {
  let best = null;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1], dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    const q = [ax + t * dx, ay + t * dy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!best || d < best.d) best = { d, q };
  }
  return best;
}
// Direction of the polyline segment nearest to p.
function nearestSegment(line, p) {
  let best = null;
  for (let i = 0; i + 1 < line.length; i++) { const n = nearestOnLine(p, [line[i], line[i + 1]]); if (n && (!best || n.d < best.d)) best = { d: n.d, dir: [line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]] }; }
  return best ? best.dir : [0, 0];
}
function lineToLine(a, b) {
  let best = null;
  for (const p of a) { const n = nearestOnLine(p, b); if (n && (!best || n.d < best.d)) best = { d: n.d, from: p, to: n.q }; }
  for (const p of b) { const n = nearestOnLine(p, a); if (n && (!best || n.d < best.d)) best = { d: n.d, from: n.q, to: p }; }
  return best;
}
const polygonArea = (pts) => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

// The address's own building in OpenStreetMap (many US areas carry county building outlines,
// sometimes with height and year built), plus outbuildings on the same parcel when tagged.
// Returns {center:{lat,lon}, outline:[{lat,lon}], areaSqFt, tags, outbuildings:[...]} or null.
async function findBuilding(place, address, { fetchImpl = fetch, radiusM = 150 } = {}) {
  const num = numberOf(address), street = streetOf(address);
  if (!num) return null;
  const data = await overpass(`[out:json][timeout:25];way(around:${radiusM},${place.lat},${place.lon})[building];out geom tags;`, fetchImpl);
  const { toXY } = frame(place);
  const all = (data.elements || []).filter((w) => w.type === 'way' && (w.geometry || []).length >= 4).map((w) => {
    const pts = w.geometry.slice(0, -1), xy = pts.map(toXY);
    const c = xy.reduce((a, p) => [a[0] + p[0] / xy.length, a[1] + p[1] / xy.length], [0, 0]);
    return { w, pts, xy, c, area: polygonArea(xy) };
  });
  const hasNumber = (tag) => String(tag || '').split(/[;,]/).some((part) => {
    const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(part);
    return m ? Number(num) >= Number(m[1]) && Number(num) <= Number(m[2]) : part.trim().toLowerCase() === num.toLowerCase();
  });
  const hits = all.filter((b) => hasNumber(b.w.tags['addr:housenumber']) && (!b.w.tags['addr:street'] || !street || norm(b.w.tags['addr:street']) === street))
    .sort((a, b) => Math.hypot(...a.c) - Math.hypot(...b.c));
  if (!hits.length) return null;
  const h = hits[0], parcel = h.w.tags['lacounty:ain'];
  const toLL = frame(place).toLL, center = toLL(h.c);
  const outbuildings = parcel ? all.filter((b) => b !== h && b.w.tags['lacounty:ain'] === parcel && !b.w.tags['addr:housenumber'])
    .map((b) => ({ areaSqFt: Math.round(b.area * 10.764), tags: b.w.tags, center: toLL(b.c), outline: b.pts.map((p) => ({ lat: p.lat, lon: p.lon })) })) : [];
  return { center, outline: h.pts.map((p) => ({ lat: p.lat, lon: p.lon })), areaSqFt: Math.round(h.area * 10.764), tags: h.w.tags, outbuildings };
}

// Named streets near the house, nearest first, measured from the building outline when there is
// one: {name, distanceM, nearest [e, n] on the street, from [e, n] on the house, line}.
async function nearbyStreets(center, opts = {}) { return (await nearbyWays(center, opts)).streets; }

// Streets as above, plus lanes: unnamed or service roads (alleys, shared driveways) within LANE_M of
// the house or an outbuilding, {kind, distanceM, nearest, building (name), line}. A garage by a lane
// often opens onto it.
async function nearbyWays(center, { fetchImpl = fetch, radiusM = 80, outline = null, outbuildings = [] } = {}) {
  const data = await overpass(`[out:json][timeout:20];way(around:${radiusM},${center.lat},${center.lon})[highway];out geom tags;`, fetchImpl);
  const { toXY } = frame(center);
  const ring = (o) => [...o, o[0]].map(toXY);
  const house = outline && outline.length >= 3 ? ring(outline) : [[0, 0]];
  const buildings = [{ name: 'house', pts: house }, ...outbuildings.filter((o) => o.outline && o.outline.length >= 3).map((o, i) => ({ name: outbuildings.length > 1 ? `outbuilding ${i + 1}` : 'outbuilding', pts: ring(o.outline) }))];
  const out = [], lanes = [];
  for (const w of data.elements || []) {
    const line = (w.geometry || []).map(toXY), tags = w.tags || {};
    if (line.length < 2) continue;
    if (LANE_KINDS.includes(tags.highway) && (!tags.name || tags.highway === 'service')) {
      let best = null;
      for (const b of buildings) { const m = lineToLine(b.pts, line); if (m && (!best || m.d < best.m.d)) best = { b, m }; }
      if (best && best.m.d <= LANE_M) lanes.push({ kind: tags.service || tags.highway, name: tags.name, distanceM: best.m.d, nearest: best.m.to, building: best.b.name, line });
      continue;
    }
    if (!tags.name) continue;
    const m = lineToLine(house, line);
    if (m) out.push({ name: w.tags.name, distanceM: m.d, nearest: m.to, from: m.from, line, bearingTo: (Math.atan2(m.to[0], m.to[1]) * 180 / Math.PI + 360) % 360 });
  }
  const seen = new Map();
  for (const s of out.sort((a, b) => a.distanceM - b.distanceM)) {
    const prev = seen.get(s.name);
    if (!prev) seen.set(s.name, s); else prev.line = prev.line.concat([[NaN, NaN]], s.line); // keep every piece of a street
  }
  return { streets: [...seen.values()].map((s) => ({ ...s, line: s.line.filter((p) => Number.isFinite(p[0])) })),
    lanes: lanes.sort((a, b) => a.distanceM - b.distanceM).slice(0, 2) };
}

// The streets the lot fronts: every named street within FRONTAGE_M of the house, the address's own
// street first; if none is that close, the address street or the nearest one.
function frontageStreets(streets, address) {
  const want = streetOf(address), own = (s) => want && norm(s.name) === want;
  const close = streets.filter((s) => s.distanceM <= FRONTAGE_M).sort((a, b) => (own(b) - own(a)) || (a.distanceM - b.distanceM));
  if (close.length) return close.slice(0, 2);
  const fallback = streets.find((s) => own(s) && s.distanceM < 60) || streets[0];
  return fallback ? [fallback] : [];
}
const pickStreet = (streets, address) => frontageStreets(streets, address)[0] || null;

// For a street: which way is "back" (from the street toward the house) and "right" as seen from the
// street facing the house.
function streetFrame(street) {
  const b = [street.from[0] - street.nearest[0], street.from[1] - street.nearest[1]], len = Math.hypot(...b) || 1;
  const back = [b[0] / len, b[1] / len];
  return { back, right: [back[1], -back[0]] }; // facing along back (east, north), right is a quarter turn clockwise
}

// Sample points along each frontage street (t, metres to the right as seen from it) and a grid
// behind the first one (u to the right, v metres back from its nearest point).
function samplePlan(streets) {
  const pts = [];
  streets.forEach((s, si) => {
    const { back, right } = streetFrame(s), [sx, sy] = s.nearest;
    for (const t of [-20, -10, 0, 10, 20]) pts.push({ kind: 'street', si, t, xy: [sx + t * right[0], sy + t * right[1]] });
    if (si === 0) for (const v of [3, 8, 13, 18, 23]) for (const u of [-10, -5, 0, 5, 10]) pts.push({ kind: 'lot', u, v, xy: [sx + u * right[0] + v * back[0], sy + u * right[1] + v * back[1]] });
  });
  return pts;
}

async function elevations(origin, pts, { fetchImpl = fetch, concurrency = 6 } = {}) {
  const { toLL } = frame(origin);
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

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r1 = (x) => Math.round(x * 10) / 10;
function lineSlope(pts) { // ft per metre of t
  const tm = mean(pts.map((p) => p.t)), zm = mean(pts.map((p) => p.ft));
  return pts.reduce((a, p) => a + (p.t - tm) * (p.ft - zm), 0) / pts.reduce((a, p) => a + (p.t - tm) ** 2, 0);
}

// Slopes across the baseplate: each street (left to right as seen from it) and the lot behind the
// first street (toward the back, and left to right).
function analyzeTerrain(samples, { plate = 32 } = {}) {
  const PLATE_M = scaleFor(plate).widthFt * 0.3048;
  const streets = [];
  for (const si of [...new Set(samples.filter((p) => p.kind === 'street').map((p) => p.si))]) {
    const st = samples.filter((p) => p.kind === 'street' && p.si === si && Number.isFinite(p.ft));
    if (st.length >= 3) { const g = lineSlope(st); streets.push({ si, riseRightFt: r1(g * PLATE_M), gradePct: r1(Math.abs(g) / 3.2808 * 100), levelFt: r1(mean(st.map((p) => p.ft))) }); }
  }
  const lot = samples.filter((p) => p.kind === 'lot' && Number.isFinite(p.ft));
  if (!streets.length || lot.length < 9) return null;
  const um = mean(lot.map((p) => p.u)), vm = mean(lot.map((p) => p.v)), lz = mean(lot.map((p) => p.ft));
  let suu = 0, svv = 0, suv = 0, suz = 0, svz = 0;
  for (const p of lot) { const du = p.u - um, dv = p.v - vm, dz = p.ft - lz; suu += du * du; svv += dv * dv; suv += du * dv; suz += du * dz; svz += dv * dz; }
  const det = suu * svv - suv * suv;
  const gu = (suz * svv - svz * suv) / det, gv = (svz * suu - suz * suv) / det;
  const first = streets.find((s) => s.si === 0) || streets[0];
  return { streets, lotRiseBackFt: r1(gv * PLATE_M), lotRiseRightFt: r1(gu * PLATE_M),
    // kept for callers that read the first street directly
    streetRiseRightFt: first.riseRightFt, streetGradePct: first.gradePct, streetFt: first.levelFt };
}

const coursesAt = (plate) => (ft) => { const c = Math.round(Math.abs(ft) / scaleFor(plate).ftPerCourse * 2) / 2; return c < 1 ? 'under 1 course' : `about ${c} course${c === 1 ? '' : 's'}`; };

// The note the survey and the design get. Street slopes are measured well; the lot's rise less so
// (bare-earth data is smoothed and interpolated under the house), so it's framed as approximate.
function terrainNote(t) {
  if (!t || !t.analysis || !t.frontage.length) return '';
  const sc = scaleFor(t.plate), courses = coursesAt(t.plate), L = sc.last;
  const a = t.analysis, [s0, s1] = t.frontage, side = (ft) => (ft > 0 ? 'right' : 'left');
  const b = t.building;
  const parts = [`Terrain (USGS elevation data, public domain; streets${b ? ' and the building outline' : ''} from OpenStreetMap):`];
  if (b) parts.push(`the house's outline is about ${b.areaSqFt} sq ft${b.tags.height ? `, about ${Math.round(Number(b.tags.height) * 3.28)} ft tall` : ''}${b.tags.start_date ? `, built ${b.tags.start_date}` : ''}${b.outbuildings.length ? `, with ${b.outbuildings.length} outbuilding${b.outbuildings.length > 1 ? 's' : ''} on the lot (${b.outbuildings.map((o) => `${o.areaSqFt} sq ft`).join(', ')})` : ''}.`);
  if (s1) {
    const sideOf = (from, to) => { const { right } = streetFrame(from), d = [to.nearest[0] - from.from[0], to.nearest[1] - from.from[1]];
      return d[0] * right[0] + d[1] * right[1] > 0 ? 'right' : 'left'; };
    const a1 = sideOf(s0, s1), a0 = sideOf(s1, s0), x = (sd) => (sd === 'right' ? L : 0);
    parts.push(`It is a corner lot on ${s0.name} and ${s1.name}. Seen from ${s0.name} facing the house, ${s1.name} is on the ${a1}; seen from ${s1.name}, ${s0.name} is on the ${a0}. The street the plan's street side faces goes along z = ${L} and the other one along the side it is on: with ${s0.name} at z = ${L}, ${s1.name} runs along x = ${x(a1)}; with ${s1.name} at z = ${L}, ${s0.name} runs along x = ${x(a0)}.`);
  } else {
    parts.push(`${s0.name} runs along the side of the house that faces the street (z = ${L}).`);
  }
  for (const st of a.streets) {
    const s = t.frontage[st.si];
    parts.push(Math.abs(st.riseRightFt) < 1
      ? `${s.name} is close to level across the model.`
      : `${s.name} slopes about ${st.gradePct}%: across the model's ${sc.widthFt} ft it is ${Math.abs(st.riseRightFt)} ft (${courses(st.riseRightFt)}) higher on the ${side(st.riseRightFt)} as seen from ${s.name} facing the house, so its street, sidewalk and driveway should step up that way.`);
  }
  // where things sit, as seen from the first street facing the house
  const where = (xy) => { const { back, right } = streetFrame(s0), [dx, dy] = [xy[0] - s0.from[0], xy[1] - s0.from[1]];
    const r = dx * right[0] + dy * right[1], k = dx * back[0] + dy * back[1];
    return Math.abs(r) > Math.abs(k) ? (r > 0 ? 'right' : 'left') : (k > 0 ? 'back' : 'front'); };
  const edge = { left: 'x = 0', right: `x = ${L}`, back: 'z = 0', front: `z = ${L}` };
  if (b) for (const [i, o] of b.outbuildings.entries()) {
    const fb = (() => { const { back, right } = streetFrame(s0), d = [o.xy[0] - s0.from[0], o.xy[1] - s0.from[1]];
      const k = d[0] * back[0] + d[1] * back[1], r = d[0] * right[0] + d[1] * right[1]; return `${k > 0 ? 'behind' : 'in front of'} the house${Math.abs(r) > 3 ? ` and to the ${r > 0 ? 'right' : 'left'}` : ''}`; })();
    const g = t.groundFt && t.groundFt[`outbuilding ${i}`], h = t.groundFt && t.groundFt.house;
    const dz = Number.isFinite(g) && Number.isFinite(h) ? Math.round((g - h) * 2) / 2 : null;
    parts.push(`The ${b.outbuildings.length > 1 ? `outbuilding ${i + 1}` : 'outbuilding'} (${o.areaSqFt} sq ft) is ${fb} as seen from ${s0.name}${dz !== null && Math.abs(dz) >= 1.5 ? `; the ground there is about ${Math.abs(dz)} ft (${courses(dz)}) ${dz < 0 ? 'lower' : 'higher'} than at the house` : ''}.`);
  }
  for (const ln of t.lanes || []) {
    // a lane running front to back is on the left or right; one running across is at the back or front
    const { back, right } = streetFrame(s0), seg = nearestSegment(ln.line, ln.nearest);
    const along = Math.abs(seg[0] * back[0] + seg[1] * back[1]) > Math.abs(seg[0] * right[0] + seg[1] * right[1]);
    const side = along ? (ln.nearest[0] * right[0] + ln.nearest[1] * right[1] > 0 ? 'right' : 'left') : (ln.nearest[0] * back[0] + ln.nearest[1] * back[1] > 0 ? 'back' : 'front');
    parts.push(`${ln.name ? ln.name : 'An unnamed lane'} (OpenStreetMap: ${ln.kind}) runs about ${Math.round(ln.distanceM)} m from the ${ln.building}, on the ${side} of the lot as seen from ${s0.name} (${edge[side]} with ${s0.name} at z = ${L}). A garage beside it likely opens onto it: build the lane along that edge at its own level, with a drive from the garage door.`);
  }
  parts.push(`Going back from ${s0.name}, the ground data shows the lot rising about ${a.lotRiseBackFt} ft across the model; it is smoothed and interpolated under the house, so a graded pad or retaining walls can make the real rise at the house larger. Where the photos show more (steps up to the door, a garage below the main floor), go by the photos.`);
  return parts.join(' ');
}

// Building, streets and slopes for a geocoded place. Returns {building, frontage, streets, samples, analysis, note}.
async function lookupTerrain(place, address, { fetchImpl = fetch, plate = 32 } = {}) {
  let building = null;
  try { building = await findBuilding(place, address, { fetchImpl }); } catch { /* fall back to the geocoded point */ }
  const center = building ? building.center : place;
  const { streets, lanes } = await nearbyWays(center, { fetchImpl, outline: building && building.outline, outbuildings: building ? building.outbuildings : [] });
  const frontage = frontageStreets(streets, address);
  if (!frontage.length) return { building, frontage, streets, lanes, samples: [], analysis: null, note: '' };
  // ground at the house and at each outbuilding, to tell whether a garage sits lower or higher
  const { toXY } = frame(center), spots = [{ kind: 'bldg', id: 'house', xy: [0, 0] }];
  if (building) building.outbuildings.forEach((o, i) => { o.xy = toXY(o.center); spots.push({ kind: 'bldg', id: `outbuilding ${i}`, xy: o.xy }); });
  const samples = await elevations(center, [...samplePlan(frontage), ...spots], { fetchImpl });
  const groundFt = Object.fromEntries(samples.filter((p) => p.kind === 'bldg').map((p) => [p.id, p.ft]));
  const t = { building, frontage, streets, lanes, groundFt, street: frontage[0], samples, plate, analysis: analyzeTerrain(samples, { plate }) };
  t.note = terrainNote(t);
  return t;
}

// Input for footprintFromOutline: the house and its outbuildings as polygons in metres around the
// house, the direction to the street that goes at z = 31 (the address street unless frontStreet
// names another frontage street) and, on a corner lot, to the other one. Null without an outline.
function outlineInput(t, { frontStreet = null } = {}) {
  const b = t && t.building;
  if (!b || !t.frontage.length) return null;
  const { toXY } = frame(b.center);
  const want = frontStreet && norm(frontStreet);
  const front = (want && t.frontage.find((s) => norm(s.name) === want)) || t.frontage[0];
  const other = t.frontage.find((s) => s !== front) || null;
  const dir = (s) => { const v = [s.nearest[0] - s.from[0], s.nearest[1] - s.from[1]], n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n]; };
  const levels = (tags) => Math.max(1, Math.min(3, Math.round((Number(tags.height) || 3.5) / 3.3)));
  return {
    front: front.name, side: other && other.name,
    buildings: [{ name: 'House', levels: levels(b.tags), polygon: b.outline.map(toXY) },
      ...b.outbuildings.filter((o) => o.outline).map((o, i) => ({ name: b.outbuildings.length > 1 ? `Outbuilding ${i + 1}` : 'Outbuilding', levels: 1, polygon: o.outline.map(toXY) }))],
    toStreet: dir(front), sideStreet: other ? dir(other) : null,
  };
}

module.exports = { outlineInput, lookupTerrain, findBuilding, nearbyStreets, nearbyWays, frontageStreets, pickStreet, samplePlan, analyzeTerrain, terrainNote, streetOf, numberOf, compass };
