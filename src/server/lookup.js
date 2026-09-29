// Address lookup: geocode an address, then find street-level photos that look at the house.
// Sources follow docs/photo-sources.md: no Zillow/Redfin/Google scraping. Today that means
//   geocoding: OpenStreetMap Nominatim (building-level when OSM has the address), then the
//              US Census geocoder (street-level, interpolated along the block)
//   photos:    Mapillary (CC BY-SA 4.0, needs MAPILLARY_TOKEN); MLS and aerial feeds come later
// Every photo carries its credit and license so the design can keep them.
const UA = `Brickhouse/0.4 (house photo lookup${process.env.BRICKHOUSE_CONTACT ? '; ' + process.env.BRICKHOUSE_CONTACT : ''})`;
const MAPILLARY = 'https://graph.mapillary.com';
const PHOTO_FIELDS = 'id,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry,is_pano,creator,thumb_2048_url';
const EARTH = 6371000;
const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;

function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(h));
}
// Compass bearing from a to b, 0 = north, clockwise.
function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

async function getJson(fetchImpl, url, headers = {}) {
  const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

// Returns { lat, lon, label, precision: 'building' | 'street', source } or null.
async function geocode(address, { fetchImpl = fetch } = {}) {
  const q = encodeURIComponent(address);
  let street = null;
  try {
    const hits = await getJson(fetchImpl, `https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&limit=1&countrycodes=us`);
    const h = hits[0];
    if (h) {
      const place = { lat: +h.lat, lon: +h.lon, label: h.display_name, source: 'OpenStreetMap Nominatim (ODbL)' };
      // place_rank 30 is a building or address point; anything coarser is a road or area.
      if (h.place_rank >= 30 || h.category === 'building') return { ...place, precision: 'building' };
      if (h.addresstype === 'road') street = { ...place, precision: 'street' };
    }
  } catch (e) { /* fall through to the Census geocoder */ }
  try {
    const j = await getJson(fetchImpl, `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${q}&benchmark=Public_AR_Current&format=json`);
    const m = j.result && j.result.addressMatches && j.result.addressMatches[0];
    if (m) return { lat: m.coordinates.y, lon: m.coordinates.x, label: m.matchedAddress, precision: 'street', source: 'US Census geocoder' };
  } catch (e) { /* no match */ }
  return street;
}

function photoPoint(p) {
  const g = p.computed_geometry || p.geometry;
  return g && g.coordinates ? { lon: g.coordinates[0], lat: g.coordinates[1] } : null;
}

// Score Mapillary images for how well they show the house at `place`. Pure, so it's testable.
// Building-level: the camera must face the house. Street-level: the geocode sits on the
// street, so we can't tell which side the house is on; keep images facing across the street
// near the point and let the person pick.
function rankPhotos(place, images, { max = 8 } = {}) {
  const scored = [];
  for (const p of images) {
    if (p.is_pano) continue; // equirectangular; needs cropping before Claude can use it
    const at = photoPoint(p); if (!at) continue;
    const heading = p.computed_compass_angle ?? p.compass_angle; if (heading == null) continue;
    const dist = distanceM(at, place), toHouse = bearing(at, place), off = angleDiff(heading, toHouse);
    let score;
    if (place.precision === 'building') {
      if (dist < 6 || dist > 70 || off > 40) continue;
      score = (1 - off / 40) * 0.6 + (1 - Math.abs(dist - 22) / 50) * 0.4;
    } else {
      if (dist > 45) continue;
      const across = Math.abs(off - 90); // 0 when the camera looks sideways off the street
      if (across > 35) continue;
      score = (1 - across / 35) * 0.5 + (1 - dist / 45) * 0.5;
    }
    const age = p.captured_at ? (Date.now() - p.captured_at) / (365 * 864e5) : 10;
    score -= Math.min(age, 10) * 0.01; // prefer recent captures a little
    scored.push({ p, at, dist, off, score, side: bearing(place, at) });
  }
  scored.sort((a, b) => b.score - a.score);
  // Spread the picks around the house: one per 30 degree sector seen from the house.
  const out = [], used = new Set();
  for (const s of scored) {
    const sector = Math.floor(s.side / 30);
    if (used.has(sector)) continue;
    used.add(sector); out.push(s);
    if (out.length >= max) break;
  }
  return out.map(({ p, at, dist, off, score }) => ({
    id: String(p.id), source: 'mapillary', thumb: p.thumb_2048_url || null,
    lat: at.lat, lon: at.lon, distanceM: Math.round(dist), headingOffDeg: Math.round(off), score: +score.toFixed(3),
    capturedAt: p.captured_at ? new Date(p.captured_at).toISOString().slice(0, 10) : null,
    credit: `${p.creator && p.creator.username ? p.creator.username : 'Mapillary contributor'} via Mapillary`,
    license: 'CC BY-SA 4.0', page: `https://www.mapillary.com/app/?pKey=${p.id}`,
  }));
}

async function mapillaryNear(place, token, { fetchImpl = fetch, radiusM = 60 } = {}) {
  const dLat = deg(radiusM / EARTH), dLon = dLat / Math.cos(rad(place.lat));
  const bbox = [place.lon - dLon, place.lat - dLat, place.lon + dLon, place.lat + dLat].map((v) => v.toFixed(6)).join(',');
  const j = await getJson(fetchImpl, `${MAPILLARY}/images?fields=${PHOTO_FIELDS}&bbox=${bbox}&limit=500`, { authorization: `OAuth ${token}` });
  return j.data || [];
}

// Address in, candidate photos out. Missing sources are reported, not treated as errors.
async function lookupAddress(address, { fetchImpl = fetch, mapillaryToken = process.env.MAPILLARY_TOKEN } = {}) {
  address = String(address || '').trim().slice(0, 200);
  if (!address) throw new Error('Enter an address.');
  const place = await geocode(address, { fetchImpl });
  if (!place) return { place: null, photos: [], notes: ['No match for that address. Check the spelling, or upload photos instead.'] };
  const notes = [];
  if (place.precision === 'street') notes.push('The address matched a street, not a building, so photos from both sides of the street may show up. Pick the ones of the right house.');
  let photos = [];
  if (!mapillaryToken) notes.push('Street photos are off: add MAPILLARY_TOKEN to .env (free at mapillary.com/dashboard/developers).');
  else {
    photos = rankPhotos(place, await mapillaryNear(place, mapillaryToken, { fetchImpl }));
    if (!photos.length) notes.push('Mapillary has no usable street photos of this house. Ask the agent or homeowner for a front photo and two side views.');
    else notes.push('Mapillary photos are CC BY-SA 4.0 and commercial use is limited by Mapillary’s terms; check both before selling a model built from them.');
  }
  return { place, photos, notes };
}

// Fetch one Mapillary image by id. Only ids are accepted, so the server never fetches arbitrary URLs.
async function fetchMapillaryImage(id, token, { fetchImpl = fetch } = {}) {
  if (!/^\d{1,20}$/.test(String(id))) throw new Error('Bad photo id.');
  const meta = await getJson(fetchImpl, `${MAPILLARY}/${id}?fields=thumb_2048_url,creator`, { authorization: `OAuth ${token}` });
  if (!meta.thumb_2048_url) throw new Error('Mapillary has no image for that id.');
  const res = await fetchImpl(meta.thumb_2048_url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Image download failed (${res.status}).`);
  return { mediaType: res.headers.get('content-type') || 'image/jpeg', bytes: Buffer.from(await res.arrayBuffer()) };
}

module.exports = { geocode, rankPhotos, lookupAddress, fetchMapillaryImage, distanceM, bearing };
