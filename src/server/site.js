// Finding the house and mapping it from above, for any US address, before Claude designs it. Every step uses
// open data that covers the whole country, and county data where a county publishes more:
//   1. Candidates: the buildings near the address lookup's point (FEMA USA Structures, CC BY 4.0, about 135
//      million US building outlines, merged with OpenStreetMap), numbered on a USDA NAIP aerial photo (public
//      domain, via USGS).
//   2. The pick: Claude compares the owner's photos with the numbered buildings (and close-ups it asks for) and
//      says which is the house, how sure it is, and why. Geocoders often land a few lots away; this doesn't.
//   3. Records: where the county publishes them (LA County today), its sharper building outline replaces the
//      national one and its parcel gives the lot line and the house's facts, and checks the pick's address.
//   4. The map: Claude (a stronger model when asked) splits the building into blocks by height and roof, places
//      the garage and doors, and maps the lot (driveway, patios, trees, fences), on the aerial turned so the
//      street is at the bottom with a grid in feet; each submission comes back drawn over the aerial.
//   5. The fit: the scale is chosen so the whole house fits the size (within the size's range), and the model's
//      walls are locked to the map (footprint.js); the lot is laid out in studs for the design.
// Every step is recorded (report.stages: what it found and why, with its pictures) and costed.
const { overpass, frame, nearestOnLine, polygonArea, norm, streetOf, numberOf, nearbyWays, lookupTerrain, propertyHint, compass,
  analyzeTerrain, terrainNote } = require('./terrain');
const { layoutFootprint } = require('./footprint');
const { scaleFor, sizeName } = require('./scale');
const { PICK_SPEC, PICK_TOOLS, pickTask, SITE_SPEC, SITE_TOOL, siteTask } = require('./prompt');
const { photoList } = require('./views');
const { costOf, emptyUsage } = require('./cost');

const UA = `Brickhouse/0.4 (site${process.env.BRICKHOUSE_CONTACT ? '; ' + process.env.BRICKHOUSE_CONTACT : ''})`;
const FT = 0.3048;
const NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';
// The same public-domain imagery as USGS's cached basemap: the fallback when the NAIP image server is busy.
const NAIP_BASEMAP = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export';
const STRUCTURES = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query';
// US Census TIGER road centre lines with their names (public domain, nationwide), for the streets around the house.
const TIGER_ROADS = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/8/query';
// Counties that publish sharper outlines and parcels, by FIPS code (the structures data carries it).
const COUNTIES = {
  '06037': {
    name: 'Los Angeles County',
    outlines: { url: 'https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Countywide_Building_Outlines_(2020)/FeatureServer/0/query',
      source: 'LA County building outlines (LARIAC, 2020)', read: (a) => ({ heightFt: Number(a.HEIGHT) || null, areaSqFt: Number(a.AREA) || null, year: a.DATE_ }) },
    parcels: { url: 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query', source: 'LA County Assessor parcels',
      read: (a) => ({ apn: a.APN, address: String(a.SitusFullAddress || '').trim(), number: String(a.SitusHouseNo || '').trim(), street: String(a.SitusStreet || '').trim(),
        facts: { yearBuilt: Number(a.YearBuilt1) || null, bedrooms: Number(a.Bedrooms1) || null, bathrooms: Number(a.Bathrooms1) || null,
          sqft: Number(a.SQFTmain1) || null, units: Number(a.Units1) || null, use: [a.UseType, a.UseDescription].filter(Boolean).join(', ') } }) },
  },
};

