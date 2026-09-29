// GoBricks (compatible bricks): match a parts list against GoBricks' catalog, with stock and prices.
// This is the matcher GoBricks' own site uses for part lists (gobricks.cn); it isn't a documented
// public API, so get GoBricks' blessing before customers rely on it (support@webrick.com), and keep
// requests few: the catalog snapshot is built once (scripts/gobricks.js) and quotes are cached.
// Prices come back in Chinese yuan (the reply has no currency field; its per-piece prices fit yuan).
const MATCH_URL = 'https://gobricks.cn/frontend/v1/community/lego2ItemList';

// LDraw color codes for the engine's palette (the matcher takes LDraw colors)
const LDRAW_COLOR = { White: 15, Tan: 19, 'Dark Tan': 28, 'Light Nougat': 78, 'Light Bluish Gray': 71, 'Dark Bluish Gray': 72, Black: 0,
  'Reddish Brown': 70, 'Dark Orange': 484, Green: 2, 'Dark Green': 288, 'Bright Green': 10, 'Trans-Clear': 47, Red: 4, Yellow: 14,
  'Bright Pink': 29, 'Sand Green': 378, Blue: 1, 'Medium Nougat': 84, 'Light Gray': 7, 'Dark Red': 320, 'Sand Blue': 379, 'Olive Green': 330,
  'Dark Brown': 308, 'Trans-Yellow': 46, 'Trans-Black': 40, Lime: 27, 'Yellowish Green': 326, 'Medium Lavender': 324, Lavender: 325,
  Magenta: 26, 'Dark Pink': 5, Coral: 353, Orange: 25, 'Bright Light Orange': 191, 'Bright Light Yellow': 226, 'Medium Blue': 73 };
const COLOR_OF = Object.fromEntries(Object.entries(LDRAW_COLOR).map(([name, code]) => [String(code), name]));
// BrickLink numbers whose LEGO design number (what the matcher takes) differs; the matcher knows the
// 1 x 1 cone only as the current mold, 59900 (with the top groove)
const DESIGN_ID = { '3070b': '3070', '3069b': '3069', '3068b': '3068', '3062b': '3062', 4073: '6141', 4589: '59900' };
const designId = (no) => DESIGN_ID[no] || String(no);

// The matcher's request for lots [{no, color, q}] (colors outside the palette are left out)
function testList(lots) {
  return lots.filter((l) => LDRAW_COLOR[l.color] !== undefined)
    .map((l) => ({ color_type: 'ldr', colorid: String(LDRAW_COLOR[l.color]), designid: designId(l.no), quantity: Math.max(1, Math.round(l.q || 1)) }));
}

async function match(lots, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(MATCH_URL, { method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=utf-8', Accept: 'application/json', Origin: 'https://gobricks.cn', Referer: 'https://gobricks.cn/' },
    body: JSON.stringify({ testList: testList(lots) }) });
  if (!res.ok) throw new Error(`GoBricks matcher: ${res.status}`);
  return res.json();
}

// The reply, by our part number and color name: {made: [{no, color, gds, price, stock, q}], outOfStock: [...], notMade: [{no, color, q}]}
function readReply(reply, lots) {
  const byKey = new Map(lots.map((l) => [`${designId(l.no)}|${l.color}`, l]));
  const back = (i) => { const color = COLOR_OF[String(i.colorid)]; const l = byKey.get(`${i.designid}|${color}`); return { no: l ? l.no : i.designid, color, q: Number(i.quantity) || 0 }; };
  const item = (i) => ({ ...back(i), gds: i.info && i.info.id, price: i.info ? Number(i.info.price) : null, stock: i.info ? Number(i.info.inventory) : null, name: i.info && i.info.caption_en });
  return {
    made: (reply.itemList || []).map(item),
    outOfStock: (reply.inventoryDeficiency || []).map(item),
    notMade: [...(reply.colorDeficiency || []), ...(reply.missList || []), ...(reply.noSellList || [])].map(back),
    total: Number(reply.price) || null,
  };
}

// A quote for an engine inventory [{no, name, color, q, kind}]: what GoBricks can supply now and at what price.
async function quote(inventory, opts = {}) {
  const lots = inventory.map((e) => ({ no: e.no, color: e.color, q: e.q, name: e.name }));
  const r = readReply(await match(lots, opts), lots);
  const cost = r.made.reduce((s, i) => s + i.q * (i.price || 0), 0), pieces = r.made.reduce((s, i) => s + i.q, 0);
  const name = (x) => (lots.find((l) => l.no === x.no && l.color === x.color) || {}).name || x.name || x.no;
  return {
    supplier: 'GoBricks', currency: 'CNY', total: Number(cost.toFixed(2)), pieces, lots: r.made.length,
    items: r.made.map((i) => ({ no: i.no, color: i.color, gds: i.gds, price: i.price, q: i.q })),
    outOfStock: r.outOfStock.map((i) => ({ no: i.no, name: name(i), color: i.color, q: i.q, gds: i.gds, stock: i.stock })),
    notMade: r.notMade.map((i) => ({ no: i.no, name: name(i), color: i.color, q: i.q })),
  };
}

// A parts list sent by a client, checked: [{no, color, q, name?}] with palette colors and whole
// quantities, at most 600 lots; null if anything is off.
function cleanLots(list) {
  if (!Array.isArray(list) || !list.length || list.length > 600) return null;
  const out = [];
  for (const l of list) {
    if (!l || typeof l.no !== 'string' || !/^[0-9a-z]{3,10}$/i.test(l.no) || LDRAW_COLOR[l.color] === undefined) return null;
    const q = Number(l.q); if (!Number.isInteger(q) || q < 1 || q > 20000) return null;
    out.push({ no: l.no, color: l.color, q, ...(typeof l.name === 'string' ? { name: l.name.slice(0, 80) } : {}) });
  }
  return out;
}

// Quotes for the server: the same parts list is asked about once a day at most (in flight or answered);
// {fresh: true} asks again anyway (the admin's stock check before ordering a kit).
function makeQuoter({ fetchImpl = fetch, ttl = 24 * 3600e3, max = 500, now = Date.now } = {}) {
  const cache = new Map();
  const keyOf = (lots) => JSON.stringify(lots.map((l) => [l.no, l.color, l.q]).sort());
  const fresh = (e) => !!e && now() - e.at < ttl;
  return {
    cached: (lots) => fresh(cache.get(keyOf(lots))),
    quote(lots, { fresh: again = false } = {}) {
      const k = keyOf(lots), e = cache.get(k);
      if (fresh(e) && !again) return e.p;
      const p = quote(lots, { fetchImpl }).then((q) => ({ ...q, at: new Date(now()).toISOString() }));
      cache.set(k, { at: now(), p }); p.catch(() => cache.delete(k));
      if (cache.size > max) cache.delete(cache.keys().next().value);
      return p;
    },
  };
}

module.exports = { MATCH_URL, LDRAW_COLOR, designId, testList, match, readReply, quote, cleanLots, makeQuoter };
