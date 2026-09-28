// Engine regression tests. Piece counts are snapshots: update them when a design changes on purpose.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compile } = require('../src/engine/engine.js');

const load = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '../designs', name + '.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
// warnings other than the bare-floor one, for small test houses built without a floor
const roofWarnings = (r) => r.warnings.map((w) => w.msg).filter((m) => !/baseplate shows/.test(m));

for (const [name, pieces] of [['savannah-dr', 1249], ['634-unit-a', 804]]) {
  test(`${name} compiles clean`, () => {
    const r = compile(load(name));
    assert.deepEqual(r.errors.map((e) => e.msg), []);
    assert.deepEqual(r.warnings.map((e) => e.msg), []);
    assert.equal(r.stats.pieces, pieces);
    assert.ok(r.steps.length > 50);
  });
}

test('removing the porch columns leaves the arch unsupported', () => {
  const d = load('savannah-dr');
  d.ops = d.ops.filter((o) => o.note !== 'Porch columns');
  const r = compile(d);
  assert.ok(r.errors.some((e) => /Arch 1 x 4 x 2 .* nothing to hold on to/.test(e.msg)));
});

test('a sub-build placed on paving collides and does not attach', () => {
  const d = load('634-unit-a');
  d.ops.find((o) => o.op === 'sub' && o.name === 'Cactus').copies = [[20, 0, 26]];
  const r = compile(d);
  assert.ok(r.errors.some((e) => /collides with tile/.test(e.msg)));
  assert.ok(r.errors.some((e) => /Cactus 1 doesn't attach/.test(e.msg)));
});

test('a floating sub-build is reported', () => {
  const d = load('savannah-dr');
  d.ops.find((o) => o.name === 'Palm tree').copies[0] = [12, 5, 26];
  const r = compile(d);
  assert.ok(r.errors.some((e) => /Palm tree 1 doesn't attach/.test(e.msg)));
});

test('a window that does not fit its opening is an error', () => {
  const d = load('634-unit-a');
  const walls = d.ops.find((o) => o.op === 'walls' && o.note === 'Ground floor and front gable wing');
  walls.openings.find((o) => o.note === 'Arched window').courses = [0, 1];
  const r = compile(d);
  assert.ok(r.errors.some((e) => /doesn't fit/.test(e.msg)));
});

test('unknown phases and parts are reported, not thrown', () => {
  const d = clone(load('634-unit-a'));
  d.ops.push({ op: 'place', phase: 'Nope', part: 'brick:1x2', color: 'Red', at: [0, 0, 0] });
  d.ops.push({ op: 'place', phase: d.phases[0], part: 'brick:5x5', color: 'Red', at: [0, 0, 0] });
  const r = compile(d);
  assert.ok(r.errors.some((e) => /isn't in the phase list/.test(e.msg)));
  assert.ok(r.errors.some((e) => /no brick in size 5x5/i.test(e.msg)));
});

test('every part joins the baseplate through stud joints', () => {
  const r = compile(load('634-unit-a'));
  assert.ok(r.stats.joints > r.parts.length);
  assert.ok(r.parts.every((p) => p.mainStep !== undefined));
});

test('seam repair never merges tiles into a length tiles do not come in', () => {
  // Three 1x1 plates in two courses leave seams at both joints, so any split of the tile course above
  // lines up with them; the repair used to merge 1x2 + 1x1 into a 1x3 tile, which doesn't exist.
  const fill = (kind, color, x, y) => ({ op: 'fill', phase: 'p', kind, color, rects: [[x, 0, x, 0]], y });
  const ops = [...[0, 1].flatMap((y) => ['Red', 'Blue', 'Yellow'].map((c, x) => fill('plate', c, x, y))),
    { op: 'fill', phase: 'p', kind: 'tile', color: 'White', rects: [[0, 0, 2, 0]], y: 2 }];
  const r = compile({ name: 't', phases: ['p'], ops });
  assert.deepEqual(r.errors.map((e) => e.msg), []);
});

// An L-shaped house: a 17 x 9 main block with a 9 x 11 wing off its south-west corner.
const lWalls = { op: 'walls', phase: 'Walls', color: 'White', courses: [0, 3], base: 0,
  segments: [[4, 6, 20, 6], [4, 7, 4, 24], [5, 24, 12, 24], [12, 14, 12, 23], [13, 14, 20, 14], [20, 7, 20, 13]] };
const lHouse = (roofs) => ({ name: 'L', phases: ['Walls', 'Roof'], ops: [lWalls, ...roofs.map((r) => ({ op: 'roof', phase: 'Roof', base: 12, color: 'Dark Orange', ...r }))] });

test('one roof over an L-shaped union meets itself with a valley, and matches a plain hip on one rectangle', () => {
  const union = compile(lHouse([{ rects: [[4, 6, 20, 14], [4, 14, 12, 24]] }]));
  assert.deepEqual([union.errors.length, roofWarnings(union).length], [0, 0]);
  const box = { op: 'walls', phase: 'Walls', color: 'White', courses: [0, 3], base: 0, segments: [[4, 6, 20, 6], [4, 7, 4, 14], [20, 7, 20, 14], [5, 14, 19, 14]] };
  const one = (roof) => compile({ name: 'b', phases: ['Walls', 'Roof'], ops: [box, { op: 'roof', phase: 'Roof', base: 12, color: 'Dark Orange', ...roof }] }).stats.pieces;
  assert.equal(one({ rects: [[4, 6, 20, 14]] }), one({ rect: [4, 6, 20, 14] }));
});

test('two hips abutting each other leave a stepped edge showing, and the compiler says so', () => {
  const r = compile(lHouse([{ rect: [4, 6, 20, 14] }, { rect: [4, 15, 12, 24], abut: ['N'] }]));
  assert.match(r.warnings.map((w) => w.msg).join(' '), /Roof abuts on its N side, but the roof's stepped edge shows/);
});

test('a roof leaning on a taller building rises into its wall there and has an eave elsewhere', () => {
  const tower = { op: 'walls', phase: 'Walls', color: 'White', courses: [0, 7], base: 0, segments: [[12, 2, 20, 2], [12, 3, 12, 10], [20, 3, 20, 10], [13, 10, 19, 10]] };
  const shed = { op: 'walls', phase: 'Walls', color: 'White', courses: [0, 3], base: 0, segments: [[4, 4, 11, 4], [4, 5, 4, 14], [5, 14, 11, 14], [11, 5, 11, 13]] };
  const lean = (height) => compile({ name: 'lean', phases: ['Walls', 'Roof'], ops: [{ ...tower, courses: [0, height] }, shed,
    { op: 'roof', phase: 'Roof', base: 12, color: 'Dark Orange', rects: [[4, 4, 11, 14]], against: [[12, 2, 20, 10]] }] });
  const tall = lean(7);
  assert.deepEqual([tall.errors.length, roofWarnings(tall)], [0, []]);
  // Past the tower (z 11 to 14) the roof has an eave: a plate sits one stud outside the shed's east wall.
  assert.ok(tall.parts.some((p) => p.kind === 'plate' && p.y === 12 && p.x <= 12 && p.x + p.w > 12 && p.z <= 13 && p.z + p.d > 13));
  // A tower no taller than the shed leaves the leaning edge showing.
  assert.match(lean(3).warnings.map((w) => w.msg).join(' '), /Roof leans on another building, but/);
});

test('every plant in the library stands on its own, and an unknown kind is named', () => {
  const { PLANTS } = require('../src/engine/engine.js');
  for (const kind of Object.keys(PLANTS)) {
    const r = compile({ name: kind, phases: ['p'], ops: [{ op: 'plant', phase: 'p', kind, at: [[10, 0, 10], [20, 0, 20]], bloom: 'Red' }] });
    assert.deepEqual([kind, r.errors.length, r.warnings.length, r.subs[0].copies], [kind, 0, 0, 2]);
  }
  const bad = compile({ name: 'x', phases: ['p'], ops: [{ op: 'plant', phase: 'p', kind: 'baobab', at: [[5, 0, 5]] }] });
  assert.match(bad.errors[0].msg, /Unknown plant "baobab"; the library has olive tree, yucca/);
});

test('wall details hang on side-stud bricks set in the wall, and need them', () => {
  const walls = { op: 'walls', phase: 'W', color: 'White', courses: [0, 3], base: 0, segments: [[4, 10, 14, 10], [4, 11, 4, 16], [14, 11, 14, 16], [5, 16, 13, 16]],
    openings: [{ cells: [6, 16, 6, 16], courses: [2, 2], fill: { part: 'snot', face: 'S' } }, { cells: [10, 16, 11, 16], courses: [3, 3], fill: { part: 'snot', face: 'S' } }] };
  const d = (details) => ({ name: 'd', phases: ['W', 'D'], ops: [walls, ...details.map((x) => ({ op: 'detail', phase: 'D', ...x }))] });
  const ok = compile(d([{ kind: 'lantern', at: [[6, 6, 16]] }, { kind: 'house number', at: [[10, 9, 16]] }]));
  assert.deepEqual([ok.errors, roofWarnings(ok)], [[], []]);
  const mounted = ok.parts.filter((p) => p.mount);
  assert.deepEqual(mounted.map((p) => [p.name, p.z]), [['Bracket 1 x 1 - 1 x 1', 17], ['Tile 1 x 2 (on side studs)', 17]]);
  // only the bracket hangs on the side stud; the lamp stands on the bracket's stud, and its cap on the cone
  const lamp = ok.parts.filter((p) => p.x === 6 && p.z === 17).sort((a, b) => a.y - b.y);
  assert.deepEqual(lamp.map((p) => [p.name, p.y]), [['Bracket 1 x 1 - 1 x 1', 6], ['Cone 1 x 1', 7], ['Plate round 1 x 1', 10]]);
  assert.ok(ok.joints.some(([a, b]) => a === lamp[1].id && b === lamp[0].id), 'the cone is held by the bracket stud');
  assert.equal(ok.inventory.filter((l) => l.no === '87087').reduce((a, l) => a + l.q, 0), 3);
  assert.match(compile(d([{ kind: 'lantern', at: [[8, 6, 16]] }])).errors[0].msg, /No side-stud brick at \(8, 6, 16\)/);
  assert.match(compile(d([{ kind: 'house number', at: [[6, 6, 16]] }])).errors[0].msg, /two side-stud bricks side by side/);
});

test('a door must meet the ground in front of it, and a garage door needs a drive to the edge of the plate', () => {
  // A 6 x 5 garage on the baseplate, its door on the south wall, and a raised terrace (9 plates) in some variants.
  const garage = (door, extra = []) => ({ name: 'g', phases: ['a'], ops: [
    { op: 'walls', phase: 'a', color: 'White', courses: [0, 5], base: 0, segments: [[10, 10, 15, 10], [10, 14, 15, 14], [10, 10, 10, 14], [15, 10, 15, 14]],
      openings: [{ cells: [11, 14, 14, 14], courses: door, fill: { color: 'Black' }, kind: 'garage door' }] }, ...extra] });
  const msgs = (d) => compile(d).warnings.map((w) => w.msg).filter((m) => /door/.test(m)).join(' ');
  assert.equal(msgs(garage([0, 2])), '', 'at ground level with open ground to the street');
  const terrace = (y) => ({ op: 'fill', phase: 'a', kind: 'brick', color: 'Tan', rects: [[5, 15, 25, 18]], y });
  const walled = [terrace(0), terrace(3), terrace(6)];
  assert.match(msgs(garage([0, 2], walled)), /garage door at \(11, 14\) starts at height 0, but the ground in front of it is at 9/);
  assert.match(msgs(garage([3, 5], walled)), /garage door at \(11, 14\) has no drive to a street/, 'level with a terrace that ends in a drop');
  assert.match(msgs(garage([2, 4])), /garage door at \(11, 14\) starts at height 6, 6 plates above the ground/);
  const fence = (line) => ({ op: 'fence', phase: 'a', color: 'Black', line, y: 0 });
  const ring = [fence([4, 4, 19, 4]), fence([4, 21, 19, 21]), fence([4, 5, 4, 20]), fence([19, 5, 19, 20])];
  assert.match(msgs(garage([0, 2], ring)), /no drive/, 'fenced in all round');
  const door = garage([1, 3]); door.ops[0].openings[0].kind = 'door';
  assert.equal(msgs(door), '', 'a person door one step up is fine');
  door.ops[0].openings[0].kind = 'window';
  assert.match(compile(door).errors.map((e) => e.msg).join(' '), /Opening kind "window"/);
});

test('the baseplate may not show inside a building, and a floor op tiles exactly the inside', () => {
  const walls = { op: 'walls', phase: 'a', color: 'White', courses: [0, 3], base: 0, segments: [[10, 10, 17, 10], [10, 15, 17, 15], [10, 11, 10, 14], [17, 11, 17, 14]] };
  const bare = compile({ name: 'b', phases: ['a'], ops: [walls] });
  assert.match(bare.warnings.map((w) => w.msg).join(' '), /baseplate shows inside a building at 24 studs/);
  const floored = compile({ name: 'f', phases: ['a'], ops: [walls, { op: 'floor', phase: 'a', color: 'Tan' }] });
  assert.doesNotMatch(floored.warnings.map((w) => w.msg).join(' '), /baseplate shows/);
  const tiles = floored.parts.filter((p) => p.op === 1);
  assert.equal(tiles.reduce((a, p) => a + p.w * p.d, 0), 24);
  assert.ok(tiles.every((p) => p.x >= 11 && p.x + p.w <= 17 && p.z >= 11 && p.z + p.d <= 15 && p.y === 0));
  // a low garden wall is not a building: nothing inside it is flagged
  const garden = compile({ name: 'g', phases: ['a'], ops: [{ ...walls, courses: [0, 1] }] });
  assert.doesNotMatch(garden.warnings.map((w) => w.msg).join(' '), /baseplate shows/);
});

test('a lift-off roof must hold together, rest on the walls and carry nothing else', () => {
  const seg = [[5, 5, 12, 5], [5, 10, 12, 10], [5, 6, 5, 9], [12, 6, 12, 9]];
  const base = [{ op: 'walls', phase: 'a', color: 'White', courses: [0, 3], base: 0, segments: seg }, { op: 'floor', phase: 'a', color: 'Tan' }];
  const roof = { op: 'roof', phase: 'b', rect: [5, 5, 12, 10], base: 12, color: 'Dark Orange', liftoff: 'Main roof' };
  const d = (extra = []) => ({ name: 'l', phases: ['a', 'b'], ops: [...base, roof, ...extra] });
  const ok = compile(d());
  assert.deepEqual(ok.errors.map((e) => e.msg), []);
  assert.deepEqual(ok.stats.liftoff, ['Main roof']);
  assert.ok(ok.parts.filter((p) => p.op === 2).every((p) => p.liftoff === 'Main roof'));
  // one layer of deck plates only holds together through the walls under it, so it comes apart when lifted
  const deck = { op: 'fill', phase: 'b', kind: 'plate', color: 'White', rects: [[5, 5, 12, 10]], y: 12, liftoff: 'Flat' };
  const flat = (extra) => compile({ name: 'f', phases: ['a', 'b'], ops: [...base, deck, ...extra] }).errors.map((e) => e.msg);
  assert.match(flat([]).join(' '), /Lift-off roof "Flat" comes apart into \d+ pieces/);
  // a tile layer on top crosses the plates' seams and ties it into one piece
  const tiles = { op: 'fill', phase: 'b', kind: 'tile', color: 'Light Bluish Gray', rects: [[5, 5, 12, 10]], y: 13, liftoff: 'Flat' };
  assert.deepEqual(flat([tiles]), []);
  // a brick standing on the deck but not part of the roof stops it lifting
  const stuck = flat([{ op: 'place', phase: 'b', part: 'brick:1x1', color: 'Red', at: [8, 13, 7] }, { ...tiles, rects: [[5, 5, 7, 10], [9, 5, 12, 10], [8, 5, 8, 6], [8, 8, 8, 10]] }]);
  assert.match(stuck.join(' '), /sits on lift-off roof "Flat" but isn't part of it/);
});

test('seams are compared at the same height, not the same course number of different walls ops', () => {
  // A lower wall (courses 0-3 from height 0) and a shorter upper wall (courses 0-3 from height 12) on
  // the same line: their course numbers match but their heights don't, so nothing lines up.
  const d = { name: 's', phases: ['a'], ops: [
    { op: 'walls', phase: 'a', color: 'White', courses: [0, 3], base: 0, segments: [[0, 5, 7, 5]] },
    { op: 'walls', phase: 'a', color: 'White', courses: [0, 3], base: 12, segments: [[0, 5, 3, 5]] }] };
  const r = compile(d);
  assert.deepEqual(r.errors.map((e) => e.msg), []);
  assert.deepEqual(r.warnings.map((w) => w.msg).filter((m) => /seam/.test(m)), []);
});

test('a lift-off roof rests on tiled wall tops, located by corner studs, and is built on its own', () => {
  const seg = [[5, 5, 12, 5], [5, 10, 12, 10], [5, 6, 5, 9], [12, 6, 12, 9]];
  const corners = [[5, 5], [12, 5], [5, 10], [12, 10]];
  const ring = [[6, 5, 11, 5], [6, 10, 11, 10], [5, 6, 5, 9], [12, 6, 12, 9]]; // wall tops without the corners
  const house = [{ op: 'walls', phase: 'a', color: 'White', courses: [0, 3], base: 0, segments: seg }, { op: 'floor', phase: 'a', color: 'Tan' }];
  const roof = (y) => [{ op: 'fill', phase: 'b', kind: 'plate', color: 'White', rects: [[5, 5, 12, 10]], y, liftoff: 'Roof' },
    { op: 'fill', phase: 'b', kind: 'tile', color: 'Light Bluish Gray', rects: [[5, 5, 12, 10]], y: y + 1, liftoff: 'Roof' }];
  const seat = [{ op: 'places', phase: 'a', part: 'plate:1x1', color: 'White', y: 12, at: corners },
    { op: 'fill', phase: 'a', kind: 'tile', color: 'White', rects: ring, y: 12 }];
  const d = (ops) => compile({ name: 'l', phases: ['a', 'b'], ops });
  const seated = d([...house, ...seat, ...roof(13)]);
  assert.deepEqual(seated.errors.map((e) => e.msg), [], 'deck plates over the room need no studs below: the roof is built on its own');
  assert.deepEqual(seated.warnings.map((w) => w.msg), []);
  const sub = seated.subs.find((s) => s.name === 'Roof');
  assert.ok(sub && sub.liftoff);
  assert.ok(seated.steps.some((s) => s.kind === 'attach' && s.title === 'Place the roof'), 'the manual builds the roof, then places it');
  // pressed onto every wall-top stud, it grips far too many to lift off
  assert.match(d([...house, ...roof(12)]).warnings.map((w) => w.msg).join(' '), /Lift-off roof "Roof" grips the house with \d+ studs, too many/);
  // on tiles with no locating studs it isn't held at all
  const loose = d([...house, { op: 'fill', phase: 'a', kind: 'tile', color: 'White', rects: [...ring, ...corners.map(([x, z]) => [x, z, x, z])], y: 12 }, ...roof(13)]);
  assert.match(loose.errors.map((e) => e.msg).join(' '), /Lift-off roof "Roof" is held on by 0 studs/);
});

test('fixtures stand on their own, ride on a lift-off roof, and a big bare roof gets a hint', () => {
  const { FIXTURES } = require('../src/engine/engine.js');
  for (const kind of Object.keys(FIXTURES)) {
    const r = compile({ name: kind, phases: ['p'], ops: [{ op: 'fixture', phase: 'p', kind, at: [[10, 0, 10], [20, 0, 20]] }] });
    assert.deepEqual([kind, r.errors.length, r.warnings.length, r.subs[0].copies], [kind, 0, 0, 2]);
  }
  // a 20 x 20 seated flat roof: bare, it gets a hint; with a vent pipe and an HVAC unit on the deck it
  // still lifts off in one piece
  const seg = [[4, 4, 23, 4], [4, 23, 23, 23], [4, 5, 4, 22], [23, 5, 23, 22]];
  const corners = [[4, 4], [23, 4], [4, 23], [23, 23]];
  const ring = [[5, 4, 22, 4], [5, 23, 22, 23], [4, 5, 4, 22], [23, 5, 23, 22]];
  const base = [{ op: 'walls', phase: 'a', color: 'White', courses: [0, 3], base: 0, segments: seg },
    { op: 'places', phase: 'a', part: 'plate:1x1', color: 'White', y: 12, at: corners },
    { op: 'fill', phase: 'a', kind: 'tile', color: 'White', rects: ring, y: 12 },
    { op: 'fill', phase: 'b', kind: 'plate', color: 'White', rects: [[4, 4, 23, 23]], y: 13, liftoff: 'Roof' }];
  const tiles = { op: 'fill', phase: 'b', kind: 'tile', color: 'Light Bluish Gray', rects: [[4, 4, 23, 23]], y: 14, liftoff: 'Roof' };
  const floor = { op: 'floor', phase: 'a', color: 'Tan' };
  const bare = compile({ name: 'b', phases: ['a', 'b'], ops: [...base, tiles, floor] });
  assert.deepEqual([bare.errors.length, bare.warnings.length], [0, 0]);
  assert.match(bare.hints.map((h) => h.msg).join(' '), /Lift-off roof "Roof" has an open \d+ x \d+ stretch of plain tile/);
  const kitted = compile({ name: 'k', phases: ['a', 'b'], ops: [...base,
    { op: 'fixture', phase: 'b', kind: 'vent pipe', at: [[8, 14, 8]], liftoff: 'Roof' },
    { op: 'fixture', phase: 'b', kind: 'hvac unit', at: [[14, 14, 14]], liftoff: 'Roof' }, tiles, floor] });
  assert.deepEqual([kitted.errors.map((e) => e.msg), kitted.warnings.length], [[], 0]);
  assert.ok(kitted.parts.filter((p) => p.op === 5).every((p) => p.liftoff === 'Roof'), 'fixtures on the roof come off with it');
  // without the roof's liftoff the fixture pins the roof down
  const pinned = compile({ name: 'p', phases: ['a', 'b'], ops: [...base, { op: 'fixture', phase: 'b', kind: 'vent pipe', at: [[8, 14, 8]] }, tiles, floor] });
  assert.match(pinned.errors.map((e) => e.msg).join(' '), /sits on lift-off roof "Roof" but isn't part of it/);
});

test('a color mix recolors a few whole pieces and leaves the structure as it was', () => {
  const d = (mix) => ({ name: 'm', phases: ['a'], ops: [
    { op: 'walls', phase: 'a', color: 'White', courses: [0, 5], base: 0, segments: [[2, 2, 29, 2], [2, 29, 29, 29], [2, 3, 2, 28], [29, 3, 29, 28]], ...(mix ? { mix: [['Light Gray', 0.1]] } : {}) },
    { op: 'fill', phase: 'a', kind: 'tile', color: 'Tan', rects: [[4, 4, 27, 27]], ...(mix ? { mix: [['Dark Tan', 0.1]] } : {}) }] });
  const plain = compile(d(false)), mixed = compile(d(true));
  const shape = (r) => r.parts.map((p) => [p.name, p.x, p.y, p.z].join()).join('|');
  assert.equal(shape(mixed), shape(plain), 'same pieces in the same places');
  const share = (color) => mixed.parts.filter((p) => p.color === color).length / mixed.parts.length;
  assert.ok(share('Light Gray') + share('Dark Tan') > 0.03 && share('Light Gray') + share('Dark Tan') < 0.2);
  assert.match(compile({ name: 'x', phases: ['a'], ops: [{ ...d(true).ops[1], mix: [['Plaid', 0.1]] }] }).errors[0].msg, /"mix" must be/);
});

test('"seat" tiles a wall top with four locating studs, so a lift-off roof one plate up grips four studs', () => {
  const walls = (seat) => ({ op: 'walls', phase: 'a', color: 'White', courses: [0, 3], base: 0, segments: [[5, 5, 14, 5], [5, 12, 14, 12], [5, 6, 5, 11], [14, 6, 14, 11]], ...(seat ? { seat } : {}) });
  const roof = [{ op: 'fill', phase: 'b', kind: 'plate', color: 'White', rects: [[5, 5, 14, 12]], y: 13, liftoff: 'Roof' },
    { op: 'fill', phase: 'b', kind: 'tile', color: 'Light Bluish Gray', rects: [[5, 5, 14, 12]], y: 14, liftoff: 'Roof' }];
  const r = compile({ name: 's', phases: ['a', 'b'], ops: [walls(true), ...roof, { op: 'floor', phase: 'a', color: 'Tan' }] });
  assert.deepEqual([r.errors.map((e) => e.msg), r.warnings.map((w) => w.msg)], [[], []]);
  const studs = r.parts.filter((p) => p.y === 12 && p.kind === 'plate');
  assert.deepEqual(studs.map((p) => [p.x, p.z]).sort(), [[14, 12], [14, 5], [5, 12], [5, 5]].sort());
  assert.equal(r.joints.filter(([a, b]) => r.parts[a - 1].liftoff && b !== 'base' && !r.parts[b - 1].liftoff).length, 4);
  // a flat seat leaves no studs, so the roof has nothing to locate it
  const flat = compile({ name: 'f', phases: ['a', 'b'], ops: [walls('flat'), ...roof, { op: 'floor', phase: 'a', color: 'Tan' }] });
  assert.match(flat.errors.map((e) => e.msg).join(' '), /held on by 0 studs/);
});

test('a unit cut from its building: context stubs are exempt from room and door checks, and property is validated', () => {
  const unit = { op: 'walls', phase: 'a', color: 'White', courses: [0, 3], base: 0, segments: [[10, 10, 17, 10], [10, 16, 17, 16], [10, 11, 10, 15], [17, 11, 17, 15]] };
  const stub = { op: 'walls', phase: 'a', color: 'Light Bluish Gray', courses: [0, 3], base: 0, context: true, segments: [[18, 10, 19, 10], [18, 16, 19, 16], [19, 11, 19, 15]],
    openings: [{ cells: [19, 12, 19, 13], courses: [0, 2], fill: { color: 'Light Bluish Gray' }, kind: 'door' }] };
  const d = { name: 'u', property: 'townhouse', unit: 'B', phases: ['a'], ops: [unit, stub, { op: 'floor', phase: 'a', color: 'Tan' }] };
  const r = compile(d);
  assert.deepEqual(r.errors.map((e) => e.msg), []);
  assert.deepEqual(r.warnings.map((w) => w.msg).filter((m) => /baseplate shows|door/.test(m)), []);
  assert.ok(r.parts.filter((p) => p.op === 1).every((p) => p.context));
  assert.match(compile({ ...d, property: 'castle' }).errors[0].msg, /property must be one of house, townhouse, condo/);
});

test('a floor slab over a wide room is an assembly: built on its own, then walls stand on it', () => {
  const seg = [[2, 2, 27, 2], [2, 27, 27, 27], [2, 3, 2, 26], [27, 3, 27, 26]];
  const slab = (asm) => [
    { op: 'fill', phase: 's', kind: 'plate', color: 'White', rects: [[2, 2, 27, 27]], y: 12, ...(asm ? { assembly: 'Second floor' } : {}) },
    { op: 'fill', phase: 's', kind: 'plate', color: 'White', rects: [[2, 2, 27, 27]], y: 13, ...(asm ? { assembly: 'Second floor' } : {}) }];
  const d = (asm) => ({ name: 'a', phases: ['a', 's', 'b'], ops: [
    { op: 'walls', phase: 'a', color: 'White', courses: [0, 3], base: 0, segments: seg }, ...slab(asm),
    { op: 'walls', phase: 'b', color: 'White', courses: [5, 8], base: 14, segments: seg }, { op: 'floor', phase: 'a', color: 'Tan' }] });
  const plain = compile(d(false)), asm = compile(d(true));
  assert.match(plain.errors.map((e) => e.msg).join(' '), /has nothing to hold on to/, 'plates over a 24-stud room hang in mid-air');
  assert.deepEqual(asm.errors.map((e) => e.msg), []);
  assert.ok(asm.subs.some((s) => s.assembly && s.name === 'Second floor'));
  assert.ok(asm.steps.some((s) => s.kind === 'attach' && s.title === 'Place the second floor'));
});

test('a hip roof seated on tiles holds together: its eave reaches back over the wall', () => {
  const seg = [[6, 6, 18, 6], [6, 20, 18, 20], [6, 7, 6, 19], [18, 7, 18, 19]];
  const r = compile({ name: 'h', phases: ['a', 'b'], ops: [
    { op: 'walls', phase: 'a', color: 'White', courses: [0, 3], base: 0, segments: seg, seat: true },
    { op: 'roof', phase: 'b', rect: [6, 6, 18, 20], base: 13, color: 'Dark Orange', fascia: 'Dark Brown', liftoff: 'Roof' },
    { op: 'floor', phase: 'a', color: 'Tan' }] });
  assert.deepEqual(r.errors.map((e) => e.msg), []);
  assert.deepEqual(r.warnings.map((w) => w.msg), []);
});

test('seated lift-off roofs hold together across building sizes (flat 4 to 14 studs, hip 5 to 14)', () => {
  const broken = [];
  for (let W = 4; W <= 14; W++) for (let D = 4; D <= 14; D++) {
    const [x0, z0, x1, z1] = [4, 4, 4 + W - 1, 4 + D - 1];
    const walls = { op: 'walls', phase: 'a', color: 'White', courses: [0, 3], base: 0, seat: true, segments: [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0 + 1, x0, z1 - 1], [x1, z0 + 1, x1, z1 - 1]] };
    const flat = [{ op: 'fill', phase: 'b', kind: 'plate', color: 'White', rects: [[x0, z0, x1, z1]], y: 13, liftoff: 'R' },
      { op: 'fill', phase: 'b', kind: 'tile', color: 'Light Bluish Gray', rects: [[x0, z0, x1, z1]], y: 14, liftoff: 'R' }];
    const hip = [{ op: 'roof', phase: 'b', rect: [x0, z0, x1, z1], base: 13, color: 'Dark Orange', fascia: 'Dark Brown', liftoff: 'R' }];
    for (const [kind, roof] of [['flat', flat], ...(W > 4 && D > 4 ? [['hip', hip]] : [])]) {
      const r = compile({ name: 't', phases: ['a', 'b'], ops: [walls, ...roof, { op: 'floor', phase: 'a', color: 'Tan' }] });
      if (r.errors.length) broken.push(`${kind} ${W}x${D}: ${r.errors[0].msg.slice(0, 60)}`);
    }
  }
  assert.deepEqual(broken, []);
});