// ---------- geometry ----------
const R_EARTH = 6378137;
const merc = (ll) => [R_EARTH * ll.lon * Math.PI / 180, R_EARTH * Math.log(Math.tan(Math.PI / 4 + ll.lat * Math.PI / 360))];
const unmerc = ([x, y]) => ({ lon: x / R_EARTH * 180 / Math.PI, lat: (2 * Math.atan(Math.exp(y / R_EARTH)) - Math.PI / 2) * 180 / Math.PI });
function centroid(p) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length], k = x0 * y1 - x1 * y0; a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k; }
  if (Math.abs(a) < 1e-9) return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  return [cx / (3 * a), cy / (3 * a)];
}
function pointIn([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const bboxOf = (pts) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
// Shared area of two polygons (same units), sampled on a grid of `step`.
function overlapArea(a, b, step = 0.5) {
  const [x0, y0, x1, y1] = bboxOf(a);
  let n = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (pointIn([x, y], a) && pointIn([x, y], b)) n++;
  return n * step * step;
}
// The four directions of a building's walls, from its edges (angles folded to a quarter turn).
function wallAxes(xy) {
  let sx = 0, sy = 0;
  xy.forEach((p, i) => { const q = xy[(i + 1) % xy.length], dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy), a = Math.atan2(dy, dx) * 4; sx += len * Math.cos(a); sy += len * Math.sin(a); });
  const t = Math.atan2(sy, sx) / 4;
  return [0, 1, 2, 3].map((k) => [Math.cos(t + k * Math.PI / 2), Math.sin(t + k * Math.PI / 2)]);
}
const unitVec = (v) => { const n = Math.hypot(v[0], v[1]) || 1; return [v[0] / n, v[1] / n]; };
const dropClosing = (ring) => (ring.length > 1 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lon === ring[ring.length - 1].lon ? ring.slice(0, -1) : ring);

// A frame in feet around origin: u to the right as seen from the street facing the house, v away from the
// street (back is the unit vector pointing away from it, in local east/north metres).
function siteFrame(origin, back) {
  const b = unitVec(back), r = [b[1], -b[0]], { toXY, toLL } = frame(origin);
  return { origin, back: b, right: r,
    toUV: (ll) => { const [e, n] = toXY(ll); return [(e * r[0] + n * r[1]) / FT, (e * b[0] + n * b[1]) / FT]; },
    toLL: ([u, v]) => toLL([(u * r[0] + v * b[0]) * FT, (u * r[1] + v * b[1]) * FT]) };
}

// ---------- open data ----------
async function arcQuery(url, params, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const q = new URLSearchParams({ outFields: '*', outSR: '4326', returnGeometry: 'true', f: 'json', ...params });
  let last = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchImpl(`${url}?${q}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(j.error.message || 'query failed');
      return j.features || [];
    } catch (e) { last = e; if (i < 2) await new Promise((r) => setTimeout(r, 1200 * (i + 1))); }
  }
  throw new Error(`${new URL(url).host}: ${last && last.message}`);
}
const nearPoint = (ll, m) => ({ geometry: `${ll.lon},${ll.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: String(m), units: 'esriSRUnit_Meter' });
const ringOf = (f) => dropClosing(((f.geometry && f.geometry.rings && f.geometry.rings[0]) || []).map(([lon, lat]) => ({ lat, lon })));

async function structuresNear(ll, radiusM, opts) {
  const fs = await arcQuery(STRUCTURES, nearPoint(ll, radiusM), opts);
  return fs.map((f) => { const a = f.attributes || {};
    return { id: `usa-${a.OBJECTID}`, source: 'FEMA USA Structures', ring: ringOf(f), areaSqFt: Math.round(Number(a.SQFEET)) || null,
      heightFt: Number(a.HEIGHT) ? Number(a.HEIGHT) * 3.2808 : null, use: a.PRIM_OCC || a.OCC_CLS || null, fips: a.FIPS || null,
      imageDate: a.IMAGE_DATE ? new Date(a.IMAGE_DATE).toISOString().slice(0, 10) : null }; })
    .filter((b) => b.ring.length >= 3);
}
async function osmNear(ll, radiusM, { fetchImpl = fetch } = {}) {
  const data = await overpass(`[out:json][timeout:25];way(around:${radiusM},${ll.lat},${ll.lon})[building];out geom tags;`, fetchImpl);
  return (data.elements || []).filter((w) => w.type === 'way' && (w.geometry || []).length >= 4).map((w) => { const t = w.tags || {};
    return { id: `osm-${w.id}`, source: 'OpenStreetMap', ring: dropClosing(w.geometry.map((g) => ({ lat: g.lat, lon: g.lon }))),
      heightFt: Number(t.height) ? Number(t.height) * 3.2808 : null, use: t.building && t.building !== 'yes' ? t.building : null,
      address: t['addr:housenumber'] ? `${t['addr:housenumber']} ${t['addr:street'] || ''}`.trim() : null }; });
}
// Named streets around a point from TIGER, as nearbyWays gives them: {name, distanceM, nearest, from, line} in metres.
async function tigerStreets(ll, radiusM, opts) {
  const fs = await arcQuery(TIGER_ROADS, { ...nearPoint(ll, radiusM), outFields: 'NAME,MTFCC' }, opts);
  const { toXY } = frame(ll), byName = new Map();
  for (const f of fs) {
    const name = String((f.attributes || {}).NAME || '').trim(), paths = (f.geometry && f.geometry.paths) || [];
    if (!name) continue;
    for (const path of paths) {
      const line = path.map(([lon, lat]) => toXY({ lat, lon })), q = nearestOnLine([0, 0], line);
      if (!q) continue;
      const prev = byName.get(name);
      if (!prev) byName.set(name, { name, distanceM: q.d, nearest: q.q, from: [0, 0], line });
      else { prev.line = prev.line.concat([[NaN, NaN]], line); if (q.d < prev.distanceM) Object.assign(prev, { distanceM: q.d, nearest: q.q }); } // pieces stay apart
    }
  }
  return [...byName.values()].sort((a, b) => a.distanceM - b.distanceM);
}
// "East Brisbane Street" is the address's "Brisbane St": the same street, directions aside.
const bareStreet = (s) => norm(s).replace(/^(north|south|east|west) /, '').replace(/ (north|south|east|west)$/, '');
const sameStreet = (a, b) => !!a && !!b && bareStreet(a) === bareStreet(b);
// National outlines first; OpenStreetMap adds its addresses to them, and its own buildings where they have none.
function mergeBuildings(structs, osm, toXY) {
  const withXY = (b) => { const xy = b.ring.map(toXY); return { ...b, xy, c: centroid(xy), areaSqFt: b.areaSqFt || Math.round(polygonArea(xy) * 10.764) }; };
  const S = structs.map(withXY), O = osm.map(withXY);
  for (const o of O) {
    const host = S.find((s) => pointIn(o.c, s.xy) || pointIn(s.c, o.xy));
    if (host) { if (o.address && !host.address) host.address = o.address; o.merged = true; }
  }
  return [...S, ...O.filter((o) => !o.merged)];
}
// The buildings to choose from: house-sized, nearest the point first, numbered from 1.
function numberCandidates(all, { maxM = 110, max = 14 } = {}) {
  return all.filter((b) => b.areaSqFt >= 450 && b.areaSqFt <= 15000 && Math.hypot(...b.c) <= maxM)
    .sort((a, b) => Math.hypot(...a.c) - Math.hypot(...b.c)).slice(0, max).map((b, i) => ({ ...b, n: i + 1 }));
}

async function parcelAt(ll, county, opts) {
  if (!county || !county.parcels) return null;
  const fs = await arcQuery(county.parcels.url, nearPoint(ll, 1), opts);
  const { toXY } = frame(ll);
  const f = fs.find((x) => pointIn([0, 0], ringOf(x).map(toXY))) || fs[0];
  return f ? { ...county.parcels.read(f.attributes || {}), ring: ringOf(f), source: county.parcels.source } : null;
}
// The county's own outline for a building: the one sharing the most area with it.
async function countyOutline(building, county, opts) {
  if (!county || !county.outlines) return null;
  const c = building.centerLL;
  const fs = await arcQuery(county.outlines.url, nearPoint(c, 25), opts);
  const { toXY } = frame(c), mine = building.ring.map(toXY);
  let best = null;
  for (const f of fs) {
    const ring = ringOf(f), xy = ring.map(toXY), shared = overlapArea(mine, xy);
    if (shared > 0 && (!best || shared > best.shared)) best = { ring, shared, ...county.outlines.read(f.attributes || {}) };
  }
  return best && best.shared >= 0.3 * polygonArea(mine) ? { ...best, source: county.outlines.source } : null;
}

// USDA NAIP aerial (via USGS, public domain) around a point, north up, as a JPEG, resampled smoothly (NAIP is 30 to
// 60 cm a pixel; blocky pixels read as detail that isn't there). Cached per request.
const naipCache = new Map();
async function naipImage(center, halfM, { px = 1024, fetchImpl = fetch } = {}) {
  const [mx, my] = merc(center), h = halfM / Math.cos(center.lat * Math.PI / 180), bbox = [mx - h, my - h, mx + h, my + h];
  const key = bbox.map((v) => v.toFixed(1)).join(',') + '|' + px;
  if (!naipCache.has(key)) {
    naipCache.set(key, (async () => {
      const q = `bbox=${bbox.join(',')}&bboxSR=3857&imageSR=3857&size=${px},${px}&format=jpg`;
      // the image server first, a few times with growing pauses (it answers 502 when busy), then the basemap
      const tries = [`${NAIP}?${q}&interpolation=RSP_BilinearInterpolation&f=image`, `${NAIP}?${q}&interpolation=RSP_BilinearInterpolation&f=image`,
        `${NAIP}?${q}&interpolation=RSP_BilinearInterpolation&f=image`, `${NAIP_BASEMAP}?${q}&f=image`, `${NAIP}?${q}&interpolation=RSP_BilinearInterpolation&f=image`, `${NAIP_BASEMAP}?${q}&f=image`];
      let last = null;
      for (let i = 0; i < tries.length; i++) {
        try {
          const res = await fetchImpl(tries[i], { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(45000) });
          const type = res.headers.get('content-type') || '';
          if (!res.ok || !/^image\//.test(type)) throw new Error(`HTTP ${res.status} ${type}`);
          return Buffer.from(await res.arrayBuffer()).toString('base64');
        } catch (e) { last = e; if (i < tries.length - 1) await new Promise((r) => setTimeout(r, [2000, 4000, 1000, 8000, 1000][i] || 2000)); }
      }
      naipCache.delete(key);
      throw new Error(`Aerial photo (USGS NAIP): ${last && last.message}`);
    })());
    if (naipCache.size > 60) naipCache.delete(naipCache.keys().next().value);
  }
  const data = await naipCache.get(key);
  return { mediaType: 'image/jpeg', data, W: px, H: px,
    pxToLL: (ix, iy) => unmerc([bbox[0] + ix * (bbox[2] - bbox[0]) / px, bbox[3] - iy * (bbox[3] - bbox[1]) / px]) };
}
// When and how sharp the NAIP photo at a point is: {date: '2022-05-12', year, metres}, or null.
async function naipDate(ll, { fetchImpl = fetch } = {}) {
  try {
    const q = new URLSearchParams({ geometry: `${ll.lon},${ll.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
      where: 'Category=1', outFields: 'Year,acquisition_date,resolution_value', returnGeometry: 'false', f: 'json' });
    const res = await fetchImpl(`${NAIP.replace(/\/exportImage$/, '/query')}?${q}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
    const fs = ((await res.json()).features || []).map((f) => f.attributes || {}).filter((a) => a.acquisition_date).sort((a, b) => b.acquisition_date - a.acquisition_date);
    return fs.length ? { date: new Date(fs[0].acquisition_date).toISOString().slice(0, 10), year: fs[0].Year, metres: fs[0].resolution_value } : null;
  } catch { return null; }
}
// An aerial drawn onto a canvas through any mapping toC(lat/lon) -> [x, y] (turned, scaled), with shapes on top.
async function aerialImage({ tools, width, height, corners, toC, shapes = [], fetchImpl }) {
  const cLL = { lat: corners.reduce((s, c) => s + c.lat, 0) / corners.length, lon: corners.reduce((s, c) => s + c.lon, 0) / corners.length };
  const { toXY } = frame(cLL), halfM = Math.max(...corners.map((c) => Math.hypot(...toXY(c)))) + 5;
  const px = Math.min(1600, Math.max(400, Math.round(2 * halfM / 0.25)));
  const img = await naipImage(cLL, halfM, { px, fetchImpl });
  const P = (ix, iy) => toC(img.pxToLL(ix, iy));
  const [X0, Y0] = P(0, 0), [X1, Y1] = P(img.W, 0), [X2, Y2] = P(0, img.H);
  const transform = [(X1 - X0) / img.W, (Y1 - Y0) / img.W, (X2 - X0) / img.H, (Y2 - Y0) / img.H, X0, Y0];
  const data = await tools.drawLayers({ width, height, image: { src: `data:${img.mediaType};base64,${img.data}`, transform }, shapes });
  return { mediaType: 'image/jpeg', data, width, height };
}
// The aerial in a site frame: u (feet) left to right, v (feet) bottom to top, pxPerFt pixels a foot.
async function frameImage({ tools, fr, u: [u0, u1], v: [v0, v1], pxPerFt, shapes = () => [], fetchImpl }) {
  const width = Math.round((u1 - u0) * pxPerFt), height = Math.round((v1 - v0) * pxPerFt);
  const toC = ([u, v]) => [(u - u0) * pxPerFt, (v1 - v) * pxPerFt], llToC = (ll) => toC(fr.toUV(ll));
  const corners = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]].map(fr.toLL);
  return aerialImage({ tools, width, height, corners, toC: llToC, shapes: shapes(toC, llToC, width, height), fetchImpl });
}

// ---------- drawing ----------
const label = (text, x, y, o = {}) => ({ text, x, y, size: o.size || 12, color: o.color || '#fff', bg: o.bg === undefined ? 'rgba(0,0,0,.6)' : o.bg, align: o.align || 'center', bold: o.bold });
function gridShapes(toC, [u0, u1], [v0, v1], width, height, { every = 10, labelEvery = 20 } = {}) {
  const out = [];
  for (let u = Math.ceil(u0 / 5) * 5; u <= u1; u += 5) {
    const [x] = toC([u, 0]);
    out.push({ line: [x, 0, x, height], stroke: u % every ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.42)', width: 1 });
    if (u % labelEvery === 0) out.push(label(String(u), x, 9, { size: 11 }));
  }
  for (let v = Math.ceil(v0 / 5) * 5; v <= v1; v += 5) {
    const [, y] = toC([0, v]);
    out.push({ line: [0, y, width, y], stroke: v % every ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.42)', width: 1 });
    if (v % labelEvery === 0) out.push(label(String(v), 3, y, { size: 11, align: 'left' }));
  }
  out.push(label('u (ft) →', width - 4, 9, { size: 11, align: 'right' }), label('↑ v (ft)', 3, height - 30, { size: 11, align: 'left' }));
  out.push(label('STREET SIDE', width / 2, height - 10, { bold: true }));
  return out;
}
const scaleBar = (x, y, ftLen, pxPerFt) => [{ line: [x, y, x + ftLen * pxPerFt, y], stroke: '#fff', width: 3 }, label(`${ftLen} ft`, x + ftLen * pxPerFt / 2, y - 11, { size: 11 })];

// ---------- step 2: the pick ----------
const imageBlock = (p) => ({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } });
function addUsage(usage, msg) {
  const u = msg.usage || {};
  usage.input += u.input_tokens || 0; usage.cacheRead += u.cache_read_input_tokens || 0;
  usage.cacheWrite += u.cache_creation_input_tokens || 0; usage.output += u.output_tokens || 0;
}
const bearingOf = ([e, n]) => (Math.atan2(e, n) * 180 / Math.PI + 360) % 360;
// Each candidate as seen from its nearest street: which side of it, and how wide and deep its outline is.
function facingStreets(candidates, streets) {
  for (const c of candidates) {
    let best = null;
    for (const st of streets) { const q = nearestOnLine(c.c, st.line); if (q && (!best || q.d < best.q.d)) best = { st, q }; }
    if (!best || best.q.d > 70) continue;
    const back = unitVec([c.c[0] - best.q.q[0], c.c[1] - best.q.q[1]]), right = [back[1], -back[0]];
    const us = c.xy.map((p) => (p[0] - c.c[0]) * right[0] + (p[1] - c.c[1]) * right[1]), vs = c.xy.map((p) => (p[0] - c.c[0]) * back[0] + (p[1] - c.c[1]) * back[1]);
    c.facing = { street: best.st.name, side: compass(bearingOf(back)), widthFt: Math.round((Math.max(...us) - Math.min(...us)) / FT), depthFt: Math.round((Math.max(...vs) - Math.min(...vs)) / FT),
      setbackFt: Math.round((best.q.d + Math.min(...vs)) / FT) };
  }
  return candidates;
}
function candidateLine(c) {
  const f = c.facing;
  return `${c.n}. ${f ? `on the ${f.side} side of ${f.street}, about ${f.widthFt} ft across the front and ${f.depthFt} ft deep, ${f.setbackFt} ft back from the street's centre line; ` : ''}about ${Math.round(c.areaSqFt / 10) * 10} sq ft outline${c.heightFt ? `, about ${Math.round(c.heightFt)} ft tall` : ''}${c.use ? `, ${String(c.use).toLowerCase()}` : ''}; ${Math.round(Math.hypot(...c.c))} m ${compass(bearingOf(c.c))} of the red dot${c.address ? `; map address ${c.address}` : ''}`;
}
// The candidates on the aerial, north up, numbered; the red dot is the address lookup's point.
async function candidatesMap({ tools, pin, candidates, streets, fetchImpl, span = 620 }) {
  const fr = siteFrame(pin, [0, 1]), half = span / 2, s = 1.5, uR = [-half, half], vR = [-half, half];
  const { toLL } = frame(pin);
  return frameImage({ tools, fr, u: uR, v: vR, pxPerFt: s, fetchImpl, shapes: (toC, llToC, w, h) => {
    const out = [];
    for (const c of candidates) out.push({ poly: c.ring.map(llToC), stroke: '#ffd400', width: 2.2 });
    for (const st of streets.slice(0, 5)) {
      const q = nearestOnLine([0, 0], st.line); if (!q) continue;
      const [x, y] = llToC(toLL(q.q)); if (x > 0 && y > 0 && x < w && y < h) out.push(label(st.name, x, y, { size: 12, bg: 'rgba(20,20,60,.75)' }));
    }
    for (const c of candidates) { const [x, y] = llToC(toLL(c.c)); out.push({ circle: [x, y, 11], fill: '#fff', stroke: '#000', width: 1.5 }, label(String(c.n), x, y, { color: '#000', bg: null, bold: true, size: 13 })); }
    const [px, py] = llToC(pin);
    out.push({ circle: [px, py, 7], fill: '#e0201b', stroke: '#fff', width: 2 });
    out.push(label('N ↑', w - 24, 18, { bold: true, size: 14 }), ...scaleBar(12, h - 16, 100, s));
    return out;
  } });
}
// A close-up of one candidate, turned so its street is at the bottom.
async function candidateCloseup({ tools, cand, candidates, pin, street, fetchImpl }) {
  const { toLL } = frame(pin);
  let back = [0, 1];
  if (street) { const q = nearestOnLine(cand.c, street.line); if (q && q.d < 90) back = unitVec([cand.c[0] - q.q[0], cand.c[1] - q.q[1]]); }
  const fr = siteFrame(toLL(cand.c), back), s = 3.2, uR = [-100, 100], vR = [-115, 145];
  return frameImage({ tools, fr, u: uR, v: vR, pxPerFt: s, fetchImpl, shapes: (toC, llToC, w, h) => {
    const out = [];
    for (const c of candidates) if (c !== cand) out.push({ poly: c.ring.map(llToC), stroke: 'rgba(255,255,255,.75)', width: 1.2 });
    out.push({ poly: cand.ring.map(llToC), stroke: '#ffd400', width: 3 });
    for (const c of candidates) { const [x, y] = llToC(toLL(c.c)); if (x > 0 && y > 0 && x < w && y < h) out.push({ circle: [x, y, c === cand ? 12 : 9], fill: c === cand ? '#ffd400' : '#fff', stroke: '#000', width: 1 }, label(String(c.n), x, y, { color: '#000', bg: null, bold: true, size: c === cand ? 13 : 11 })); }
    const [px, py] = llToC(pin); if (px > 0 && py > 0 && px < w && py < h) out.push({ circle: [px, py, 6], fill: '#e0201b', stroke: '#fff', width: 2 });
    out.push(label(`Candidate ${cand.n}, street side at the bottom`, w / 2, 14, { bold: true }), label('STREET SIDE', w / 2, h - 10, { bold: true }), ...scaleBar(12, h - 30, 50, s));
    return out;
  } });
}

const aerialLine = (a) => (a ? `USDA NAIP aerial photo from ${new Date(a.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}, ${Math.round(a.metres * 100)} cm a pixel` : 'USDA NAIP aerial photo');
async function pickHouse({ client, callClaude, model, effort = 'medium', photos, views, address, pin, candidates, streets, street, mapImage, tools, fetchImpl, onEvent, usage, aerial = null }) {
  const thoughts = [], ev = (e) => { if (e.type === 'thought') thoughts.push(e.text); onEvent(e); };
  const text = pickTask({ address, number: numberOf(address), street: street ? street.name : null, photoList: photoList(photos.length, views), candidates: candidates.map(candidateLine).join('\n'), aerial: aerialLine(aerial) });
  const messages = [{ role: 'user', content: [...photos.map(imageBlock), imageBlock(mapImage), { type: 'text', text }] }];
  const params = { model, max_tokens: 32000, system: PICK_SPEC, tools: PICK_TOOLS, cache_control: { type: 'ephemeral' }, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort } };
  const viewed = [], closeups = new Map();
  for (let r = 0; r < 7; r++) {
    const msg = await callClaude(client, { ...params, messages }, ev);
    addUsage(usage, msg);
    if (msg.stop_reason === 'refusal') throw new Error('The house finder declined these photos.');
    messages.push({ role: 'assistant', content: msg.content });
    const uses = msg.content.filter((b) => b.type === 'tool_use');
    const sub = uses.find((u) => u.name === 'submit_pick');
    if (sub) {
      const n = Math.round(Number(sub.input.number)), cand = candidates.find((c) => c.n === n);
      if (cand) return { ...sub.input, number: n, candidate: cand, viewed, thoughts, closeups: [...closeups.entries()].map(([k, v]) => ({ n: k, ...v })) };
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: sub.id, content: `There is no candidate ${sub.input.number}; pick one of 1 to ${candidates.length}.`, is_error: true },
        ...uses.filter((u) => u !== sub).map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: 'Skipped.' }))] });
      continue;
    }
    if (!uses.length) { messages.push({ role: 'user', content: [{ type: 'text', text: 'Submit your pick with submit_pick.' }] }); continue; }
    const results = [];
    for (const tu of uses) {
      if (tu.name !== 'view_candidates') { results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Unknown tool ${tu.name}`, is_error: true }); continue; }
      const nums = [...new Set((tu.input.numbers || []).map((x) => Math.round(Number(x))))].filter((x) => candidates.some((c) => c.n === x)).slice(0, 4);
      if (!nums.length) { results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Give candidate numbers from 1 to ${candidates.length}.`, is_error: true }); continue; }
      const body = [];
      for (const n of nums) {
        const cand = candidates.find((c) => c.n === n);
        if (!closeups.has(n)) { try { closeups.set(n, await candidateCloseup({ tools, cand, candidates, pin, street, fetchImpl })); } catch (e) { onEvent({ type: 'status', message: `Close-up of ${n} failed: ${e.message}` }); } }
        viewed.push(n);
        body.push({ type: 'text', text: `Candidate ${candidateLine(cand)}.${closeups.has(n) ? '' : ' (The close-up could not be drawn just now; judge it from the overview.)'}` }, ...(closeups.has(n) ? [imageBlock(closeups.get(n))] : []));
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: body });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error('The house finder did not pick a building.');
}

