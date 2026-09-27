// Terrain: the house's building, the streets it fronts and how the ground slopes, with a fake fetch (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupTerrain, pickStreet, streetOf, numberOf } = require('../src/server/terrain');

const place = { lat: 34.0, lon: -118.0 };
const mLat = 111320, mLon = 111320 * Math.cos(34 * Math.PI / 180);
const ll = (e, n) => ({ lat: place.lat + n / mLat, lon: place.lon + e / mLon });
const way = (tags, pts) => ({ type: 'way', tags, geometry: pts.map(([e, n]) => ll(e, n)) });

// Ground (ft) = 100 - 0.05 * east + 0.1 * north, in metres: rising to the north and to the west.
// streets: [name, points]; buildings: overpass ways for the building query.
function fakeFetch({ streets, buildings = [] }) {
  return async (url) => {
    if (url.includes('/api/interpreter')) {
      const q = decodeURIComponent(new URL(url).searchParams.get('data'));
      const elements = q.includes('[building]') ? buildings : streets.map(([name, pts]) => way({ name, highway: 'residential' }, pts));
      return { ok: true, json: async () => ({ elements }) };
    }
    const u = new URL(url), lon = Number(u.searchParams.get('x')), lat = Number(u.searchParams.get('y'));
    const e = (lon - place.lon) * mLon, n = (lat - place.lat) * mLat;
    return { ok: true, json: async () => ({ value: 100 - 0.05 * e + 0.1 * n }) };
  };
}
const elm = ['Elm Street', [[10, -80], [10, 80]]]; // north-south, 10 m east of the address point
const oak = ['Oak Lane', [[-80, 12], [80, 12]]]; // east-west, 12 m north of it

test('addresses split into number and street, and names match across abbreviations', () => {
  assert.equal(streetOf('3221 Griffith Park Blvd, Los Angeles, CA 90027'), 'griffith park boulevard');
  assert.equal(numberOf('3221 Griffith Park Blvd'), '3221');
  const streets = [{ name: 'Oak Lane', distanceM: 5 }, { name: 'Elm Street', distanceM: 12 }];
  assert.equal(pickStreet(streets, '12 Elm St, Springfield').name, 'Elm Street', 'the address street wins over a nearer one');
  assert.equal(pickStreet(streets, '').name, 'Oak Lane');
});

test('one street: slopes in the model frame, along the street and back into the lot', async () => {
  const t = await lookupTerrain(place, '5 Elm St, Springfield, IL', { fetchImpl: fakeFetch({ streets: [elm, ['Far Road', [[-80, 40], [80, 40]]]] }) });
  assert.equal(t.building, null);
  assert.deepEqual(t.frontage.map((s) => s.name), ['Elm Street']);
  // Facing the house from Elm Street (looking west), right is north: 0.1 ft/m over the 19.5 m plate.
  assert.equal(t.analysis.streets[0].riseRightFt, 2);
  assert.equal(t.analysis.lotRiseBackFt, 1); // back into the lot is west: 0.05 ft/m
  assert.match(t.note, /Elm Street runs along the side of the house that faces the street \(z = 31\)/);
  assert.match(t.note, /2 ft \(about 1 course\) higher on the right as seen from Elm Street facing the house/);
});

test('a corner lot: found by its building outline, with both streets and the side the corner is on', async () => {
  const sq = [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]];
  const buildings = [
    way({ building: 'house', 'addr:housenumber': '5', 'addr:street': 'Elm Street', height: '4.5', start_date: '1924', 'lacounty:ain': '77' }, sq.map(([e, n]) => [e - 30, n])),
    way({ building: 'garage', 'lacounty:ain': '77' }, [[-40, -3], [-37, -3], [-37, 3], [-40, 3], [-40, -3]]),
    way({ building: 'house', 'addr:housenumber': '7', 'addr:street': 'Elm Street' }, sq),
  ];
  // The geocoded point sits on the neighbour (number 7); the real house is 30 m west, beside two streets.
  const t = await lookupTerrain(place, '5 Elm St, Springfield', { fetchImpl: fakeFetch({ buildings,
    streets: [['Elm Street', [[-20, -80], [-20, 80]]], ['Oak Lane', [[-80, 12], [80, 12]]]] }) });
  assert.equal(t.building.areaSqFt, 1076);
  assert.equal(t.building.outbuildings.length, 1);
  assert.deepEqual(t.frontage.map((s) => s.name), ['Elm Street', 'Oak Lane']);
  assert.match(t.note, /about 1076 sq ft, about 15 ft tall, built 1924, with 1 outbuilding/);
  // Facing the house from Elm Street (looking west), Oak Lane to the north is on the right.
  assert.match(t.note, /corner lot on Elm Street and Oak Lane\. Seen from Elm Street facing the house, Oak Lane is on the right; seen from Oak Lane, Elm Street is on the left\./);
  assert.match(t.note, /with Elm Street at z = 31, Oak Lane runs along x = 31; with Oak Lane at z = 31, Elm Street runs along x = 0\./);
});
