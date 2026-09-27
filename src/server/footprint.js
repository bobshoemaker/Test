// Floor plan to locked walls. Claude reads the plan in its own pixel coordinates (off a gridded
// copy); this module scales that to studs from the labeled room sizes, fits it on the baseplate
// with the street along z = 31, turns it into walls ops the brick design has to keep, and checks
// designs against it. Pure: no I/O.

// Rotations that bring the plan side facing the street to the bottom (z grows toward the street).
const ROT = { S: [[1, 0], [0, 1]], N: [[-1, 0], [0, -1]], E: [[0, -1], [1, 0]], W: [[0, 1], [-1, 0]] };
const key = (x, z) => x + ',' + z;

function parseLabel(label) {
  const m = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i.exec(label || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Plan pixels per foot from rooms with size labels. The longer label side goes with the longer rectangle side.
function calibrate(rooms) {
  const ratios = [], per = [];
  for (const r of rooms || []) {
    const ft = parseLabel(r.label);
    if (!ft || !Array.isArray(r.rectPx) || r.rectPx.length !== 4) continue;
    const w = Math.abs(r.rectPx[2] - r.rectPx[0]), h = Math.abs(r.rectPx[3] - r.rectPx[1]);
    let [a, b] = ft;
    if ((a - b) * (w - h) < 0) [a, b] = [b, a];
    if (!a || !b || !w || !h) continue;
    ratios.push(w / a, h / b);
    per.push({ name: r.name, pxPerFt: (w / a + h / b) / 2 });
  }
  return ratios.length ? { pxPerFt: median(ratios), rooms: per } : null;
}

const rectCells = ([x0, z0, x1, z1]) => {
  const out = [];
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push([x, z]);
  return out;
};
const lineCells = ([x0, z0, x1, z1]) => {
  const out = [];
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) out.push([x, z]);
  return out;
};

// Outline of a union of cell rectangles: cells with any of their 8 neighbors outside (8, so inside
// corners of an L stay closed).
function outline(rects) {
  const inside = new Set();
  for (const r of rects) for (const [x, z] of rectCells(r)) inside.add(key(x, z));
  const out = [];
  for (const k of inside) {
    const [x, z] = k.split(',').map(Number);
    let edge = false;
    for (let dx = -1; dx <= 1 && !edge; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && !inside.has(key(x + dx, z + dz))) { edge = true; break; }
    if (edge) out.push([x, z]);
  }
  return { inside, cells: out };
}

// Straight wall segments covering a set of cells: runs along x and along z, then any leftover cell.
function segmentsFromCells(cells) {
  const set = new Set(cells.map(([x, z]) => key(x, z))), used = new Set(), segs = [];
  const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    if (!set.has(key(x, z)) || set.has(key(x - 1, z))) continue;
    let e = x; while (set.has(key(e + 1, z))) e++;
    if (e > x) { segs.push([x, z, e, z]); for (let i = x; i <= e; i++) used.add(key(i, z)); }
  }
  for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
    if (!set.has(key(x, z)) || set.has(key(x, z - 1))) continue;
    let e = z; while (set.has(key(x, e + 1))) e++;
    if (e > z) { segs.push([x, z, x, e]); for (let i = z; i <= e; i++) used.add(key(x, i)); }
  }
  for (const [x, z] of cells) if (!used.has(key(x, z))) segs.push([x, z, x, z]);
  return segs;
}

const DEFAULT_FILL = {
  'garage door': { courses: [0, 2], fill: { color: 'Black' } },
  door: { courses: [0, 2], fill: { color: 'Reddish Brown' } },
  'double door': { courses: [0, 2], fill: { color: 'Black' } },
  'sliding door': { courses: [0, 2], fill: { color: 'Black' } },
};

