// Finding a county's parcel records (parcels.js): layer URLs, reading records, the cache, and the search loop, with a
// fake network and a fake Claude.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findParcelSource, recordAt, readRecord, layerUrl, cached, remember } = require('../src/server/parcels');

const ll = { lat: 33.7, lon: -117.8 };
const d = 0.0002; // about 20 m
const square = (lat, lon, h) => [[[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]]];
const LAYER = 'https://gis.county.example.gov/arcgis/rest/services/Parcels/MapServer/0';
const tmpCache = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'parcels-')), 'cache.json');

// the county lookup (TIGERweb) and one parcel layer: a neighbour's parcel first in the reply, the house's second
function fakeFetch({ features } = {}) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const u = String(url), json = (j) => ({ ok: true, status: 200, json: async () => j });
    if (u.includes('State_County/MapServer/1/')) return json({ features: [{ attributes: { NAME: 'Test County', GEOID: '99059' } }] });
    if (u.includes('State_County/MapServer/0/')) return json({ features: [{ attributes: { NAME: 'California', STUSAB: 'CA' } }] });
    if (u.startsWith(LAYER)) return json({ features: features || [
      { attributes: { SITE_NO: '14', SITE_ST: 'ELM ST', APN: '111' }, geometry: { rings: square(ll.lat + 2 * d, ll.lon, d / 2) } },
      { attributes: { SITE_NO: '012', SITE_ST: 'ELM ST', APN: '222' }, geometry: { rings: square(ll.lat, ll.lon, d) } }] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  f.calls = calls;
  return f;
}

test('layerUrl keeps public ArcGIS REST layers only', () => {
  assert.equal(layerUrl(`${LAYER}/query?where=1=1`), LAYER);
  assert.equal(layerUrl('https://services.arcgis.com/abc/arcgis/rest/services/P/FeatureServer/3/'), 'https://services.arcgis.com/abc/arcgis/rest/services/P/FeatureServer/3');
  for (const bad of ['http://gis.county.gov/arcgis/rest/services/P/MapServer/0', 'https://127.0.0.1/arcgis/rest/services/P/MapServer/0',
    'https://localhost/arcgis/rest/services/P/MapServer/0', 'https://gis.county.gov/arcgis/rest/services/P/MapServer', 'https://gis.county.gov/parcels', 'nonsense'])
    assert.equal(layerUrl(bad), null, bad);
});

test('readRecord reads split and full addresses', () => {
  const split = readRecord({ fields: { number: 'N', street: 'S', apn: 'A' } }, { N: '0012', S: 'Elm St', A: 9 });
  assert.deepEqual(split, { number: '12', street: 'Elm St', address: '12 Elm St', apn: '9' });
  const full = readRecord({ fields: { full: 'SITUS' } }, { SITUS: '157 BRISBANE ST, MONROVIA CA' });
  assert.equal(full.number, '157'); assert.equal(full.street, 'BRISBANE ST');
});

test('recordAt takes the parcel containing the point, with its lot line', async () => {
  const src = { url: LAYER, kind: 'parcels', name: 'Test parcels', fields: { number: 'SITE_NO', street: 'SITE_ST', apn: 'APN' } };
  const r = await recordAt(src, ll, { fetchImpl: fakeFetch() });
  assert.equal(r.number, '12'); assert.equal(r.apn, '222'); assert.equal(r.ring.length, 4);
  assert.ok(r.areaSqFt > 10000 && r.areaSqFt < 20000, String(r.areaSqFt));
});

test('recordAt with address points takes the nearest point', async () => {
  const features = [{ attributes: { ADDR: '14 ELM ST' }, geometry: { x: ll.lon, y: ll.lat + d } }, { attributes: { ADDR: '12 ELM ST' }, geometry: { x: ll.lon, y: ll.lat + d / 4 } }];
  const r = await recordAt({ url: LAYER, kind: 'points', name: 'Points', fields: { full: 'ADDR' } }, ll, { fetchImpl: fakeFetch({ features }) });
  assert.equal(r.number, '12'); assert.deepEqual(r.numbers, ['12', '14']); assert.equal(r.ring, null);
});

test('the cache: a found source is kept; nothing found is retried after a month', () => {
  const cacheFile = tmpCache(), now = Date.parse('2026-09-01');
  assert.equal(cached('99001', { cacheFile, now }), undefined);
  remember('99001', { none: true, at: now }, { cacheFile });
  assert.equal(cached('99001', { cacheFile, now: now + 86400e3 }), null);
  assert.equal(cached('99001', { cacheFile, now: now + 31 * 86400e3 }), undefined);
  remember('99002', { url: LAYER, name: 'x' }, { cacheFile });
  assert.equal(cached('99002', { cacheFile, now }).url, LAYER);
});

// A fake Claude: tries a bad URL, queries the layer, submits wrong fields, then the right ones.
function fakeClaude(script) {
  let i = 0;
  const seen = [];
  const callClaude = async (client, params) => { seen.push(params.messages.at(-1)); return script[i++]; };
  callClaude.seen = seen;
  return callClaude;
}
const turn = (uses, usage = {}) => ({ stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 200, ...usage }, content: uses.map((u, k) => ({ type: 'tool_use', id: `t${k}`, ...u })) });

