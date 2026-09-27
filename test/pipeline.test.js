// The steps before Claude designs, shared by the server and the CLI, for houses with and without a plan.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareDesign } = require('../src/server/pipeline');

const place = { lat: 34.0, lon: -118.0, label: '5 Elm St, Springfield' };
const mLat = 111320, mLon = 111320 * Math.cos(34 * Math.PI / 180);
const way = (tags, pts) => ({ type: 'way', tags, geometry: pts.map(([e, n]) => ({ lat: place.lat + n / mLat, lon: place.lon + e / mLon })) });
const house = way({ building: 'house', 'addr:housenumber': '5', 'addr:street': 'Elm Street' }, [[-6, -5], [6, -5], [6, 5], [-6, 5], [-6, -5]]);
const fetchImpl = async (url) => {
  if (url.includes('/api/interpreter')) {
    const q = decodeURIComponent(new URL(url).searchParams.get('data'));
    return { ok: true, json: async () => ({ elements: q.includes('[building]') ? [house] : [way({ name: 'Elm Street', highway: 'residential' }, [[10, -80], [10, 80]])] }) };
  }
  return { ok: true, json: async () => ({ value: 100 }) };
};
const geocode = async () => place;

test('no plan: the address adds its facts to the notes and locks the walls to the building outline', async () => {
  const p = await prepareDesign({ address: '5 Elm St', notes: 'blue door', plate: 48, geocode, fetchImpl });
  assert.match(p.notes, /^blue door Address: 5 Elm St, Springfield\. Terrain/);
  assert.equal(p.lockSource, 'outline');
  assert.equal(p.locked.size, 48);
  assert.equal(p.locked.blocks[0].name, 'House');
});

test('with a plan the walls wait for the plan; with no address nothing is looked up', async () => {
  const withPlan = await prepareDesign({ address: '5 Elm St', plan: { mediaType: 'image/png', data: 'x' }, geocode, fetchImpl });
  assert.equal(withPlan.lockSource, 'plan');
  assert.equal(withPlan.locked, null);
  const bare = await prepareDesign({ notes: 'only photos' });
  assert.deepEqual([bare.notes, bare.locked, bare.lockSource, bare.log], ['only photos', null, null, []]);
});

test('a failed lookup leaves the notes alone and says why', async () => {
  const p = await prepareDesign({ address: 'nowhere', notes: 'n', geocode: async () => null, fetchImpl });
  assert.equal(p.notes, 'n');
  assert.match(p.log.join(' '), /Address not found: nowhere/);
});