/**
 * Lays a footprint read from a floor plan out in studs.
 * @param {object} fp  {street, rooms:[{name,label,rectPx}], blocks:[{name,levels,rectsPx}],
 *                      openings:[{block,kind,atPx,widthFt}], stairs:[{name,rectPx}]} in plan pixels
 * @returns {object} {scale, blocks:[{name,levels,cellRects,cells,openings}], stairs, map, problems}
 *   map: stud = [a*px + c*py + e, b*px + d*py + f], cell centers at integer + 0.5 (for overlays)
 */
function layoutFootprint(fp, { ftPerStud = 2, size = 32, streetRows = 2, minGap = 2, frontYard = 0 } = {}) {
  const problems = [];
  const cal = calibrate(fp.rooms);
  if (!cal) return { problems: ['Give at least two rooms with size labels (like "14 x 20") and their rectPx so the plan can be scaled.'], blocks: [] };
  if (cal.rooms.length < 2) problems.push('Only one labeled room came through; add another so the scale can be checked.');
  for (const r of cal.rooms) {
    const off = (r.pxPerFt - cal.pxPerFt) / cal.pxPerFt;
    if (Math.abs(off) > 0.12) problems.push(`${r.name} measures ${r.pxPerFt.toFixed(2)} px per ft, ${Math.round(off * 100)}% off the ${cal.pxPerFt.toFixed(2)} the other rooms agree on; check its rectPx.`);
  }
  const street = ROT[fp.street] ? fp.street : 'S';
  if (!ROT[fp.street]) problems.push('street must be N, S, E or W; used S.');
  const R = ROT[street], pps = cal.pxPerFt * ftPerStud;
  const rot = ([x, y]) => [R[0][0] * x + R[0][1] * y, R[1][0] * x + R[1][1] * y];
  const rotRect = (r) => {
    const a = rot([r[0], r[1]]), b = rot([r[2], r[3]]);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  };

  const blocks = (fp.blocks || []).filter((b) => Array.isArray(b.rectsPx) && b.rectsPx.length)
    .map((b) => ({ name: b.name, levels: Math.max(1, Math.round(b.levels || 1)), rects: b.rectsPx.map(rotRect), dz: 0 }));
  if (!blocks.length) return { problems: [...problems, 'No blocks with rectsPx came through.'], blocks: [] };
  let minX = Infinity, minY = Infinity;
  for (const b of blocks) for (const r of b.rects) { minX = Math.min(minX, r[0]); minY = Math.min(minY, r[1]); }
  // Wall lines map to cell centers, so a wall shared by two rectangles lands on one row of cells.
  const toS = (X, Y) => [(X - minX) / pps, (Y - minY) / pps];
  for (const b of blocks) {
    b.cellRects = b.rects.map((r) => {
      const [x0, z0] = toS(r[0], r[1]), [x1, z1] = toS(r[2], r[3]);
      const cx0 = Math.round(x0), cz0 = Math.round(z0);
      return [cx0, cz0, Math.max(cx0 + 1, Math.round(x1)), Math.max(cz0 + 1, Math.round(z1))];
    });
  }

  // Too deep for the baseplate: pull detached parts behind the house forward, keeping minGap rows of yard.
  const span = (b) => [Math.min(...b.cellRects.map((r) => r[1])), Math.max(...b.cellRects.map((r) => r[3]))];
  const touches = (a, b) => a.cellRects.some((r) => b.cellRects.some((s) => r[0] <= s[2] + 1 && s[0] <= r[2] + 1 && r[1] <= s[3] + 1 && s[1] <= r[3] + 1));
  const comps = [];
  for (const b of blocks) {
    const hit = comps.filter((c) => c.some((o) => touches(o, b)));
    const merged = [b, ...hit.flat()];
    for (const h of hit) comps.splice(comps.indexOf(h), 1);
    comps.push(merged);
  }
  const cspan = (c) => [Math.min(...c.map((b) => span(b)[0])), Math.max(...c.map((b) => span(b)[1]))];
  comps.sort((a, b) => cspan(b)[1] - cspan(a)[1]);
  const avail = size - streetRows;
  let need = Math.max(...blocks.map((b) => span(b)[1])) - Math.min(...blocks.map((b) => span(b)[0])) + 1 - avail;
  for (let i = 1; i < comps.length && need > 0; i++) {
    const frontZ0 = Math.min(...comps.slice(0, i).map((c) => cspan(c)[0]));
    const gap = frontZ0 - cspan(comps[i])[1] - 1;
    const shift = Math.min(Math.max(0, gap - minGap), need);
    if (shift > 0) {
      for (const c of comps.slice(i)) for (const b of c) { b.dz += shift; b.cellRects = b.cellRects.map((r) => [r[0], r[1] + shift, r[2], r[3] + shift]); }
      need -= shift;
    }
  }
  if (need > 0) problems.push(`The house is ${need} stud${need === 1 ? '' : 's'} too deep for the baseplate at ${ftPerStud} ft per stud, even with the yard behind it pulled in. Check the block rectangles and the scale.`);
  const allRects = blocks.flatMap((b) => b.cellRects);
  const bx0 = Math.min(...allRects.map((r) => r[0])), bx1 = Math.max(...allRects.map((r) => r[2]));
  const bz0 = Math.min(...allRects.map((r) => r[1])), bz1 = Math.max(...allRects.map((r) => r[3]));
  if (bx1 - bx0 + 1 > size) problems.push(`The house is ${bx1 - bx0 + 1 - size} studs too wide for the baseplate at ${ftPerStud} ft per stud.`);
  // A corner lot's second street: keep streetRows columns free on its side instead of centering.
  let side = null;
  if (fp.sideStreet && ROT[fp.sideStreet] && fp.sideStreet !== street) {
    const v = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[fp.sideStreet], [X, Y] = rot(v);
    side = X < 0 ? 'left' : X > 0 ? 'right' : Y < 0 ? 'back' : null;
    if (side === 'back') problems.push('The side street faces the back of the lot; only a street on the left or right can be laid out. Left out.');
  }
  const width = bx1 - bx0 + 1;
  // front yard rows between the house and the sidewalk, as many as fit up to frontYard
  const yard = Math.max(0, Math.min(frontYard, avail - (bz1 - bz0 + 1)));
  if ((side === 'left' || side === 'right') && width + streetRows > size) {
    problems.push(`There is no room for the side street's ${streetRows} rows beside the house at ${ftPerStud} ft per stud; the house is centered and the side street is left out.`);
    side = null;
  }
  const offX = (side === 'left' ? streetRows : side === 'right' ? size - streetRows - width : Math.floor((size - width) / 2)) - bx0, offZ = avail - 1 - yard - bz1;
  for (const b of blocks) b.cellRects = b.cellRects.map((r) => [r[0] + offX, r[1] + offZ, r[2] + offX, r[3] + offZ]);

  // Each wall cell belongs to one block: the first listed (tallest) wins, and a later block's
  // outline inside an earlier block is dropped.
  const claimed = new Map(), insideEarlier = [];
  for (const b of blocks) {
    const o = outline(b.cellRects);
    b.cells = o.cells.filter(([x, z]) => !claimed.has(key(x, z)) && !insideEarlier.some((s) => s.has(key(x, z))));
    for (const [x, z] of b.cells) claimed.set(key(x, z), b.name);
    insideEarlier.push(o.inside);
    b.openings = [];
  }

  const place = (px, b) => {
    const [X, Y] = rot(px), [sx, sz] = toS(X, Y);
    return [sx + offX, sz + b.dz + offZ];
  };
  for (const o of fp.openings || []) {
    const b = blocks.find((x) => x.name === o.block);
    if (!b) { problems.push(`Opening "${o.kind}" names block "${o.block}", which isn't in the blocks list.`); continue; }
    if (!Array.isArray(o.atPx) || o.atPx.length !== 2) { problems.push(`The ${o.kind} on ${o.block} needs atPx [x, y].`); continue; }
    const [sx, sz] = place(o.atPx, b);
    let best = null;
    for (const r of b.cellRects) {
      for (const [side, fixed, lo, hi, along, across] of [['N', r[1], r[0], r[2], sx, sz], ['S', r[3], r[0], r[2], sx, sz], ['W', r[0], r[1], r[3], sz, sx], ['E', r[2], r[1], r[3], sz, sx]]) {
        const d = Math.hypot(across - fixed, Math.max(0, lo - along, along - hi));
        if (!best || d < best.d) best = { side, fixed, lo, hi, along, d };
      }
    }
    const w = Math.max(1, Math.round((o.widthFt || 3) / ftPerStud));
    let start = Math.round(best.along - (w - 1) / 2);
    start = Math.min(Math.max(start, best.lo + 1), best.hi - w);
    if (best.hi - best.lo - 1 < w) { problems.push(`The ${o.kind} on ${b.name} is wider than the wall it sits on.`); continue; }
    if (best.d > 2) problems.push(`The ${o.kind} at [${o.atPx.map(Math.round)}] is ${best.d.toFixed(1)} studs from the nearest wall of ${b.name}; put atPx on the wall line.`);
    const horiz = best.side === 'N' || best.side === 'S';
    const cells = horiz ? [start, best.fixed, start + w - 1, best.fixed] : [best.fixed, start, best.fixed, start + w - 1];
    const owner = new Set(lineCells(cells).map(([x, z]) => claimed.get(key(x, z))));
    if (owner.size !== 1 || owner.has(undefined)) { problems.push(`The ${o.kind} on ${b.name}'s ${best.side} wall falls where walls of different blocks meet; move atPx along the wall.`); continue; }
    const target = blocks.find((x) => x.name === [...owner][0]);
    target.openings.push({ kind: o.kind, side: best.side, cells, ...(o.note ? { note: o.note } : {}) });
  }

  const stairs = (fp.stairs || []).filter((s) => Array.isArray(s.rectPx) && s.rectPx.length === 4).map((s) => {
    const r = rotRect(s.rectPx), [x0, z0] = toS(r[0], r[1]), [x1, z1] = toS(r[2], r[3]);
    return { name: s.name || 'Stairs', rect: [Math.round(x0) + offX, Math.round(z0) + offZ, Math.round(x1) + offX, Math.round(z1) + offZ] };
  });

  // Plan pixel to stud for the front part (the one not pulled forward), for drawing overlays.
  const map = { a: R[0][0] / pps, c: R[0][1] / pps, e: -minX / pps + offX + 0.5, b: R[1][0] / pps, d: R[1][1] / pps, f: -minY / pps + offZ + 0.5 };
  for (const b of blocks) if (!b.cells.length) problems.push(`Block ${b.name} has no walls of its own; it sits inside an earlier block.`);
  return {
    scale: { pxPerFt: Number(cal.pxPerFt.toFixed(3)), ftPerStud, rooms: cal.rooms.map((r) => ({ name: r.name, pxPerFt: Number(r.pxPerFt.toFixed(2)) })) },
    street,
    blocks: blocks.map((b) => ({ name: b.name, levels: b.levels, cellRects: b.cellRects, cells: b.cells, openings: b.openings, pulledForward: b.dz })),
    stairs, map, problems, source: 'plan', size,
    sideStreet: side === 'left' || side === 'right' ? { planSide: fp.sideStreet, side, columns: side === 'left' ? [0, streetRows - 1] : [size - streetRows, size - 1] } : null,
  };
}