test('findParcelSource checks a submission at the house and caches it', async () => {
  const cacheFile = tmpCache(), fetchImpl = fakeFetch();
  const callClaude = fakeClaude([
    { stop_reason: 'pause_turn', usage: { input_tokens: 500, output_tokens: 50, server_tool_use: { web_search_requests: 3 } }, content: [{ type: 'text', text: 'searching' }] },
    turn([{ name: 'query_layer', input: { url: 'http://10.0.0.1/arcgis/rest/services/x/MapServer/0' } }, { name: 'query_layer', input: { url: LAYER } }]),
    turn([{ name: 'submit_source', input: { url: LAYER, kind: 'parcels', name: 'Orange County parcels', numberField: 'NOPE' } }]),
    turn([{ name: 'submit_source', input: { url: LAYER, kind: 'parcels', name: 'Orange County parcels', numberField: 'SITE_NO', streetField: 'SITE_ST', apnField: 'APN' } }]),
  ]);
  const r = await findParcelSource({ ll, address: '12 Elm St, Irvine, CA', client: {}, callClaude, model: 'claude-opus-5-5', fetchImpl, cacheFile, now: 1 });
  assert.equal(r.searched, true);
  assert.equal(r.source.url, LAYER); assert.equal(r.source.fips, '99059'); assert.equal(r.source.fields.number, 'SITE_NO');
  assert.deepEqual(r.tried, [LAYER]);
  assert.ok(r.usd >= 0.03, String(r.usd)); // three searches at a cent each, plus tokens
  // the bad URL was refused without a request, and the wrong field was sent back as an error
  assert.ok(!fetchImpl.calls.some((u) => u.includes('10.0.0.1')));
  const results = callClaude.seen.slice(2).map((m) => m.content);
  assert.match(results[0][0].content, /not a public ArcGIS REST layer/);
  assert.match(results[0][1].content, /SITE_NO/);
  assert.equal(results[1][0].is_error, true);
  // the next house in the county uses the cache: no search
  const again = await findParcelSource({ ll, address: '14 Elm St', client: {}, callClaude: async () => { throw new Error('searched again'); }, model: 'm', fetchImpl, cacheFile });
  assert.equal(again.searched, false); assert.equal(again.source.url, LAYER); assert.equal(again.usd, 0);
});

test('findParcelSource remembers a county with nothing usable', async () => {
  const cacheFile = tmpCache(), now = Date.parse('2026-09-01');
  const callClaude = fakeClaude([turn([{ name: 'give_up', input: { tried: 'the county has no public parcel service' } }])]);
  const r = await findParcelSource({ ll, address: '12 Elm St', client: {}, callClaude, model: 'm', fetchImpl: fakeFetch(), cacheFile, now });
  assert.equal(r.source, null); assert.match(r.report, /no public parcel service/);
  const again = await findParcelSource({ ll, address: '12 Elm St', client: {}, callClaude: async () => { throw new Error('searched again'); }, model: 'm', fetchImpl: fakeFetch(), cacheFile, now: now + 1000 });
  assert.equal(again.source, null); assert.equal(again.searched, false);
});

test('findParcelSource stops at its budget, after one last turn to submit', async () => {
  const pricey = () => turn([{ name: 'query_layer', input: { url: LAYER } }], { input_tokens: 400000 });
  const callClaude = fakeClaude([pricey(), pricey(), pricey(), pricey(), pricey()]);
  const r = await findParcelSource({ ll, address: '12 Elm St', client: {}, callClaude, model: 'claude-opus-5-5', fetchImpl: fakeFetch(), cacheFile: tmpCache(), budgetUsd: 1 });
  assert.equal(r.source, null); assert.match(r.report, /budget/);
  assert.ok(callClaude.seen.length <= 3, String(callClaude.seen.length));
  assert.ok(callClaude.seen.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'text' && /budget is spent/.test(b.text))));
});
