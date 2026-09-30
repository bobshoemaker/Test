// Address lookup: geocoder fallback and street-photo ranking, with a fake fetch (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const { geocode, rankPhotos, lookupAddress, fetchMapillaryImage, distanceM, bearing, checkAddress } = require('../src/server/lookup');

const house = { lat: 34.0, lon: -118.0, precision: 'building' };
// A point `m` metres from the house in compass direction `dir`.
function at(dir, m) {
  const dLat = (m * Math.cos(dir * Math.PI / 180)) / 111320, dLon = (m * Math.sin(dir * Math.PI / 180)) / (111320 * Math.cos(34 * Math.PI / 180));
  return [house.lon + dLon, house.lat + dLat];
}
const img = (id, dir, m, heading, extra = {}) => ({ id, geometry: { coordinates: at(dir, m) }, compass_angle: heading, captured_at: Date.parse('2025-06-01'), creator: { username: 'pat' }, ...extra });
function fakeFetch(routes) {
  return async (url) => {
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) throw new Error('unexpected fetch ' + url);
    return { ok: true, status: 200, json: async () => hit[1], headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new ArrayBuffer(3) };
  };
}

test('geometry helpers', () => {
  const p = { lat: house.lat, lon: house.lon };
  const [lon, lat] = at(90, 20);
  assert.ok(Math.abs(distanceM(p, { lat, lon }) - 20) < 0.5);
  assert.ok(Math.abs(bearing(p, { lat, lon }) - 90) < 0.5);
});

test('building match keeps cameras facing the house and spreads them around it', () => {
  const photos = rankPhotos(house, [
    img(1, 180, 20, 0),                   // south of the house, looking north at it
    img(2, 185, 22, 30),                  // same side, aimed 25 degrees off: weaker duplicate
    img(3, 135, 25, 315),                 // south-east oblique, looking north-west at it
    img(4, 180, 20, 90),                  // right place, looking along the street
    img(5, 180, 150, 0),                  // too far
    img(6, 225, 20, 45, { is_pano: true }), // panorama, skipped
  ]);
  assert.deepEqual(photos.map((p) => p.id), ['1', '3']);
  assert.equal(photos[0].license, 'CC BY-SA 4.0');
  assert.match(photos[0].credit, /pat via Mapillary/);
  assert.equal(photos[0].page, 'https://www.mapillary.com/app/?pKey=1');
});

test('street match keeps cameras looking across the street near the point', () => {
  const street = { ...house, precision: 'street' };
  // Street runs east-west through the point. Cameras on it look north or south across it.
  const photos = rankPhotos(street, [img(1, 90, 10, 0), img(2, 270, 12, 180), img(3, 90, 10, 270), img(4, 90, 80, 0)]);
  assert.deepEqual(photos.map((p) => p.id).sort(), ['1', '2']);
});

test('geocode prefers a building-level OpenStreetMap hit', async () => {
  const place = await geocode('200 N Spring St', { fetchImpl: fakeFetch([
    [/nominatim/, [{ lat: '34.05', lon: '-118.24', place_rank: 30, category: 'building', display_name: 'City Hall' }]],
  ]) });
  assert.deepEqual(place, { lat: 34.05, lon: -118.24, label: 'City Hall', source: 'OpenStreetMap Nominatim (ODbL)', precision: 'building' });
});

test('geocode falls back to the Census geocoder when OSM only knows the road', async () => {
  const place = await geocode('12 Elm St', { fetchImpl: fakeFetch([
    [/nominatim/, [{ lat: '1', lon: '2', place_rank: 26, addresstype: 'road', display_name: 'Elm St' }]],
    [/census/, { result: { addressMatches: [{ coordinates: { x: -90.1, y: 40.2 }, matchedAddress: '12 ELM ST' }] } }],
  ]) });
  assert.equal(place.source, 'US Census geocoder');
  assert.equal(place.precision, 'street');
  assert.equal(place.lat, 40.2);
});

test('lookup without a Mapillary token returns the place and says how to turn photos on', async () => {
  const out = await lookupAddress('200 N Spring St', { mapillaryToken: '', fetchImpl: fakeFetch([
    [/nominatim/, [{ lat: '34', lon: '-118', place_rank: 30, display_name: 'City Hall' }]],
  ]) });
  assert.equal(out.photos.length, 0);
  assert.ok(out.notes.some((n) => /MAPILLARY_TOKEN/.test(n)));
});