// Footprint from building outlines (open data), for houses without a floor plan. Polygons are in
// local metres (east, north); toStreet points from the house toward the street that goes at z = 31,
// sideStreet (optional) toward a corner lot's second street. The outline's walls are squared to the
// stud grid (turned by its dominant edge direction), rasterized with walls on the outline's edges,
// and laid out like a plan: same blocks, fitting and locking, but no doors (those come from photos).
function footprintFromOutline({ buildings, toStreet, sideStreet = null, ftPerStud = 2, size = 32, streetRows = 2, frontYard = 0 }) {
  const main = buildings[0];
  // dominant wall direction, from edge lengths (angles folded to a quarter turn)
  let sx = 0, sy = 0;
  main.polygon.forEach((p, i) => { const q = main.polygon[(i + 1) % main.polygon.length], dx = q[0] - p[0], dy = q[1] - p[1];
    const len = Math.hypot(dx, dy), a = Math.atan2(dy, dx) * 4; sx += len * Math.cos(a); sy += len * Math.sin(a); });
  const theta = Math.atan2(sy, sx) / 4;
  const axes = [0, 1, 2, 3].map((k) => [Math.cos(theta + k * Math.PI / 2), Math.sin(theta + k * Math.PI / 2)]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const zAxis = axes.reduce((best, a) => (dot(a, toStreet) > dot(best, toStreet) ? a : best)); // toward the street
  const xAxis = [-zAxis[1], zAxis[0]]; // right as seen from the street, facing the house
  const m = ftPerStud * 0.3048;
  const toCells = (poly) => poly.map((p) => [dot(p, xAxis) / m, dot(p, zAxis) / m]);
  const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
  const nearEdge = (pt, poly) => poly.some((a, i) => { const b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a[0] + t * dx - pt[0], a[1] + t * dy - pt[1]) <= 0.5; });
  // cells whose centre is inside the outline or within half a stud of it; then rectangles covering them
  const rectsFor = (poly) => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]), cells = new Set();
    for (let x = Math.floor(Math.min(...xs)) - 1; x <= Math.ceil(Math.max(...xs)) + 1; x++) for (let z = Math.floor(Math.min(...zs)) - 1; z <= Math.ceil(Math.max(...zs)) + 1; z++) {
      const c = [x, z]; if (inside(c, poly) || nearEdge(c, poly)) cells.add(x + ',' + z); }
    const rects = [], used = new Set();
    const sorted = [...cells].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [x, z] of sorted) {
      if (used.has(x + ',' + z)) continue;
      let x1 = x; while (cells.has((x1 + 1) + ',' + z) && !used.has((x1 + 1) + ',' + z)) x1++;
      let z1 = z; for (;;) { let ok = true; for (let i = x; i <= x1 && ok; i++) if (!cells.has(i + ',' + (z1 + 1)) || used.has(i + ',' + (z1 + 1))) ok = false; if (!ok) break; z1++; }
      for (let i = x; i <= x1; i++) for (let j = z; j <= z1; j++) used.add(i + ',' + j);
      rects.push([x, z, x1, z1]);
    }
    return rects;
  };
  // feed the layout as a plan in feet with the street at the bottom: 1 unit = 1 ft
  const blocks = buildings.map((b) => ({ name: b.name, levels: b.levels || 1,
    rectsPx: rectsFor(toCells(b.polygon)).map((r) => r.map((v) => v * ftPerStud)) }));
  let side = null;
  if (sideStreet) { const sxv = dot(sideStreet, xAxis), szv = dot(sideStreet, zAxis); if (Math.abs(sxv) > Math.abs(szv)) side = sxv < 0 ? 'W' : 'E'; }
  const L = layoutFootprint({ street: 'S', sideStreet: side, rooms: [{ name: 'scale', label: '10 x 10', rectPx: [0, 0, 10, 10] }, { name: 'scale', label: '10 x 10', rectPx: [0, 0, 10, 10] }],
    blocks, openings: [], stairs: [] }, { ftPerStud, size, streetRows, frontYard });
  L.source = 'outline';
  delete L.map; // no plan image to lay it over
  return L;
}

