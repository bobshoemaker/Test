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

test('one unit of a larger building: not locked to the whole building outline, and the note says so', async () => {
  const row = way({ building: 'terrace', 'building:units': '4', 'addr:housenumber': '5', 'addr:street': 'Elm Street' }, [[-20, -5], [20, -5], [20, 5], [-20, 5], [-20, -5]]);
  const f = async (url) => {
    if (url.includes('/api/interpreter')) {
      const q = decodeURIComponent(new URL(url).searchParams.get('data'));
      return { ok: true, json: async () => ({ elements: q.includes('[building]') ? [row] : [way({ name: 'Elm Street', highway: 'residential' }, [[25, -80], [25, 80]])] }) };
    }
    return { ok: true, json: async () => ({ value: 100 }) };
  };
  const p = await prepareDesign({ address: '5 Elm St #B, Springfield', geocode, fetchImpl: f });
  assert.equal(p.locked, null);
  assert.equal(p.terrain.property.unit, 'B');
  assert.match(p.log.join(' '), /Walls not locked to the building outline: it looks like one unit of a larger building \(the address has unit B; OpenStreetMap tags the building "terrace"; its outline has 4 units\)/);
  assert.match(p.notes, /model unit B itself and cut it cleanly from its neighbours/);
});

// The site step (site.js) needs Claude and a browser; here a stand-in returns what it would.
const fakeSite = (calls) => async (args) => {
  calls.push(args);
  return { terrain: { note: 'Terrain: level.' }, fit: { ftPerStud: 2.5 }, siteNote: 'SITE PLAN FROM THE MAP.', images: [{ mediaType: 'image/jpeg', data: 'J', caption: 'from above' }],
    credits: ['Aerial photo: USDA NAIP via USGS (public domain)'], costUsd: 1.25, facts: 'built 1948', report: { stages: [] },
    locked: { source: 'site', size: 32, scale: { ftPerStud: 2.5 }, blocks: [], stairs: [], problems: [] } };
};
const tools = { drawLayers: async () => 'JPEG' };
const photos = [{ mediaType: 'image/jpeg', data: 'AAAA' }];

test('with photos, a client and the renderer, the house is mapped from above and the walls lock to the map', async () => {
  const calls = [];
  const p = await prepareDesign({ address: '5 Elm St', notes: 'blue door', geocode, fetchImpl, photos, views: ['front'], client: {}, model: 'm', siteModel: 's', tools, mapSiteImpl: fakeSite(calls) });
  assert.equal(p.lockSource, 'site');
  assert.equal(p.site.ftPerStud, 2.5);
  assert.equal(p.site.costUsd, 1.25);
  assert.equal(p.notes, 'blue door Address: 5 Elm St, Springfield. Terrain: level.');
  assert.deepEqual(p.log, ['Walls locked to the map of the house, at 2.5 ft per stud.']);
  assert.deepEqual([calls[0].siteModel, calls[0].views, calls[0].plate], ['s', ['front'], 32]);
  // a resumed job keeps the site it mapped: no lookups, no second map
  const again = await prepareDesign({ address: '5 Elm St', notes: 'blue door', site: p.site, geocode: async () => { throw new Error('no lookup'); }, mapSiteImpl: fakeSite(calls) });
  assert.equal(calls.length, 1);
  assert.equal(again.locked, p.site.locked);
  assert.equal(again.notes, 'blue door Terrain: level.');
});

test('when mapping fails, the walls fall back to the building outline; a floor plan skips mapping', async () => {
  const p = await prepareDesign({ address: '5 Elm St', geocode, fetchImpl, photos, client: {}, tools, mapSiteImpl: async () => { throw new Error('no aerial here'); } });
  assert.equal(p.lockSource, 'outline');
  assert.match(p.log.join(' '), /Site mapping skipped: no aerial here/);
  const calls = [];
  const planned = await prepareDesign({ address: '5 Elm St', plan: { mediaType: 'image/png', data: 'x' }, geocode, fetchImpl, photos, client: {}, tools, mapSiteImpl: fakeSite(calls) });
  assert.equal(planned.lockSource, 'plan');
  assert.equal(calls.length, 0);
});
