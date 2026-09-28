const test = require('node:test');
const assert = require('node:assert');
const { testList, readReply, quote, cleanLots, makeQuoter } = require('../src/server/gobricks');

// A matcher reply shaped like GoBricks' own: one lot in stock, one out of stock, one color it doesn't make
function fakeFetch(calls) {
  return async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    const info = (id, price, inventory, caption) => ({ id, price: String(price), inventory, caption_en: caption });
    return { ok: true, status: 200, json: async () => ({
      itemList: [{ designid: '3008', colorid: '19', quantity: 62, info: info('GDS-536-031', 0.71, 6904, 'Brick 1 x 8') },
        { designid: '59900', colorid: '378', quantity: 6, info: info('GDS-606-048', 0.1, 500, 'Cone 1 x 1 [Top Groove]') }],
      inventoryDeficiency: [{ designid: '60603', colorid: '47', quantity: 3, info: info('GDS-878-180', 0.41, 0, 'Glass for Window 1 x 4 x 3') }],
      colorDeficiency: [{ designid: '3005', colorid: '7', quantity: 2, info: info('GDS-531-035', 0.17, 481, 'Brick 1 x 1') }],
      missList: [], noSellList: [], price: '44.62' }) };
  };
}
const lots = [{ no: '3008', color: 'Tan', q: 62, name: 'Brick 1 x 8' }, { no: '4589', color: 'Sand Green', q: 6, name: 'Cone 1 x 1' },
  { no: '60603', color: 'Trans-Clear', q: 3, name: 'Glass 1 x 4 x 3' }, { no: '3005', color: 'Light Gray', q: 2, name: 'Brick 1 x 1' }];

test('the matcher gets LEGO design numbers and LDraw colors', () => {
  assert.deepEqual(testList([{ no: '3070b', color: 'Tan', q: 4 }, { no: '4589', color: 'Sand Green', q: 1 }]), [
    { color_type: 'ldr', colorid: '19', designid: '3070', quantity: 4 }, { color_type: 'ldr', colorid: '378', designid: '59900', quantity: 1 }]);
});

test('a quote maps the reply back to our parts: in stock with prices, out of stock, not made', async () => {
  const calls = [], q = await quote([...lots, { no: '3811', color: 'Green', q: 1, kind: 'baseplate' }], { fetchImpl: fakeFetch(calls) });
  assert.equal(calls[0].testList.length, 5); // the baseplate is asked about too
  assert.deepEqual(q.items, [{ no: '3008', color: 'Tan', gds: 'GDS-536-031', price: 0.71, q: 62 }, { no: '4589', color: 'Sand Green', gds: 'GDS-606-048', price: 0.1, q: 6 }]);
  assert.equal(q.total, 44.62); assert.equal(q.pieces, 68); assert.equal(q.currency, 'CNY');
  assert.deepEqual(q.outOfStock, [{ no: '60603', name: 'Glass 1 x 4 x 3', color: 'Trans-Clear', q: 3, gds: 'GDS-878-180' }]);
  assert.deepEqual(q.notMade, [{ no: '3005', name: 'Brick 1 x 1', color: 'Light Gray', q: 2 }]);
  assert.equal(readReply({ itemList: [] }, lots).made.length, 0);
});

test('a client parts list is checked before anything is asked', () => {
  assert.deepEqual(cleanLots([{ no: '3008', color: 'Tan', q: 3, name: 'Brick', extra: 1 }]), [{ no: '3008', color: 'Tan', q: 3, name: 'Brick' }]);
  for (const bad of [null, [], [{ no: '3008', color: 'Plaid', q: 1 }], [{ no: '../x', color: 'Tan', q: 1 }], [{ no: '3008', color: 'Tan', q: 1.5 }],
    [{ no: '3008', color: 'Tan', q: 0 }], Array.from({ length: 601 }, () => ({ no: '3008', color: 'Tan', q: 1 }))]) assert.equal(cleanLots(bad), null);
});

test('the server asks about the same parts list once a day, and not again after a failure is cleared', async () => {
  const calls = []; let t = 0;
  const Q = makeQuoter({ fetchImpl: fakeFetch(calls), now: () => t });
  assert.equal(Q.cached(lots), false);
  const a = await Q.quote(lots), b = await Q.quote([...lots].reverse());
  assert.equal(calls.length, 1); assert.equal(a, b); assert.equal(Q.cached(lots), true);
  t += 25 * 3600e3; await Q.quote(lots); assert.equal(calls.length, 2);
  let fail = true;
  const F = makeQuoter({ fetchImpl: async (...args) => { if (fail) return { ok: false, status: 503 }; return fakeFetch(calls)(...args); } });
  await assert.rejects(F.quote(lots), /GoBricks matcher: 503/);
  fail = false; assert.equal((await F.quote(lots)).lots, 2);
});
