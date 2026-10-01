// The preview of a design before its kit is ordered: enough to see the house and judge it, not enough to
// order the parts elsewhere. The whole model shows, but its plain bricks, plates and tiles are merged into
// made-up blocks (same shape and colors, none of the real pieces or seams); windows, slopes, plants and other
// special parts show as themselves, as they would in any picture. The guide keeps only its first few steps,
// and the Kit tab gets totals and colors, not the list. The full design is served once a kit is ordered.
const { compile } = require('../engine/engine.js');

const PREVIEW_STEPS = 3; // guide steps shown before the kit is ordered
const MAX_BLOCK = 8; // merged blocks stay brick-like: at most this many studs a side
const PLAIN = new Set(['brick', 'plate', 'tile']);
// what the viewer needs to draw a part
const KEEP = ['kind', 'key', 'no', 'name', 'shape', 'diam', 'archTop', 'color', 'x', 'y', 'z', 'w', 'd', 'h', 'rot', 'dir', 'face', 'glass', 'liftoff', 'sub', 'copy', 'studs'];

function makePreview(design) {
  const R = compile(design);
  const shown = R.steps.slice(0, PREVIEW_STEPS), shownIds = new Set(shown.flatMap((s) => s.parts || []));
  const out = [], newId = new Map();
  const add = (p) => { p.id = out.length + 1; out.push(p); return p.id; };
  // real parts: those in the shown steps, and every special part (drawn as itself anyway)
  const groups = new Map();
  for (const p of R.parts) {
    const real = shownIds.has(p.id) || !PLAIN.has(p.kind) || p.shape !== 'box' || p.sub !== undefined;
    if (real) {
      const q = {}; for (const k of KEEP) if (p[k] !== undefined && p[k] !== null) q[k] = p[k];
      if (shownIds.has(p.id)) { if (p.mainStep !== undefined) q.mainStep = p.mainStep; if (p.buildStep !== undefined) q.buildStep = p.buildStep; }
      newId.set(p.id, add(q));
      continue;
    }
    // the rest are cut into studs, grouped by layer, height, color and lift-off group, to be re-merged
    const k = [p.y, p.h, p.kind === 'tile' ? 't' : 's', p.color, p.liftoff || '', p.context ? 1 : 0].join('|');
    if (!groups.has(k)) groups.set(k, { y: p.y, h: p.h, tile: p.kind === 'tile', color: p.color, liftoff: p.liftoff, cells: new Set() });
    for (let i = 0; i < p.w; i++) for (let j = 0; j < p.d; j++) groups.get(k).cells.add((p.x + i) + ',' + (p.z + j));
  }
  for (const g of groups.values()) {
    const cells = [...g.cells].map((c) => c.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const free = new Set(g.cells);
    for (const [x, z] of cells) {
      if (!free.has(x + ',' + z)) continue;
      let w = 1; while (w < MAX_BLOCK && free.has((x + w) + ',' + z)) w++;
      let d = 1; while (d < MAX_BLOCK && Array.from({ length: w }, (_, i) => free.has((x + i) + ',' + (z + d))).every(Boolean)) d++;
      const studs = [];
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) { free.delete((x + i) + ',' + (z + j)); if (!g.tile) studs.push([x + i, z + j]); }
      const kind = g.tile ? 'tile' : g.h === 3 ? 'brick' : 'plate';
      add({ kind, shape: 'box', color: g.color, x, y: g.y, z, w, d, h: g.h, rot: 0, studs, ...(g.liftoff ? { liftoff: g.liftoff } : {}) });
    }
  }
  const colors = new Map(); for (const e of R.inventory) colors.set(e.color, (colors.get(e.color) || 0) + e.q);
  return {
    preview: true,
    name: design.name, place: design.place, unit: design.unit, facts: design.facts, assumed: design.assumed, guesses: design.guesses, photoCredits: design.photoCredits, mapCredits: design.mapCredits,
    parts: out,
    steps: shown.map((s) => ({ kind: s.kind, title: s.title, n: s.n, of: s.of, sub: s.sub, parts: (s.parts || []).map((id) => newId.get(id)).filter(Boolean) })),
    subs: R.subs.map((s) => ({ name: s.name, copies: s.copies })),
    stats: { pieces: R.stats.pieces, steps: R.stats.steps, pages: R.stats.pages, lots: R.stats.lots, joints: R.stats.joints, plate: R.stats.plate,
      baseColor: R.stats.baseColor, baseThick: R.stats.baseThick, liftoff: R.stats.liftoff, subBuilds: R.stats.subBuilds,
      colors: [...colors].sort((a, b) => b[1] - a[1]).map(([color, q]) => ({ color, q })) },
    errors: R.errors.map((e) => ({ msg: e.msg })), warnings: R.warnings.map((e) => ({ msg: e.msg })),
  };
}

module.exports = { makePreview, PREVIEW_STEPS };