test('lookup with a token ranks Mapillary results', async () => {
  const out = await lookupAddress('x', { mapillaryToken: 'MLY|t', fetchImpl: fakeFetch([
    [/nominatim/, [{ lat: String(house.lat), lon: String(house.lon), place_rank: 30, display_name: 'House' }]],
    [/graph\.mapillary\.com\/images/, { data: [img(7, 180, 20, 0)] }],
  ]) });
  assert.deepEqual(out.photos.map((p) => p.id), ['7']);
});

test('photo download only accepts numeric ids', async () => {
  await assert.rejects(fetchMapillaryImage('../x', 't', { fetchImpl: fakeFetch([]) }), /Bad photo id/);
  const got = await fetchMapillaryImage('123', 't', { fetchImpl: fakeFetch([
    [/graph\.mapillary\.com\/123/, { thumb_2048_url: 'https://cdn.example/img.jpg' }], [/cdn\.example/, {}],
  ]) });
  assert.equal(got.bytes.length, 3);
});

// checkAddress: the Census geocoder decides; OpenStreetMap can vouch for a number the Census doesn't know
const addrFetch = ({ census = [], osm = [], censusDown = false, osmDown = false } = {}) => async (url) => {
  const u = String(url);
  if (u.includes('geocoding.geo.census.gov')) return censusDown ? { ok: false, status: 503 } : { ok: true, json: async () => ({ result: { addressMatches: census } }) };
  if (u.includes('nominatim')) return osmDown ? { ok: false, status: 503 } : { ok: true, json: async () => osm };
  throw new Error('unexpected ' + u);
};
const cMatch = (a) => ({ matchedAddress: a, coordinates: { x: -118, y: 34 } });
test('checkAddress wants a house number and a city and state or ZIP', async () => {
  for (const a of ['Brisbane St, Monrovia, CA', '157 Brisbane St', '12 Main St Springfield'])
    assert.equal((await checkAddress(a, { fetchImpl: addrFetch() })).ok, false, a);
  for (const a of ['157 Brisbane St, Monrovia', '157 brisbane st monrovia ca', '157 Brisbane St 91016', '157 Brisbane St Monrovia California'])
    assert.equal((await checkAddress(a, { fetchImpl: addrFetch({ census: [cMatch('157 E BRISBANE ST, MONROVIA, CA, 91016')] }) })).ok, true, a);
});
test('checkAddress: found, wrong number, not found, and services down', async () => {
  const ok = await checkAddress('157 Brisbane St, Monrovia, CA', { fetchImpl: addrFetch({ census: [cMatch('157 E BRISBANE ST, MONROVIA, CA, 91016')] }) });
  assert.equal(ok.label, '157 E BRISBANE ST, MONROVIA, CA, 91016'); assert.equal(ok.place.lat, 34);
  const wrongNo = await checkAddress('99999 Brisbane St, Monrovia, CA', { fetchImpl: addrFetch({ osm: [{ address: { road: 'East Brisbane Street' } }] }) });
  assert.equal(wrongNo.ok, false); assert.match(wrongNo.message, /East Brisbane Street but not number 99999/);
  assert.match((await checkAddress('12 Qwerty Rd, Nowhere, ZZ', { fetchImpl: addrFetch() })).message, /couldn't find/);
  // OpenStreetMap knows a number the Census doesn't
  const osmOnly = await checkAddress('5 New Ln, Springfield, IL', { fetchImpl: addrFetch({ osm: [{ lat: '40', lon: '-89', display_name: '5, New Lane, Springfield', address: { house_number: '5', road: 'New Lane' } }] }) });
  assert.equal(osmOnly.ok, true); assert.equal(osmOnly.place.precision, 'building');
  // the Census geocoder down: never blocks an order
  assert.deepEqual(await checkAddress('5 Elm St, Springfield, IL', { fetchImpl: addrFetch({ censusDown: true }) }), { ok: true, unchecked: true });
  assert.equal((await checkAddress('5 Elm St, Springfield, IL', { fetchImpl: addrFetch({ censusDown: true, osmDown: true }) })).ok, true);
});