// Walls ops for the locked footprint: one per block, heights and fills as defaults for Claude to set.
// Courses per story: about 9 ft at the layout's scale (4 at 2 ft per stud, 5 at 1.5).
const storyCourses = (locked) => Math.max(3, Math.round(9 / (1.2 * ((locked.scale && locked.scale.ftPerStud) || 2))));
function skeletonOps(locked) {
  return locked.blocks.filter((b) => b.cells.length).map((b) => ({
    op: 'walls', phase: b.name, block: b.name, color: 'White', courses: [0, storyCourses(locked) * b.levels - 1], base: 0,
    segments: segmentsFromCells(b.cells),
    openings: b.openings.map((o) => ({ cells: o.cells, ...(DEFAULT_FILL[o.kind] || DEFAULT_FILL.door), kind: o.kind === 'garage door' ? 'garage door' : 'door', note: `${o.kind} from the floor plan${o.note ? ': ' + o.note : ''}` })),
  }));
}

const cellKeys = (segs) => new Set((segs || []).flatMap((s) => lineCells(s)).map(([x, z]) => key(x, z)));
const listCells = (keys) => [...keys].slice(0, 6).map((k) => `(${k})`).join(' ') + (keys.length > 6 ? ` and ${keys.length - 6} more` : '');

// Problems where a design's walls leave the locked footprint. Every walls op tagged with a block must
// cover exactly that block's cells, and each locked opening must keep its cells (any courses or fill).
function checkFootprint(design, locked) {
  if (!locked) return [];
  const probs = [], ops = (design.ops || []).map((o, i) => ({ o, i })).filter(({ o }) => o.op === 'walls');
  for (const b of locked.blocks) {
    if (!b.cells.length) continue;
    const mine = ops.filter(({ o }) => o.block === b.name);
    if (!mine.length) { probs.push(`Floor plan: no walls op has "block": "${b.name}". Keep the locked walls for it.`); continue; }
    const want = new Set(b.cells.map(([x, z]) => key(x, z)));
    for (const { o, i } of mine) {
      let have;
      try { have = cellKeys(o.segments); } catch { have = new Set(); }
      const missing = [...want].filter((k) => !have.has(k)), extra = [...have].filter((k) => !want.has(k));
      if (missing.length || extra.length) {
        probs.push(`Floor plan (op ${i}): the ${b.name} walls must keep the locked segments; ${[missing.length ? `missing ${listCells(missing)}` : '', extra.length ? `off the plan at ${listCells(extra)}` : ''].filter(Boolean).join(', ')}.`);
      }
    }
    for (const lo of b.openings) {
      const want2 = [...cellKeys([lo.cells])].sort().join(' ');
      const ok = mine.some(({ o }) => (o.openings || []).some((p) => { try { return [...cellKeys([p.cells])].sort().join(' ') === want2; } catch { return false; } }));
      if (!ok) probs.push(`Floor plan: the ${lo.kind} on the ${b.name} ${lo.side} wall must stay at cells [${lo.cells.join(', ')}] (set its courses and fill as you like).`);
    }
  }
  return probs;
}

// Short text for Claude: the scale, where each block and door landed, and what to fix.
function describeLayout(locked) {
  return JSON.stringify({
    scale: locked.scale, street: locked.street,
    blocks: locked.blocks.map((b) => ({ name: b.name, levels: b.levels, studRects: b.cellRects, wallCells: b.cells.length, pulledForward: b.pulledForward || undefined,
      openings: b.openings.map((o) => `${o.kind} on the ${o.side} wall at cells [${o.cells.join(', ')}]`) })),
    stairs: locked.stairs, sideStreet: locked.sideStreet || undefined, problems: locked.problems,
  });
}

module.exports = { layoutFootprint, footprintFromOutline, skeletonOps, checkFootprint, describeLayout, calibrate, segmentsFromCells, outline };
