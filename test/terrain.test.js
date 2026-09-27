// Terrain: which street the house faces and how the ground slopes, with a fake fetch (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupTerrain, pickStreet, streetOf } = require('../src/server/terrain');

const place = { lat: 34.0, lon: -118.0 };
const mLat = 111320, mLon = 111320 * Math.cos(34 * Math.PI / 180);
const ll = (e, n) => ({ lat: place.lat + n / mLat, lon: place.lon + e / mLon });

// Elm Street runs north-south 10 m east of the house; a lane runs east-west 30 m north of it.
// Ground (ft) = 100 - 0.05 * east + 0.1 * north, in metres: rising to the north and to the west.
function fakeFetch() {
  return async (url) => {
    if (url.includes('/api/interpreter')) {
      const way = (name, pts) => ({ tags: { name, highway: 'residential' }, geometry: pts.map(([e, n]) => ll(e, n)) });
      return { ok: true, json: async () => ({ elements: [way('Elm Street', [[10, -80], [10, 80]]), way('Oak Lane', [[-80, 30], [80, 30]])] }) };
    }
    const u = new URL(url), lon = Number(u.searchParams.get('x')), lat = Number(u.searchParams.get('y'));
    const e = (lon - place.lon) * mLon, n = (lat - place.lat) * mLat;
    return { ok: true, json: async () => ({ value: 100 - 0.05 * e + 0.1 * n }) };
  };
}

test('street names match across abbreviations', () => {
  assert.equal(streetOf('3221 Griffith Park Blvd, Los Angeles, CA 90027'), 'griffith park boulevard');
  const streets = [{ name: 'Oak Lane', distanceM: 5 }, { name: 'Elm Street', distanceM: 12 }];
  assert.equal(pickStreet(streets, '12 Elm St, Springfield').name, 'Elm Street', 'the address street wins over a nearer one');
  assert.equal(pickStreet(streets, '').name, 'Oak Lane');
});

test('the slope is reported in the model frame: along the street and back into the lot', async () => {
  const t = await lookupTerrain(place, '5 Elm St, Springfield, IL', { fetchImpl: fakeFetch() });
  assert.equal(t.street.name, 'Elm Street');
  assert.ok(Math.abs(t.street.bearingTo - 90) < 1, 'the street is to the east');
  // Facing the house from the street (looking west), right is north: 0.1 ft/m over the 19.5 m plate.
  assert.equal(t.analysis.streetRiseRightFt, 2);
  // Back into the lot is west: 0.05 ft/m.
  assert.equal(t.analysis.lotRiseBackFt, 1);
  assert.match(t.note, /Elm Street runs past the east side of the house/);
  assert.match(t.note, /2 ft \(about 1 course\) higher on the right as seen from the street/);
  assert.match(t.note, /step up toward x = 31/);
  assert.match(t.note, /Oak Lane is 30 m to the north/);
});