// ---------- step 4: the map ----------
const round1 = (x) => Math.round(x * 2) / 2;
const RECT_KEYS = ['driveways', 'walks', 'patios', 'pools', 'lawn', 'beds'];
const okRect = (r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) && r[2] > r[0] && r[3] > r[1] && r.every((v) => Math.abs(v) < 600);
const fixRect = (r) => (Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) ? [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])] : null);
// A submitted site plan, cleaned: bad rectangles dropped, with the problems to tell Claude.
function cleanPlan(input) {
  const problems = [], plan = { summary: String(input.summary || '').slice(0, 2000), blocks: [], openings: [], site: {}, uncertain: (Array.isArray(input.uncertain) ? input.uncertain : []).map((x) => String(x).slice(0, 300)).slice(0, 12) };
  const mp = input.matchesPhotos || {};
  plan.matchesPhotos = { answer: ['yes', 'no', 'unsure'].includes(mp.answer) ? mp.answer : 'unsure', reason: String(mp.reason || '').slice(0, 500) };
  const names = new Set();
  for (const b of Array.isArray(input.blocks) ? input.blocks : []) {
    const name = String(b.name || '').slice(0, 40) || `Block ${plan.blocks.length + 1}`;
    if (names.has(name)) { problems.push(`Two blocks are called "${name}"; give each its own name.`); continue; }
    const rects = (Array.isArray(b.rects) ? b.rects : []).map(fixRect).filter(okRect);
    if (!rects.length) { problems.push(`Block "${name}" has no valid rectangles [u0, v0, u1, v1].`); continue; }
    const stories = Math.round(Number(b.stories) || 1);
    if (stories < 1 || stories > 3) problems.push(`Block "${name}" has ${b.stories} stories; use 1 to 3.`);
    names.add(name);
    const upper = stories > 1 ? (Array.isArray(b.upperRects) ? b.upperRects : []).map(fixRect).filter(okRect) : [];
    plan.blocks.push({ name, stories: Math.min(3, Math.max(1, stories)), rects, ...(upper.length ? { upperRects: upper } : {}), roof: ['hip', 'gable', 'flat', 'shed'].includes(b.roof) ? b.roof : 'hip', ridge: b.ridge || 'none', note: String(b.note || '').slice(0, 300) });
  }
  if (!plan.blocks.length) problems.push('No blocks came through.');
  for (const o of Array.isArray(input.openings) ? input.openings : []) {
    const at = Array.isArray(o.at) && o.at.length === 2 && o.at.every(Number.isFinite) ? o.at : null;
    if (!at || !names.has(o.block)) { problems.push(`The ${o.kind || 'opening'} needs "at" [u, v] and the name of one of the blocks${o.block ? ` ("${o.block}" isn't one)` : ''}.`); continue; }
    const b = plan.blocks.find((x) => x.name === o.block);
    const d = Math.min(...b.rects.map((r) => Math.min(Math.abs(at[0] - r[0]), Math.abs(at[0] - r[2]), Math.abs(at[1] - r[1]), Math.abs(at[1] - r[3])) + Math.max(0, r[0] - at[0], at[0] - r[2], r[1] - at[1], at[1] - r[3])));
    if (d > 3) problems.push(`The ${o.kind} of ${o.block} at [${at.map(round1)}] is ${round1(d)} ft from that block's walls; put it on a wall line.`);
    plan.openings.push({ block: o.block, kind: ['door', 'double door', 'sliding door', 'garage door'].includes(o.kind) ? o.kind : 'door', at, widthFt: Math.min(24, Math.max(2.5, Number(o.widthFt) || 3)), note: String(o.note || '').slice(0, 200) });
  }
  const s = input.site || {};
  for (const k of RECT_KEYS) plan.site[k] = (Array.isArray(s[k]) ? s[k] : []).map(fixRect).filter(okRect).slice(0, 12);
  plan.site.lot = okRect(fixRect(s.lot)) ? fixRect(s.lot) : null;
  plan.site.streetEdge = Number.isFinite(Number(s.streetEdge)) && s.streetEdge !== null && s.streetEdge !== '' ? Number(s.streetEdge) : null;
  // a tree stands outside the house: one whose trunk is inside a block is dropped, and said
  const inBlock = (p) => plan.blocks.find((b) => b.rects.some((r) => p[0] > r[0] + 0.5 && p[0] < r[2] - 0.5 && p[1] > r[1] + 0.5 && p[1] < r[3] - 0.5));
  plan.site.trees = (Array.isArray(s.trees) ? s.trees : []).filter((t) => Array.isArray(t.at) && t.at.length === 2 && t.at.every(Number.isFinite))
    .map((t) => ({ at: t.at, kind: String(t.kind || 'tree').slice(0, 40), diameterFt: Math.min(60, Math.max(3, Number(t.diameterFt) || 12)) }))
    .filter((t) => { const b = inBlock(t.at); if (b) problems.push(`The ${t.kind} at [${t.at.map(round1)}] is inside ${b.name}; a tree's trunk stands outside the house (a canopy over the roof is fine). Move it or leave it out.`); return !b; }).slice(0, 16);
  plan.site.fences = (Array.isArray(s.fences) ? s.fences : []).filter((f) => Array.isArray(f.line) && f.line.length === 4 && f.line.every(Number.isFinite))
    .map((f) => ({ line: f.line, kind: String(f.kind || 'fence').slice(0, 40) })).slice(0, 16);
  plan.site.structures = (Array.isArray(s.structures) ? s.structures : []).map((x) => ({ name: String(x.name || 'structure').slice(0, 40), rect: fixRect(x.rect), note: String(x.note || '').slice(0, 200) })).filter((x) => okRect(x.rect)).slice(0, 8);
  return { plan, problems };
}
// How well the blocks cover the outline, on a 1 ft grid: shared share, and where they differ.
function coverage(outline, blocks) {
  const rects = blocks.flatMap((b) => b.rects), inRects = (p) => rects.some((r) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]);
  const bb = bboxOf([...outline, ...rects.flatMap((r) => [[r[0], r[1]], [r[2], r[3]]])]);
  let both = 0, onlyO = 0, onlyB = 0; const miss = [], extra = [];
  for (let u = Math.floor(bb[0]) + 0.5; u < bb[2]; u++) for (let v = Math.floor(bb[1]) + 0.5; v < bb[3]; v++) {
    const o = pointIn([u, v], outline), b = inRects([u, v]);
    if (o && b) both++; else if (o) { onlyO++; miss.push([u, v]); } else if (b) { onlyB++; extra.push([u, v]); }
  }
  const box = (pts) => (pts.length ? bboxOf(pts).map((x) => Math.round(x)) : null);
  return { iou: both / Math.max(1, both + onlyO + onlyB), outlineSqFt: both + onlyO, blocksSqFt: both + onlyB, missingSqFt: onlyO, extraSqFt: onlyB, missingBox: box(miss), extraBox: box(extra) };
}
const BLOCK_COLORS = ['rgba(31,111,235,.45)', 'rgba(142,68,173,.45)', 'rgba(22,160,133,.45)', 'rgba(211,84,0,.45)', 'rgba(52,73,94,.5)', 'rgba(192,57,43,.45)'];
function planShapes(toC, plan, outline, lot, outbuildings = []) {
  const out = [];
  const rect = (r, o) => ({ poly: [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].map(toC), ...o });
  for (const r of plan.site.lawn || []) out.push(rect(r, { stroke: '#7ed957', width: 2, dash: [4, 3] }));
  for (const r of plan.site.beds || []) out.push(rect(r, { stroke: '#b5651d', width: 2, dash: [2, 3] }));
  for (const r of plan.site.driveways || []) out.push(rect(r, { stroke: '#d0d0d0', width: 2.5, fill: 'rgba(200,200,200,.18)' }));
  for (const r of plan.site.walks || []) out.push(rect(r, { stroke: '#f0f0f0', width: 1.5 }));
  for (const r of plan.site.patios || []) out.push(rect(r, { stroke: '#7fdbff', width: 2, fill: 'rgba(127,219,255,.15)' }));
  for (const r of plan.site.pools || []) out.push(rect(r, { stroke: '#0074d9', width: 2.5, fill: 'rgba(0,116,217,.35)' }));
  for (const x of plan.site.structures || []) out.push(rect(x.rect, { stroke: '#f012be', width: 2, dash: [6, 3] }), label(x.name, ...toC([(x.rect[0] + x.rect[2]) / 2, (x.rect[1] + x.rect[3]) / 2]), { size: 11, bg: 'rgba(120,0,90,.7)' }));
  plan.blocks.forEach((b, i) => {
    for (const r of b.rects) out.push(rect(r, { stroke: '#fff', width: 1.5, fill: BLOCK_COLORS[i % BLOCK_COLORS.length] }));
    for (const r of b.upperRects || []) out.push(rect(r, { stroke: '#ffd400', width: 2, dash: [5, 3] }));
    const r0 = b.rects[0], [x, y] = toC([(r0[0] + r0[2]) / 2, (r0[1] + r0[3]) / 2]);
    out.push(label(`${b.name} · ${b.stories} st · ${b.roof}`, x, y, { size: 12, bold: true }));
  });
  out.push({ poly: outline.map(toC), stroke: '#ff8c00', width: 2 });
  for (const ob of outbuildings) out.push({ poly: ob.map(toC), stroke: '#ffb347', width: 1.5, dash: [3, 2] });
  if (lot) out.push({ poly: lot.map(toC), stroke: '#fff', width: 2, dash: [8, 5] });
  for (const t of plan.site.trees || []) { const [x, y] = toC(t.at), [x2] = toC([t.at[0] + t.diameterFt / 2, t.at[1]]); out.push({ circle: [x, y, Math.max(4, Math.abs(x2 - x))], stroke: '#2ecc40', width: 2 }, label(t.kind, x, y, { size: 10, bg: 'rgba(0,80,0,.7)' })); }
  for (const f of plan.site.fences || []) { const [x0, y0] = toC([f.line[0], f.line[1]]), [x1, y1] = toC([f.line[2], f.line[3]]); out.push({ line: [x0, y0, x1, y1], stroke: '#c8a165', width: 3 }); }
  for (const o of plan.openings) { const [x, y] = toC(o.at); out.push({ circle: [x, y, 6], fill: o.kind === 'garage door' ? '#111' : '#e0301e', stroke: '#fff', width: 1.5 }); }
  return out;
}

async function mapHouse({ client, callClaude, model, fallbackModel, effort = 'high', photos, views, address, main, outbuildings, parcel, back, plate, tools, fetchImpl, onEvent, usage, facts, aerial = null }) {
  // turned so the street is at the bottom, square to the house's walls; (0, 0) the outline's front left corner
  const { toXY } = frame(main.centerLL), mainXY = main.ring.map(toXY);
  const axes = wallAxes(mainXY), b = axes.reduce((best, a) => (a[0] * back[0] + a[1] * back[1] > best[0] * back[0] + best[1] * back[1] ? a : best));
  const fr = siteFrame(main.centerLL, b), raw = main.ring.map(fr.toUV), [su, sv] = bboxOf(raw);
  const toSite = (ll) => { const [u, v] = fr.toUV(ll); return [u - su, v - sv]; }, fromSite = ([u, v]) => fr.toLL([u + su, v + sv]);
  const outline = main.ring.map(toSite), lot = parcel ? parcel.ring.map(toSite) : null, obs = outbuildings.map((o) => o.ring.map(toSite));
  const ob = bboxOf(outline), lb = lot ? bboxOf(lot) : null;
  const uR = [Math.min(ob[0], lb ? lb[0] : Infinity) - (lb ? 14 : 30), Math.max(ob[2], lb ? lb[2] : -Infinity) + (lb ? 14 : 30)];
  const vR = [Math.min(-45, (lb ? lb[1] : 0) - 30), Math.max(ob[3] + (lb ? 12 : 35), lb ? lb[3] + 12 : -Infinity)];
  const pxPerFt = Math.min(5, 1150 / (vR[1] - vR[0]), 1000 / (uR[1] - uR[0]));
  const view = (shapes) => frameImage({ tools, fr: { toUV: toSite, toLL: fromSite }, u: uR, v: vR, pxPerFt, fetchImpl,
    shapes: (toC, llToC, w, h) => [...gridShapes(toC, uR, vR, w, h), ...shapes(toC)] });
  const plain = await view(() => []);
  const annotated = await view((toC) => [{ poly: outline.map(toC), stroke: '#ff8c00', width: 2.5 }, ...obs.map((o) => ({ poly: o.map(toC), stroke: '#ffb347', width: 2, dash: [4, 3] })),
    ...(lot ? [{ poly: lot.map(toC), stroke: '#fff', width: 2, dash: [8, 5] }] : [])]);
  const fmt = (pts) => pts.map((p) => `[${round1(p[0])}, ${round1(p[1])}]`).join(' ');
  const text = siteTask({ address, photoList: photoList(photos.length, views), facts, outline: fmt(outline) + (obs.length ? `; separate buildings on the lot: ${obs.map(fmt).join(' / ')}` : ''),
    lot: lot ? fmt(lot) : null, plateName: sizeName(plate), aerial: aerialLine(aerial), outlineDate: main.outlineDate || '' });
  const messages = [{ role: 'user', content: [...photos.map(imageBlock), imageBlock(plain), imageBlock(annotated), { type: 'text', text }] }];
  const thoughts = [], ev = (e) => { if (e.type === 'thought') thoughts.push(e.text); onEvent(e); };
  let useModel = model;
  const params = () => ({ model: useModel, max_tokens: 48000, system: SITE_SPEC, tools: [SITE_TOOL], cache_control: { type: 'ephemeral' }, thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort } });
  const rounds = []; let best = null;
  for (let r = 0; r < 5; r++) {
    let msg;
    try { msg = await callClaude(client, { ...params(), messages }, ev); } catch (e) {
      // the stronger model may not be open to this account: map with the design's model instead
      if (r === 0 && fallbackModel && useModel !== fallbackModel && [400, 403, 404].includes(e.status)) { onEvent({ type: 'status', message: `${useModel} is not available (${e.status}); mapping with ${fallbackModel}.` }); useModel = fallbackModel; r--; continue; }
      throw e;
    }
    addUsage(usage[useModel] || (usage[useModel] = emptyUsage()), msg);
    if (msg.stop_reason === 'refusal') throw new Error('The house mapper declined these photos.');
    messages.push({ role: 'assistant', content: msg.content });
    const uses = msg.content.filter((x) => x.type === 'tool_use');
    if (!uses.length) { if (best) break; messages.push({ role: 'user', content: [{ type: 'text', text: 'Submit the map with submit_site_plan.' }] }); continue; }
    const results = [];
    for (const tu of uses) {
      if (tu.name !== SITE_TOOL.name) { results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Unknown tool ${tu.name}`, is_error: true }); continue; }
      const { plan, problems } = cleanPlan(tu.input || {});
      const cov = plan.blocks.length ? coverage(outline, plan.blocks) : null;
      const overlay = plan.blocks.length ? await view((toC) => planShapes(toC, plan, outline, lot, obs)) : null;
      if (plan.blocks.length) best = { plan, problems, cov, overlay };
      rounds.push({ n: rounds.length + 1, blocks: plan.blocks.map((x) => `${x.name} (${x.stories} story, ${x.roof})`), cov, problems });
      onEvent({ type: 'status', message: `Site plan ${rounds.length}: ${plan.blocks.length} blocks${cov ? `, ${Math.round(cov.iou * 100)}% overlap with the outline` : ''}${problems.length ? `, ${problems.length} problems` : ''}.` });
      const say = cov ? `Your blocks share ${Math.round(cov.iou * 100)}% with the outline: the outline is ${cov.outlineSqFt} sq ft and your blocks ${cov.blocksSqFt} sq ft. ${cov.missingSqFt >= 20 ? `${cov.missingSqFt} sq ft of the outline is outside your blocks (within [${cov.missingBox}]). ` : ''}${cov.extraSqFt >= 20 ? `${cov.extraSqFt} sq ft of your blocks is outside the outline (within [${cov.extraBox}]); keep it only if the photos or the aerial show walls there (a newer addition), not eaves. ` : ''}` : '';
      const body = [{ type: 'text', text: `${say}${problems.length ? `Problems: ${problems.join(' ')}` : 'No problems.'} The overlay shows your blocks (filled), doors (red dots, garage doors black), the outline (orange) and the site features. Fix what is off and submit again, or reply with one sentence if it matches.` }];
      if (overlay) body.push(imageBlock(overlay));
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: body });
      if (rounds.length >= 3) results[results.length - 1].content.push({ type: 'text', text: 'That was the last submission; the map is kept as it is.' });
    }
    messages.push({ role: 'user', content: results });
    if (rounds.length >= 3) break;
  }
  if (!best) throw new Error('The house mapper did not submit a site plan.');
  return { ...best, rounds, thoughts, model: useModel, fr, shift: [su, sv], toSite, fromSite, outline, lot, outbuildings: obs, images: { plain, annotated },
    lotRect: lb ? lb.map(round1) : null, view: { u: uR, v: vR, pxPerFt } };
}

// ---------- step 5: the fit, the locked walls and the lot in studs ----------
// The scale for this house on the chosen size: the size's usual scale when the house, its driveway and a little
// yard fit, else stretched (within the size's range) until they do, and past that the yards are trimmed, never the
// house. Also what every size would take, and whether a bigger one would show it better. Wall lines sit on cell
// centres, so a wall W ft long takes W/s + 1 studs.
const up4 = (x) => Math.ceil(x * 4 - 1e-9) / 4;
const FRONT_MIN_FT = 12, BACK_MIN_FT = 4; // the yard a model needs at least: a drive apron and walk in front, a strip behind
function fitPlan(plan, { plate = 32, lotRect = null } = {}) {
  const sc = scaleFor(plate), P = sc.size, rows = sc.streetRows, rects = plan.blocks.flatMap((b) => [...b.rects, ...(b.upperRects || [])]);
  const [hu0, hv0, hu1, hv1] = [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))];
  const site = plan.site || {}, drives = site.driveways || [], lot = lotRect || site.lot || null;
  const houseW = hu1 - hu0, houseD = hv1 - hv0;
  // across: the house and its driveways, with a little room each side
  const du0 = Math.min(hu0, ...drives.map((r) => r[0])) - 3, du1 = Math.max(hu1, ...drives.map((r) => r[2])) + 3, W = du1 - du0;
  const edge = Number.isFinite(site.streetEdge) ? site.streetEdge : lot ? lot[1] : drives.length ? Math.min(...drives.map((r) => r[1])) : hv0 - 20;
  const frontFt = Math.max(0, hv0 - edge), backFt = Math.max(0, (lot ? lot[3] : hv1 + 20) - hv1);
  const frontMin = Math.min(frontFt, FRONT_MIN_FT), backMin = Math.min(backFt, BACK_MIN_FT);
  // feet per stud to show the house, its drive and that yard; and the house alone with a row behind it
  const needAll = (q) => { const t = scaleFor(q); return Math.max(W / (t.size - 1), (frontMin + houseD + backMin) / (t.size - t.streetRows - 1)); };
  const needHouse = (q) => { const t = scaleFor(q); return Math.max(houseW / (t.size - 1), houseD / (t.size - t.streetRows - 2)); };
  const notes = [], problems = [];
  let s = up4(Math.max(sc.ftPerStud, needAll(plate)));
  if (s > sc.maxFtPerStud) {
    s = up4(Math.max(sc.maxFtPerStud, needHouse(plate)));
    notes.push(`The yards are shortened so the whole house fits at ${s} ft per stud.`);
  }
  // whole: house, drive and yard within the size's range; fits: the house at least; usual: at the size's usual scale
  const sizes = [16, 32, 48].map((q) => { const t = scaleFor(q), all = needAll(q), house = needHouse(q);
    return { plate: q, name: sizeName(q), ftPerStud: up4(Math.max(t.ftPerStud, all <= t.maxFtPerStud ? all : Math.max(t.maxFtPerStud, house))),
      whole: all <= t.maxFtPerStud, fits: house <= t.maxFtPerStud, usual: all <= t.ftPerStud * 1.05 }; });
  // a bigger size only when this one can't show the house with its yard: the next that can; when this one can't
  // even hold the house, the next that does
  const mine = sizes.find((x) => x.plate === sc.plate), bigger = sizes.filter((x) => x.plate > sc.plate);
  const best = mine.whole ? mine : mine.fits ? bigger.find((x) => x.whole) || mine : bigger.find((x) => x.fits) || sizes[sizes.length - 1];
  if (s > sc.maxFtPerStud) problems.push(`The house (${Math.round(houseW)} x ${Math.round(houseD)} ft) is too long for the ${sizeName(plate)} at its coarsest ${sc.maxFtPerStud} ft per stud, so it is shown whole at ${s}; the ${best.name} shows it at ${best.ftPerStud}.`);
  // the rows left beside the house go to the front yard first (the view from the street), keeping one behind
  const houseRows = Math.round(houseD / s) + 1, left = Math.max(0, P - rows - houseRows);
  const frontRows = Math.max(0, Math.min(Math.round(frontFt / s), left - Math.min(Math.max(1, Math.round(backFt / s)), Math.max(1, Math.floor(left / 3)))));
  // centred on the lot when it fits across the plate (both lot lines show), else on the house and its drive
  const center = lot && (lot[2] - lot[0]) / s <= P - 2 && lot[0] <= du0 + 3 && lot[2] >= du1 - 3 ? [lot[0], lot[2]] : [du0, du1];
  return { plate, ftPerStud: s, frontRows, backRows: left - frontRows, center, widthFt: Math.round(W), frontFt: Math.round(frontFt),
    backFt: Math.round(backFt), houseFt: [Math.round(houseW), Math.round(houseD)], notes, problems, sizes, recommended: best.plate };
}
const SCALE_ROOMS = [{ name: 'scale', label: '10 x 10', rectPx: [0, 0, 10, 10] }, { name: 'scale', label: '10 x 10', rectPx: [0, 0, 10, 10] }];
// A jut the photos show is at least a stud, so it shows at any scale: an upper floor's edge past the floor below by
// less than a stud is pushed out to one.
function widenJuts(upper, ground, s) {
  const [g0, h0, g1, h1] = bboxOf(ground.flatMap((r) => [[r[0], r[1]], [r[2], r[3]]]));
  const push = (d) => (d > 0.3 && d < s ? s : d); // how far an edge juts past the floor below, at least a stud
  return upper.map(([u0, v0, u1, v1]) => [
    u0 < g0 ? g0 - push(g0 - u0) : u0, v0 < h0 ? h0 - push(h0 - v0) : v0,
    u1 > g1 ? g1 + push(u1 - g1) : u1, v1 > h1 ? h1 + push(v1 - h1) : v1].map(round1));
}
const UPPER = ' (upper floor)';
function lockPlan(plan, fit, { tolerance = 1 } = {}) {
  const sc = scaleFor(fit.plate), toPx = ([u0, v0, u1, v1]) => [u0, -v1, u1, -v0];
  // a block whose upper floor sits differently is two: its ground floor, and the upper floor as floor 2 on a slab
  const blocks = [...plan.blocks].sort((a, b) => b.stories - a.stories).flatMap((b) => (b.upperRects
    ? [{ name: b.name, levels: 1, rectsPx: b.rects.map(toPx) }, { name: b.name + UPPER, floor: 2, levels: b.stories - 1, rectsPx: widenJuts(b.upperRects, b.rects, fit.ftPerStud).map(toPx) }]
    : [{ name: b.name, levels: b.stories, rectsPx: b.rects.map(toPx) }]));
  const openings = plan.openings.map((o) => ({ block: o.block, kind: o.kind, atPx: [o.at[0], -o.at[1]], widthFt: o.widthFt, ...(o.note ? { note: o.note } : {}) }));
  // every floor is drawn in the same feet, so the floors' anchors are one point
  const L = layoutFootprint({ street: 'S', rooms: SCALE_ROOMS, blocks, openings, stairs: [], anchors: [{ floor: 1, atPx: [0, 0] }, { floor: 2, atPx: [0, 0] }] },
    { ftPerStud: fit.ftPerStud, size: sc.size, streetRows: sc.streetRows, frontYard: fit.frontRows, centerPx: fit.center });
  L.source = 'site';
  L.tolerance = tolerance; // the photos may correct the aerial by a stud (checkFootprint)
  for (const b of L.blocks) { const p = plan.blocks.find((x) => x.name === b.name || x.name + UPPER === b.name);
    if (p) Object.assign(b, { stories: b.floor > 1 ? p.stories - 1 : p.upperRects ? 1 : p.stories, roof: p.roof, ridge: p.ridge, ...(p.note ? { note: p.note } : {}), ...(p.upperRects && !(b.floor > 1) ? { under: p.name + UPPER } : {}) }); }
  return L;
}
// The site features in studs (the locked layout's map from plan pixels, which are feet, u and -v).
function siteInStuds(plan, locked, { lotRect = null } = {}) {
  const m = locked.map, P = locked.size || 32, sc = scaleFor(P), lastRow = P - sc.streetRows - 1;
  // continuous stud coordinates: cell k spans [k, k + 1), and a line in feet passes through cell centres, as walls do
  const at = ([u, v]) => [m.a * u + m.c * -v + m.e, m.b * u + m.d * -v + m.f];
  const clampX = (x) => Math.min(P - 1, Math.max(0, x)), clampZ = (z) => Math.min(lastRow, Math.max(0, z));
  // the cells whose centres a rectangle covers, edges included (so a patio's edge on a wall line meets that wall);
  // one narrower than a stud keeps the cell nearest its middle
  const span = (p, q) => { const lo = Math.min(p, q) - 0.5, hi = Math.max(p, q) - 0.5, a = Math.ceil(lo - 0.01), b = Math.floor(hi + 0.01);
    return b >= a ? [a, b] : [Math.round((lo + hi) / 2), Math.round((lo + hi) / 2)]; };
  const cells = (r) => {
    const a = at([r[0], r[1]]), b = at([r[2], r[3]]), [x0, x1] = span(a[0], b[0]), [z0, z1] = span(a[1], b[1]);
    if (x1 < 0 || x0 > P - 1 || z1 < 0 || z0 > lastRow) return null;
    return [clampX(x0), clampZ(z0), clampX(x1), clampZ(z1)];
  };
  const pt = (p) => { const [x, z] = at(p); return [Math.floor(x), Math.floor(z)]; };
  const on = ([x, z]) => x >= 0 && x < P && z >= 0 && z <= lastRow;
  const out = { streetRows: [P - sc.streetRows, P - 1] };
  for (const k of RECT_KEYS) out[k] = (plan.site[k] || []).map(cells).filter(Boolean);
  // a driveway that reaches the sidewalk in the map reaches it on the plate
  out.driveways = out.driveways.map((r) => (lastRow - r[3] <= 2 ? [r[0], r[1], r[2], lastRow] : r));
  out.structures = (plan.site.structures || []).map((x) => ({ name: x.name, rect: cells(x.rect), note: x.note })).filter((x) => x.rect);
  out.trees = (plan.site.trees || []).map((t) => ({ kind: t.kind, at: pt(t.at), studs: Math.max(1, Math.round(t.diameterFt / locked.scale.ftPerStud)) })).filter((t) => on(t.at));
  out.fences = (plan.site.fences || []).map((f) => ({ kind: f.kind, from: pt([f.line[0], f.line[1]]), to: pt([f.line[2], f.line[3]]) })).filter((f) => on(f.from) || on(f.to));
  const lot = lotRect || plan.site.lot;
  // the lot lines, on the cells they pass through (beyond the plate when they're off it)
  if (lot) { const a = at([lot[0], lot[1]]), b = at([lot[2], lot[3]]), [left, right] = span(a[0], b[0]), [back, front] = span(a[1], b[1]);
    out.lot = { left, right, back, front, cells: cells(lot) }; }
  return out;
}
function siteNoteText({ plan, locked, studs, fit, facts }) {
  const L = [], rect = (r) => `[${r.join(', ')}]`, list = (rs) => rs.map(rect).join(', ');
  const P = locked.size || 32;
  L.push(`SITE PLAN FROM THE MAP. The house was found on an aerial photo and mapped from above with the photos; the locked walls come from that map, at ${fit.ftPerStud} ft per stud (set "stud": ${fit.ftPerStud} in the design${fit.ftPerStud !== scaleFor(P).ftPerStud ? `; this size is usually ${scaleFor(P).ftPerStud} ft per stud, stretched so the whole house fits` : ''}). The lot around it, in stud rectangles [x0, z0, x1, z1] (z grows toward the street; the street and sidewalk take rows ${studs.streetRows[0]} to ${studs.streetRows[1]}). Build the lot from this in parts 3 and 4, and the patio covers and sheds with the roofs in part 2.`);
  if (facts) L.push(`- Records: ${facts}`);
  if (plan.summary) L.push(`- How the house was read: ${plan.summary}`);
  L.push(`- Blocks: ${locked.blocks.map((b) => `${b.name}: ${b.floor > 1 ? 'on floor 2, standing on its own slab (walls op with "slab": true), ' : ''}${b.stories || b.levels} ${(b.stories || b.levels) > 1 ? 'stories' : 'story'}, ${b.floor > 1 || !b.under ? `${b.roof || 'hip'} roof` : 'the upper floor above it'}${b.ridge && b.ridge !== 'none' ? ` (ridge ${b.ridge})` : ''}${b.note ? ` (${b.note})` : ''}`).join('; ')}.`);
  if (studs.lot) {
    const lt = studs.lot, parts = [];
    parts.push(lt.left >= 0 ? `left lot line at x = ${lt.left}` : 'the lot runs past the left edge');
    parts.push(lt.right <= P - 1 ? `right lot line at x = ${lt.right}` : 'the lot runs past the right edge');
    parts.push(lt.back >= 0 ? `back lot line at z = ${lt.back}` : 'the back of the lot is beyond the plate');
    L.push(`- Lot: ${parts.join(', ')}. Beyond the lot lines are the neighbours' yards: plain ground, lawn or their fence, nothing of theirs built.`);
  }
  const named = [['driveways', 'Driveway'], ['walks', 'Walks'], ['patios', 'Patios and paved yard'], ['pools', 'Pool'], ['lawn', 'Lawn'], ['beds', 'Planting beds']];
  for (const [k, n] of named) if (studs[k] && studs[k].length) L.push(`- ${n}: ${list(studs[k])}.`);
  if (studs.structures.length) L.push(`- Other structures: ${studs.structures.map((x) => `${x.name} over ${rect(x.rect)}${x.note ? ` (${x.note})` : ''}`).join('; ')}.`);
  if (studs.trees.length) L.push(`- Trees: ${studs.trees.map((t) => `${t.kind} at (${t.at.join(', ')}), about ${t.studs} studs across`).join('; ')}.`);
  if (studs.fences.length) L.push(`- Fences and walls: ${studs.fences.map((f) => `${f.kind} from (${f.from.join(', ')}) to (${f.to.join(', ')})`).join('; ')}.`);
  if (plan.uncertain && plan.uncertain.length) L.push(`- Guessed while mapping: ${plan.uncertain.join(' ')}`);
  L.push('The first map image shows the house from above with the mapped blocks; the second shows the plate in studs with the locked walls over the aerial.');
  return L.join('\n');
}
// The plate in studs with the aerial under it, the locked walls and the lot: one picture of the layout.
// toSite/fromSite: lat/lon to site feet (u, v) and back; the layout's map takes plan pixels (u, -v) to studs.
async function studMap({ tools, locked, studs, toSite, fromSite, fetchImpl }) {
  const P = locked.size || 32, S = P > 32 ? 14 : P < 32 ? 36 : 20, m = locked.map, det = m.a * m.d - m.b * m.c;
  const studOf = ([u, v]) => [m.a * u + m.c * -v + m.e, m.b * u + m.d * -v + m.f];
  const siteOf = ([x, z]) => { const X = x - m.e, Z = z - m.f; return [(m.d * X - m.c * Z) / det, -(-m.b * X + m.a * Z) / det]; };
  const toC = (ll) => studOf(toSite(ll)).map((s) => s * S);
  const corners = [[0, 0], [P, 0], [0, P], [P, P]].map((s) => fromSite(siteOf(s)));
  const shapes = [];
  for (let i = 0; i <= P; i++) { const w = i % 5 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.5)'; shapes.push({ line: [i * S, 0, i * S, P * S], stroke: w, width: 1 }, { line: [0, i * S, P * S, i * S], stroke: w, width: 1 }); }
  for (let i = 0; i < P; i += 5) shapes.push(label(String(i), i * S + S / 2, 8, { size: 10 }), label(String(i), 8, i * S + S / 2, { size: 10 }));
  const cellRect = (r, o) => ({ poly: [[r[0] * S, r[1] * S], [(r[2] + 1) * S, r[1] * S], [(r[2] + 1) * S, (r[3] + 1) * S], [r[0] * S, (r[3] + 1) * S]], ...o });
  for (const r of studs.lawn || []) shapes.push(cellRect(r, { stroke: '#7ed957', width: 2, dash: [4, 3] }));
  for (const r of studs.driveways || []) shapes.push(cellRect(r, { stroke: '#e0e0e0', width: 2.5, fill: 'rgba(210,210,210,.25)' }));
  for (const r of studs.walks || []) shapes.push(cellRect(r, { stroke: '#fff', width: 1.5 }));
  for (const r of studs.patios || []) shapes.push(cellRect(r, { stroke: '#7fdbff', width: 2, fill: 'rgba(127,219,255,.18)' }));
  for (const r of studs.pools || []) shapes.push(cellRect(r, { stroke: '#0074d9', width: 2, fill: 'rgba(0,116,217,.4)' }));
  for (const x of studs.structures || []) shapes.push(cellRect(x.rect, { stroke: '#f012be', width: 2, dash: [6, 3] }));
  locked.blocks.forEach((b, i) => {
    for (const [x, z] of b.cells) shapes.push(cellRect([x, z, x, z], { fill: BLOCK_COLORS[i % BLOCK_COLORS.length].replace(/[.\d]+\)$/, '.85)'), stroke: 'rgba(255,255,255,.6)', width: 1 }));
    for (const o of b.openings) shapes.push(cellRect(o.cells, { fill: /garage/.test(o.kind) ? '#111' : '#e0301e', stroke: '#fff', width: 1 }));
    const r = b.cellRects[0]; shapes.push(label(b.name, ((r[0] + r[2]) / 2 + 0.5) * S, ((r[1] + r[3]) / 2 + 0.5) * S, { bold: true, size: 12 }));
  });
  for (const t of studs.trees || []) shapes.push({ circle: [(t.at[0] + 0.5) * S, (t.at[1] + 0.5) * S, Math.max(S / 2, t.studs * S / 2)], stroke: '#2ecc40', width: 2 });
  for (const f of studs.fences || []) shapes.push({ line: [(f.from[0] + 0.5) * S, (f.from[1] + 0.5) * S, (f.to[0] + 0.5) * S, (f.to[1] + 0.5) * S], stroke: '#c8a165', width: 3 });
  if (studs.lot) { const l = studs.lot, c = (k) => (k + 0.5) * S; shapes.push({ poly: [[c(l.left), c(l.back)], [c(l.right), c(l.back)], [c(l.right), c(l.front)], [c(l.left), c(l.front)]], stroke: '#fff', width: 2, dash: [8, 5] }); }
  shapes.push({ poly: [[0, studs.streetRows[0] * S], [P * S, studs.streetRows[0] * S], [P * S, P * S], [0, P * S]], fill: 'rgba(60,60,60,.55)', stroke: null }, label(`STREET AND SIDEWALK (z = ${studs.streetRows[0]} to ${studs.streetRows[1]})`, P * S / 2, (studs.streetRows[0] + 1) * S, { bold: true }));
  return aerialImage({ tools, width: P * S, height: P * S, corners, toC, shapes, fetchImpl });
}

// ---------- the whole step ----------
/**
 * Finds the house on the aerial and maps it. Returns {center, terrain, pick, parcel, plan, fit, locked, siteNote,
 * facts, images: [{mediaType, data, caption}] for the design, report: {stages}, usage, costUsd, credits}, or throws.
 * tools: the renderer (drawLayers); callClaude: designer.js's streaming call.
 */
async function mapSite({ address, place, photos, views = [], client, callClaude, model, siteModel = null, pickEffort = 'medium', mapEffort = 'high', plate = 32,
  tools, onEvent = () => {}, fetchImpl = fetch }) {
  if (!tools || !tools.drawLayers) throw new Error('Mapping the site needs the renderer (Playwright).');
  const t0 = Date.now(), stages = [], usage = { pick: emptyUsage(), map: {} }, credits = new Set(['Aerial photo: USDA NAIP via USGS (public domain)']);
  const stage = (s) => { s.secs = Math.round((Date.now() - t0) / 1000); stages.push(s); onEvent({ type: 'site', stage: s }); };
  const { toXY, toLL } = frame(place), num = numberOf(address), streetName = streetOf(address);

  // 1. the buildings near the address lookup's point
  onEvent({ type: 'status', message: 'Finding the buildings near the address…' });
  // streets from TIGER (fast, nationwide), OpenStreetMap's when TIGER has none
  const streetsNear = async () => { const t = await tigerStreets(place, 170, { fetchImpl }).catch(() => []);
    if (t.length) { credits.add('Streets: US Census TIGER (public domain)'); return { streets: t, lanes: [] }; }
    return nearbyWays(place, { fetchImpl, radiusM: 170 }).catch(() => ({ streets: [], lanes: [] })); };
  const [structs, osm, ways, aerial] = await Promise.all([
    structuresNear(place, 140, { fetchImpl }).catch((e) => { onEvent({ type: 'status', message: `USA Structures: ${e.message}` }); return []; }),
    // OpenStreetMap's buildings only add addresses and fill gaps: not worth waiting long for when its servers are busy
    Promise.race([osmNear(place, 140, { fetchImpl }).catch(() => []), new Promise((r) => setTimeout(() => r([]), 30000).unref())]),
    streetsNear(),
    naipDate(place, { fetchImpl })]);
  const all = mergeBuildings(structs, osm, toXY), candidates = facingStreets(numberCandidates(all), ways.streets);
  if (!candidates.length) throw new Error('No buildings were found near the address.');
  if (structs.length) credits.add('Building outlines: FEMA USA Structures (CC BY 4.0)');
  if (candidates.some((c) => c.source === 'OpenStreetMap' || c.address)) credits.add('OpenStreetMap contributors (ODbL)');
  const street = ways.streets.find((s) => sameStreet(s.name, streetName)) || ways.streets[0] || null;
  const mapImage = await candidatesMap({ tools, pin: place, candidates, streets: ways.streets, fetchImpl });
  stage({ id: 'candidates', title: 'Buildings near the address', summary: `The address lookup put ${address} at ${place.lat.toFixed(6)}, ${place.lon.toFixed(6)} (${place.label || 'geocoded'}). ${candidates.length} house-sized buildings lie within 110 m of that point (${structs.length} outlines from FEMA USA Structures, ${osm.length} from OpenStreetMap). They were numbered by distance from the point${street ? `, and ${street.name} runs ${Math.round(street.distanceM)} m from it` : ''}. The aerial is the ${aerialLine(aerial)}.`,
    details: candidates.map(candidateLine), images: [{ name: 'candidates', label: 'The numbered buildings on the aerial photo (north up; red dot: the address lookup)', ...mapImage }] });

  // 2. the pick
  onEvent({ type: 'status', message: 'Finding the house on the map…' });
  const pick = await pickHouse({ client, callClaude, model, effort: pickEffort, photos, views, address, pin: place, candidates, streets: ways.streets, street, mapImage, tools, fetchImpl, onEvent, usage: usage.pick, aerial });
  let main = pick.candidate;
  stage({ id: 'pick', title: 'Which building is the house', summary: `Claude picked building ${pick.number} (${pick.confidence} confidence)${pick.runnerUp ? `, with ${pick.runnerUp} as the runner-up` : ''}, after looking closely at ${pick.viewed.length ? [...new Set(pick.viewed)].join(', ') : 'the map alone'}. ${pick.summary || ''}`,
    details: pick.cues || [], thoughts: pick.thoughts, images: pick.closeups.map((c) => ({ name: `closeup-${c.n}`, label: `Close-up of candidate ${c.n} (street side at the bottom)`, mediaType: c.mediaType, data: c.data })),
    usd: costOf(usage.pick, model) });

  // 3. records: the county's lot line and outline where it publishes them, and a check of the pick's address
  // confirmed: the county's parcel under the house carries the address; overridden: the records found it elsewhere;
  // unconfirmed: no records to check against (the pick stands on the photos alone)
  const county = COUNTIES[main.fips] || null, recNotes = [];
  let confirmed = 'unconfirmed';
  main = { ...main, centerLL: toLL(main.c) };
  let parcel = null;
  if (county) {
    parcel = await parcelAt(main.centerLL, county, { fetchImpl }).catch((e) => { recNotes.push(`Parcel lookup failed: ${e.message}`); return null; });
    if (parcel) {
      credits.add(`Lot line and records: ${parcel.source}`);
      const same = num && parcel.number === num && (!parcel.street || sameStreet(parcel.street, streetName) || bareStreet(streetName).includes(bareStreet(parcel.street).split(' ')[0]));
      if (same) { confirmed = 'confirmed'; recNotes.push(`The county's parcel under building ${pick.number} is ${parcel.address} (APN ${parcel.apn}): it matches the address, so the pick is confirmed by the records.`); }
      else {
        recNotes.push(`The county's parcel under building ${pick.number} is ${parcel.address || 'unaddressed'} (APN ${parcel.apn}), not ${address}.`);
        // look for the candidate whose parcel carries the address
        for (const c of candidates.filter((x) => x !== pick.candidate)) {
          const p2 = await parcelAt(toLL(c.c), county, { fetchImpl }).catch(() => null);
          if (p2 && p2.number === num) { confirmed = 'overridden'; recNotes.push(`Building ${c.n} stands on ${p2.address} (APN ${p2.apn}); the records override the pick and the house is building ${c.n}.`); main = { ...c, centerLL: toLL(c.c) }; parcel = p2; break; }
        }
        if (confirmed !== 'overridden') recNotes.push(`No building nearby stands on a parcel with number ${num}, so the pick stands unconfirmed.`);
      }
    }
    const co = await countyOutline(main, county, { fetchImpl }).catch((e) => { recNotes.push(`County outline lookup failed: ${e.message}`); return null; });
    if (co) {
      recNotes.push(`${co.source}: an outline of ${Math.round(co.areaSqFt || polygonArea(co.ring.map(frame(main.centerLL).toXY)) * 10.764)} sq ft${co.heightFt ? `, ${Math.round(co.heightFt)} ft tall at its highest` : ''} (drawn ${co.year || 'recently'}), replacing the national outline of ${main.areaSqFt} sq ft (${main.imageDate ? `imagery from ${main.imageDate}` : 'older imagery'}).`);
      main = { ...main, ring: co.ring, heightFt: co.heightFt || main.heightFt, areaSqFt: co.areaSqFt ? Math.round(co.areaSqFt) : main.areaSqFt, source: co.source, outlineDate: co.year ? String(co.year) : '' };
      credits.add(`Building outline: ${co.source}`);
    }
  }
  // other buildings on the lot (a detached garage, a back house): on the parcel, or right beside the house
  const mainXY = main.ring.map(toXY), mainC = centroid(mainXY);
  const outbuildings = all.filter((b) => b.id !== main.id && !pointIn(b.c, mainXY) && (parcel ? pointIn(b.c, parcel.ring.map(toXY)) : b.areaSqFt < 900 && Math.hypot(b.c[0] - mainC[0], b.c[1] - mainC[1]) < 25));
  const f = parcel && parcel.facts, factsText = [
    `${main.source} outline of the house: about ${main.areaSqFt} sq ft on the ground${main.heightFt ? `, about ${Math.round(main.heightFt)} ft tall` : ''}`,
    f ? `county records: ${[f.use, f.yearBuilt ? `built ${f.yearBuilt}` : '', f.bedrooms ? `${f.bedrooms} bedrooms` : '', f.bathrooms ? `${f.bathrooms} baths` : '', f.sqft ? `${f.sqft} sq ft of living space` : '', f.units > 1 ? `${f.units} units` : ''].filter(Boolean).join(', ')}` : '',
    parcel ? `the lot (${parcel.source}) is about ${Math.round(polygonArea(parcel.ring.map(toXY)) * 10.764)} sq ft` : '',
    outbuildings.length ? `${outbuildings.length} other building${outbuildings.length > 1 ? 's' : ''} on the lot (${outbuildings.map((o) => `${o.areaSqFt} sq ft`).join(', ')})` : '',
  ].filter(Boolean).join('; ') + '.';
  stage({ id: 'records', title: 'Records for the house', confirmed, summary: county ? `${county.name} publishes building outlines and parcels, so the house's outline and lot line come from the county. ${recNotes.join(' ')}` : `No county records are connected for this area, so the pick stands on the photos alone (unconfirmed), the national outline is used and the lot is read from the aerial. ${recNotes.join(' ')}`, details: [factsText] });

  // the streets, slope and lanes around the house itself (now that it's found); the map doesn't wait on them
  let terrain = null;
  try { terrain = await lookupTerrain(main.centerLL, address, { fetchImpl, plate }); } catch (e) { onEvent({ type: 'status', message: `Terrain skipped: ${e.message}` }); }
  const prop = propertyHint(address, { tags: { building: main.use && /apartment|multi/i.test(main.use) ? 'apartments' : null } });
  let back = [0, 1];
  if (terrain && terrain.frontage && terrain.frontage[0]) { const s0 = terrain.frontage[0]; back = unitVec([s0.from[0] - s0.nearest[0], s0.from[1] - s0.nearest[1]]); }
  else if (street) { const q = nearestOnLine(main.c, street.line); if (q) back = unitVec([main.c[0] - q.q[0], main.c[1] - q.q[1]]); }

  // 4. the map
  onEvent({ type: 'status', message: 'Mapping the house from above…' });
  const mapModel = siteModel || model;
  if (!main.outlineDate && main.imageDate) main.outlineDate = main.imageDate.slice(0, 4);
  const mapped = await mapHouse({ client, callClaude, model: mapModel, fallbackModel: model, effort: mapEffort, photos, views, address, main, outbuildings, parcel, back, plate, tools, fetchImpl, onEvent, usage: usage.map, facts: factsText, aerial });
  const mapUsd = Object.entries(usage.map).reduce((s, [m, u]) => s + costOf(u, m), 0);
  stage({ id: 'map', title: 'The house mapped from above', summary: mapped.plan.summary, details: [
    ...mapped.plan.blocks.map((b) => `${b.name}: ${b.stories} ${b.stories > 1 ? 'stories' : 'story'}, ${b.roof} roof${b.ridge && b.ridge !== 'none' ? `, ridge ${b.ridge}` : ''}, ${b.rects.map((r) => `${round1(r[2] - r[0])} x ${round1(r[3] - r[1])} ft`).join(' + ')}${b.note ? ` (${b.note})` : ''}`),
    ...mapped.plan.openings.map((o) => `${o.kind} on ${o.block}, ${round1(o.widthFt)} ft wide${o.note ? ` (${o.note})` : ''}`),
    `The blocks share ${Math.round(mapped.cov.iou * 100)}% with the outline (outline ${mapped.cov.outlineSqFt} sq ft, blocks ${mapped.cov.blocksSqFt} sq ft) after ${mapped.rounds.length} submission${mapped.rounds.length > 1 ? 's' : ''}.`,
    ...(mapped.plan.uncertain.length ? [`Guessed: ${mapped.plan.uncertain.join(' ')}`] : []),
    `Does this building match the photos? ${mapped.plan.matchesPhotos.answer}${mapped.plan.matchesPhotos.reason ? `: ${mapped.plan.matchesPhotos.reason}` : ''}`],
  thoughts: mapped.thoughts, model: mapped.model, usd: mapUsd,
  images: [{ name: 'map-plain', label: 'The house from above, street at the bottom, grid in feet', ...mapped.images.plain },
    { name: 'map-outline', label: 'The building outline (orange) and lot line (white)', ...mapped.images.annotated },
    { name: 'map-blocks', label: 'The mapped blocks, doors and lot over the aerial', ...mapped.overlay }] });

  // 5. the fit and the locked walls
  const fit = fitPlan(mapped.plan, { plate, lotRect: mapped.lotRect });
  if (terrain) { terrain.ftPerStud = fit.ftPerStud; terrain.analysis = analyzeTerrain(terrain.samples || [], { plate, ftPerStud: fit.ftPerStud }); terrain.note = terrainNote(terrain); }
  let locked = null, siteNote = '', stud = null, studs = null;
  if (!prop.multi) {
    locked = lockPlan(mapped.plan, fit);
    studs = siteInStuds(mapped.plan, locked, { lotRect: mapped.lotRect });
    stud = await studMap({ tools, locked, studs, toSite: mapped.toSite, fromSite: mapped.fromSite, fetchImpl }).catch((e) => { onEvent({ type: 'status', message: `Stud map skipped: ${e.message}` }); return null; });
    siteNote = siteNoteText({ plan: mapped.plan, locked, studs, fit, facts: factsText });
  }
  const sizes = fit.sizes.map((x) => `${x.name} ${x.ftPerStud} ft per stud${x.usual ? ' (its usual detail)' : x.whole ? '' : x.fits ? ' (yards shortened)' : ' (too big for it)'}`).join(', ');
  const rec = fit.recommended === plate ? `The ${sizeName(plate)} suits it.` : `The ${sizeName(fit.recommended)} would show it better, at ${fit.sizes.find((x) => x.plate === fit.recommended).ftPerStud} ft per stud.`;
  stage({ id: 'fit', title: 'Scale and locked walls', summary: prop.multi ? `The home looks like one unit of a larger building (${prop.why.join('; ')}), so the walls are not locked to the whole building.`
    : `The house is about ${fit.houseFt[0]} ft wide and ${fit.houseFt[1]} ft deep, ${fit.frontFt} ft back from the sidewalk, and the model shows ${fit.widthFt} ft across. On the ${sizeName(plate)} (${plate} x ${plate} studs) that takes ${fit.ftPerStud} ft per stud${fit.ftPerStud !== scaleFor(plate).ftPerStud ? ` instead of its usual ${scaleFor(plate).ftPerStud}` : ''}, with ${fit.frontRows} rows of front yard and ${fit.backRows} behind. Each size would take: ${sizes}. ${rec} ${fit.notes.join(' ')} ${fit.problems.join(' ')}`.trim(),
    details: locked ? [...locked.blocks.map((b) => `${b.name}: studs ${JSON.stringify(b.cellRects)}${b.openings.length ? `; ${b.openings.map((o) => `${o.kind} on the ${o.side} wall at [${o.cells.join(', ')}]`).join(', ')}` : ''}`), ...locked.problems.map((p) => `Layout: ${p}`)] : [],
    images: stud ? [{ name: 'studs', label: `The plate in studs with the locked walls and the lot (${fit.ftPerStud} ft per stud)`, ...stud }] : [] });

  const cost = costOf(usage.pick, model) + mapUsd;
  // the house as found: whether records confirmed it, and whether the mapper (a second look, closer) thinks it matches
  const found = { confirmed, matchesPhotos: mapped.plan.matchesPhotos, needsCheck: confirmed === 'unconfirmed' && (pick.confidence !== 'high' || mapped.plan.matchesPhotos.answer !== 'yes') || mapped.plan.matchesPhotos.answer === 'no' };
  return { center: main.centerLL, main, terrain, pick, parcel, found, plan: mapped.plan, coverage: mapped.cov, fit, locked, siteNote, studs, facts: factsText, credits: [...credits],
    images: locked ? [{ ...mapped.overlay, caption: 'the house from above with the mapped blocks, doors and lot (street at the bottom, grid in feet)' },
      ...(stud ? [{ ...stud, caption: `the plate in studs with the locked walls and the lot over the aerial (${fit.ftPerStud} ft per stud)` }] : [])] : [{ ...mapped.images.annotated, caption: 'the house from above (street at the bottom)' }],
    report: { address, stages, seconds: Math.round((Date.now() - t0) / 1000) }, usage, costUsd: cost };
}

module.exports = { mapSite, fitPlan, lockPlan, siteInStuds, siteNoteText, cleanPlan, coverage, mergeBuildings, numberCandidates, facingStreets, tigerStreets, sameStreet, siteFrame, centroid, pointIn, wallAxes, candidateLine, COUNTIES };
