// Engine regression tests. Piece counts are snapshots: update them when a design changes on purpose.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../src/engine/engine.js');
// most tests build a house alone on an empty plate, not a whole lot, so skip the bare-ground check
const compile = (d, ...a) => engine.compile({ lot: false, ...d }, ...a);

const load = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '../designs', name + '.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
// warnings other than the bare-floor one, for small test houses built without a floor
const roofWarnings = (r) => r.warnings.map((w) => w.msg).filter((m) => !/baseplate shows/.test(m));

test('634-unit-a-mini compiles clean on the Mini\'s 16 x 16 plate, and under GoBricks for about $15 of parts', () => {
  const d = load('634-unit-a-mini'), r = compile(d);
  assert.deepEqual(r.errors.map((e) => e.msg), []);
  assert.deepEqual(r.warnings.map((e) => e.msg), []);
  assert.equal(r.stats.pieces, 289);
  assert.deepEqual([r.stats.plate, r.stats.baseThick], [16, 1], 'an ordinary plate, a plate thick');
  const g = compile({ ...clone(d), supplier: 'gobricks' }), plate = g.inventory.find((e) => e.kind === 'baseplate');
  assert.deepEqual([g.errors, g.warnings], [[], []]);
  assert.deepEqual([plate.no, plate.color], ['91405', 'Green'], 'GoBricks makes the 16 x 16 plate in green');
  const G = engine.SUPPLY.gobricks, yuan = g.inventory.reduce((t, e) => t + e.q * G.made[e.no][e.color], 0);
  assert.ok(yuan / 3.5 < 20, `parts about $${(yuan / 3.5).toFixed(2)}`);
});

test('the Mini counts 2 courses as a story: its one-story walls enclose a floor', () => {
  const walls = { op: 'walls', phase: 'p', color: 'White', courses: [0, 1], base: 0, segments: [[2, 2, 7, 2], [2, 7, 7, 7], [2, 3, 2, 6], [7, 3, 7, 6]] };
  const floor = { op: 'floor', phase: 'p', kind: 'tile', color: 'Tan' };
  const mini = compile({ name: 'm', plate: 16, lot: false, phases: ['p'], ops: [walls, floor] });
  assert.deepEqual(mini.warnings.map((w) => w.msg), []);
  const classic = compile({ name: 'c', lot: false, phases: ['p'], ops: [walls, floor] });
  assert.match(classic.warnings.map((w) => w.msg).join(), /found no studs inside walls \(it floors what walls at least 4 courses tall enclose\)/);
  assert.match(compile({ name: 'x', plate: 24, phases: ['p'], ops: [] }).errors[0].msg, /plate must be 16, 32 or 48/);
});

for (const [name, pieces] of [['savannah-dr', 1266], ['634-unit-a', 826], ['griffith-park', 2358]]) {
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
    const r = compile({ name: kind, plate: 48, phases: ['p'], ops: [{ op: 'plant', phase: 'p', kind, at: [[10, 0, 10], [30, 0, 30]], bloom: 'Red' }] });
    assert.deepEqual([kind, r.errors.length, r.warnings.length, r.subs[0].copies], [kind, 0, 0, 2]);
  }
  const bad = compile({ name: 'x', phases: ['p'], ops: [{ op: 'plant', phase: 'p', kind: 'baobab', at: [[5, 0, 5]] }] });
  assert.match(bad.errors[0].msg, /Unknown plant "baobab"; the library has shade tree, jacaranda/);
  // plant leaves grip and carry studs where the real part has them (LDraw): a 4 x 3 branch pressed on at
  // its stem end reaches three studs out and carries five tip studs; turned a quarter it points +x
  const leaf = (rot) => compile({ name: 'l', phases: ['p'], ops: [{ op: 'place', phase: 'p', part: 'leaves43', at: [10, 0, 10], rot, color: 'Green' }] }).parts[0];
  assert.deepEqual([leaf(0).w, leaf(0).d, leaf(0).sockets, leaf(0).studs.length], [3, 4, [[11, 13]], 6]);
  assert.deepEqual([leaf(1).w, leaf(1).d, leaf(1).sockets], [4, 3, [[10, 11]]]);
});

test('trees are built like LEGO\'s: tall, with a deep layered canopy, and molded pines on their trunks', () => {
  const one = (kind) => compile({ name: kind, plate: 48, lot: false, phases: ['p'], ops: [{ op: 'plant', phase: 'p', kind, at: [[20, 0, 20]] }] });
  const top = (r) => Math.max(...r.parts.map((p) => p.y + p.h));
  // a two-story house is 24 plates; the big trees come close, the small one reaches a story and a half
  for (const kind of ['shade tree', 'jacaranda', 'olive tree', 'lemon tree', 'pine', 'cypress']) assert.ok(top(one(kind)) >= 19, `${kind} stands ${top(one(kind))} plates`);
  assert.ok(top(one('small tree')) >= 15);
  // the canopy is leaves turned a quarter each layer, lifted a plate apart by round plates, at least five layers deep
  const leaves = one('shade tree').parts.filter((p) => p.shape === 'leaves');
  assert.ok(leaves.length >= 5 && new Set(leaves.map((p) => p.rot)).size === 4 && new Set(leaves.map((p) => p.y)).size === leaves.length);
  // the large pine's 2 x 2 base presses onto the trunk's four studs, its branches a stud past it all round
  const pine = one('pine'), [trunk, tree] = pine.parts;
  assert.deepEqual([tree.no, tree.x, tree.z, tree.y, tree.w, tree.sockets.length, tree.studs.length], ['3471', 19, 19, trunk.y + trunk.h, 4, 4, 0]);
  assert.ok(pine.joints.some(([a, b]) => a === tree.id && b === trunk.id));
});

test('planting keeps to a few parts and colors, naming the plants that add the most', () => {
  const { PLANT_LOTS } = require('../src/engine/engine.js');
  const yard = (list) => compile({ name: 'y', plate: 48, lot: false, phases: ['p'],
    ops: list.map(([kind, bloom], i) => ({ op: 'plant', phase: 'p', kind, ...(bloom ? { bloom } : {}), at: [[8 + (i % 3) * 14, 0, 8 + Math.floor(i / 3) * 16]] })) });
  // a suburban yard: two trees, shrubs, a bed, one bloom color: within the limit
  const ok = yard([['shade tree'], ['small tree'], ['shrub'], ['boxwood'], ['flowering shrub', 'Red'], ['flower bed', 'Red']]);
  assert.deepEqual([ok.warnings, ok.stats.plantLots <= PLANT_LOTS], [[], true]);
  // a bit of everything is too many
  const all = yard([['shade tree'], ['olive tree'], ['yucca'], ['agave'], ['columnar cactus'], ['shrub'], ['flowering shrub', 'Red'], ['grasses'], ['lavender']]);
  assert.ok(all.stats.plantLots > PLANT_LOTS);
  assert.match(all.warnings.map((w) => w.msg).join(' '), new RegExp(`The planting uses ${all.stats.plantLots} different parts and colors, more than ${PLANT_LOTS}: .*\\(olive tree adds \\d+, shade tree adds \\d+`));
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

test('a lattice fence has a smooth top: a second fence stacked on it holds on to nothing', () => {
  const run = (y) => ({ op: 'fence', phase: 'a', color: 'Black', line: [4, 4, 7, 4], y });
  const stacked = compile({ name: 't', lot: false, phases: ['a'], ops: [run(0), run(3)] });
  assert.ok(stacked.errors.some((e) => /Fence 1 x 4 x 1 .* nothing to hold on to/.test(e.msg)), stacked.errors.map((e) => e.msg).join('; '));
  const onBase = compile({ name: 't', lot: false, phases: ['a'], ops: [{ op: 'fill', phase: 'a', kind: 'brick', color: 'Black', y: 0, rects: [[4, 4, 7, 4]] }, run(3)] });
  assert.equal(onBase.errors.length, 0, onBase.errors.map((e) => e.msg).join('; '));
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
  assert.match(flat([]).join(' '), /Lift-off "Flat" comes apart into \d+ pieces/);
  // a tile layer on top crosses the plates' seams and ties it into one piece
  const tiles = { op: 'fill', phase: 'b', kind: 'tile', color: 'Light Bluish Gray', rects: [[5, 5, 12, 10]], y: 13, liftoff: 'Flat' };
  assert.deepEqual(flat([tiles]), []);
  // a brick standing on the deck but not part of the roof stops it lifting
  const stuck = flat([{ op: 'place', phase: 'b', part: 'brick:1x1', color: 'Red', at: [8, 13, 7] }, { ...tiles, rects: [[5, 5, 7, 10], [9, 5, 12, 10], [8, 5, 8, 6], [8, 8, 8, 10]] }]);
  assert.match(stuck.join(' '), /sits on lift-off "Flat" but isn't part of it/);
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
  assert.match(d([...house, ...roof(12)]).warnings.map((w) => w.msg).join(' '), /Lift-off "Roof" grips what.s below with \d+ studs, too many/);
  // on tiles with no locating studs it isn't held at all
  const loose = d([...house, { op: 'fill', phase: 'a', kind: 'tile', color: 'White', rects: [...ring, ...corners.map(([x, z]) => [x, z, x, z])], y: 12 }, ...roof(13)]);
  assert.match(loose.errors.map((e) => e.msg).join(' '), /Lift-off "Roof" is held on by 0 studs/);
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
  assert.match(pinned.errors.map((e) => e.msg).join(' '), /sits on lift-off "Roof" but isn't part of it/);
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

test('each story lifts off the one below, top first, and subtle variation recolors a few pieces by default', () => {
  const seg = [[6, 6, 17, 6], [6, 15, 17, 15], [6, 7, 6, 14], [17, 7, 17, 14]];
  const d = (variation) => ({ name: 'two', variation, phases: ['g', 's', 'r'], ops: [
    { op: 'walls', phase: 'g', color: 'White', courses: [0, 3], base: 0, segments: seg, seat: true },
    { op: 'fill', phase: 's', kind: 'plate', color: 'White', rects: [[6, 6, 17, 15]], y: 13, liftoff: 'Second floor' },
    { op: 'fill', phase: 's', kind: 'plate', color: 'Tan', rects: [[6, 6, 17, 15]], y: 14, liftoff: 'Second floor' },
    { op: 'walls', phase: 's', color: 'White', courses: [4, 7], base: 15, segments: seg, seat: true, liftoff: 'Second floor' },
    { op: 'roof', phase: 'r', rect: [6, 6, 17, 15], base: 28, color: 'Dark Orange', liftoff: 'Roof' },
    { op: 'floor', phase: 'g', color: 'Tan' }] });
  const r = compile(d(undefined));
  assert.deepEqual([r.errors.map((e) => e.msg), r.warnings.map((w) => w.msg)], [[], []]);
  assert.deepEqual(r.stats.liftoff, ['Roof', 'Second floor'], 'the roof comes off first, then the second floor');
  const subtle = compile(d('subtle'));
  assert.deepEqual([subtle.errors.length, subtle.warnings.length], [0, 0]);
  assert.equal(subtle.stats.pieces, r.stats.pieces, 'variation changes colors, never pieces');
  const recolored = subtle.parts.filter((p, i) => p.color !== r.parts[i].color).length;
  assert.ok(recolored > 0 && recolored < subtle.parts.length * 0.12, `a few pieces recolored (${recolored})`);
});

test('an upper story whose walls pass over a room below still leaves that room fully floored', () => {
  const ground = [[4, 4, 15, 4], [4, 15, 15, 15], [4, 5, 4, 14], [15, 5, 15, 14]];
  const upper = [[4, 4, 15, 4], [4, 15, 15, 15], [4, 5, 4, 14], [15, 5, 15, 14], [10, 5, 10, 14]]; // an upstairs wall across the room below
  const r = compile({ name: 'u', phases: ['g', 's'], ops: [
    { op: 'walls', phase: 'g', color: 'White', courses: [0, 3], base: 0, segments: ground, seat: true },
    { op: 'fill', phase: 's', kind: 'plate', color: 'White', rects: [[4, 4, 15, 15]], y: 13, liftoff: 'Up' },
    { op: 'fill', phase: 's', kind: 'plate', color: 'Tan', rects: [[4, 4, 15, 15]], y: 14, liftoff: 'Up' },
    { op: 'walls', phase: 's', color: 'White', courses: [4, 7], base: 15, segments: upper, liftoff: 'Up' },
    { op: 'floor', phase: 'g', color: 'Tan' }] });
  assert.deepEqual([r.errors.map((e) => e.msg), r.warnings.map((w) => w.msg)], [[], []]);
  const floored = new Set(r.parts.filter((p) => p.op === 4).flatMap((p) => { const c = []; for (let a = 0; a < p.w; a++) for (let b = 0; b < p.d; b++) c.push(`${p.x + a},${p.z + b}`); return c; }));
  assert.ok(floored.has('10,9'), 'the stud under the upstairs wall is floored too');
  assert.equal(floored.size, 10 * 10);
});

test('an upper story with "slab" stands on its own floor, jutting out past the walls below', () => {
  const ring = (x0, z0, x1, z1) => [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0 + 1, x0, z1 - 1], [x1, z0 + 1, x1, z1 - 1]];
  const post = (x, z) => [0, 3, 6, 9].map((y) => ({ op: 'places', phase: 'g', part: 'brick:1x1', color: 'White', y, at: [[x, z]] }));
  const d = (jut, extra = []) => ({ name: 's', phases: ['g', 'u'], ops: [
    { op: 'walls', phase: 'g', color: 'White', courses: [0, 3], base: 0, segments: ring(4, 4, 15, 15) }, ...extra,
    { op: 'floor', phase: 'g', color: 'Tan' },
    { op: 'walls', phase: 'u', color: 'Tan', courses: [4, 7], base: 14, slab: true, segments: ring(4, 4, 15 + jut, 15) }] });
  const r = compile(d(3));
  assert.deepEqual([r.errors.map((e) => e.msg), r.warnings.map((w) => w.msg)], [[], []]);
  const slab = r.parts.filter((p) => p.op === 2 && p.y < 14);
  assert.deepEqual([...new Set(slab.map((p) => p.y))], [12, 13], 'two layers of plates just under the walls');
  assert.equal(slab.reduce((n, p) => n + p.w * p.d, 0), 2 * 15 * 12, 'the whole story, the 3-stud jut included');
  assert.equal(r.subs.find((s) => s.assembly).name, 'u floor');
  const attach = r.steps.findIndex((s) => s.kind === 'attach'), wall = r.steps.findIndex((s) => s.kind === 'main' && s.phase === 'u');
  assert.ok(attach >= 0 && attach < wall, 'the manual places the slab before the walls that stand on it');
  // too far out: warned, until posts under the far corners carry it
  assert.match(compile(d(6)).warnings.map((w) => w.msg).join(' '), /hangs 6 studs out/);
  const posted = compile(d(6, [...post(21, 4), ...post(21, 15)]));
  assert.deepEqual([posted.errors.map((e) => e.msg), posted.warnings.map((w) => w.msg)], [[], []]);
  // set back from the story below: the slab covers that story too, so it rests on its walls
  const back = d(0); back.ops[2].segments = ring(7, 7, 12, 12);
  const rb = compile(back);
  assert.deepEqual([rb.errors.map((e) => e.msg), rb.warnings.map((w) => w.msg)], [[], []]);
  assert.equal(rb.parts.filter((p) => p.op === 2 && p.y < 14).reduce((n, p) => n + p.w * p.d, 0), 2 * 12 * 12);
  back.ops[2].slab = { cover: false };
  assert.match(compile(back).errors.map((e) => e.msg).join(' '), /u floor/, 'on its own it has nothing to rest on');
  // the story below must end under the slab
  const clash = d(3); clash.ops[2].base = 13;
  assert.match(compile(clash).errors.map((e) => e.msg).join(' '), /runs into what's already there/);
});

test('a "mix" recoloring more than 10 percent is warned about once, on walls and roofs alike', () => {
  const seg = [[4, 4, 12, 4], [4, 12, 12, 12], [4, 5, 4, 11], [12, 5, 12, 11]];
  const d = (mix) => ({ name: 'm', phases: ['g', 'r'], ops: [
    { op: 'walls', phase: 'g', color: 'Tan', courses: [0, 3], base: 0, segments: seg, mix },
    { op: 'floor', phase: 'g', color: 'Tan' },
    { op: 'roof', phase: 'r', rect: [4, 4, 12, 12], base: 12, color: 'Dark Orange', mix }] });
  assert.deepEqual(compile(d([['Light Nougat', 0.06]])).warnings, []);
  const busy = compile(d([['Reddish Brown', 0.1], ['Medium Nougat', 0.05]])).warnings.map((w) => w.msg);
  assert.equal(busy.length, 2);
  assert.ok(busy.every((m) => /15 percent/.test(m)));
});

test('designs keep to parts that are easy to buy: the packer picks sizes made in the color, the checker flags the rest', () => {
  const { easyToGet, SIZE_PARTS } = require('../src/engine/engine.js');
  // Dark Orange plates come in 2 x 6 but not 2 x 8: a 2 x 16 run packs without any 2 x 8
  assert.ok(easyToGet(SIZE_PARTS.plate['2x6'], 'Dark Orange') && !easyToGet(SIZE_PARTS.plate['2x8'], 'Dark Orange'));
  const r = compile({ name: 'a', phases: ['p'], ops: [{ op: 'fill', phase: 'p', kind: 'plate', color: 'Dark Orange', rects: [[4, 4, 5, 19]] }] });
  assert.deepEqual([r.errors.length, r.warnings.length], [0, 0]);
  assert.ok(r.parts.every((p) => easyToGet(p.no, p.color)) && !r.parts.some((p) => p.no === SIZE_PARTS.plate['2x8']));
  // a part asked for by name in a color LEGO hasn't made it in is flagged, with colors it does come in
  const w = compile({ name: 'b', phases: ['p'], ops: [{ op: 'place', phase: 'p', part: 'arch41', color: 'Dark Green', at: [4, 0, 4] }] }).warnings.map((x) => x.msg).join(' ');
  assert.match(w, /Arch 1 x 4 in Dark Green \(1\) is hard to get: LEGO has not made it in that color\. Use a color it's easy to get in \(White/);
  // old Light Gray (last made 2004) is flagged even though many sets had it
  assert.match(compile({ name: 'c', phases: ['p'], ops: [{ op: 'place', phase: 'p', part: 'brick:2x4', color: 'Light Gray', at: [4, 0, 4] }] }).warnings[0].msg, /the latest in 2004/);
});

test('bare baseplate around a house is flagged, and a lawn op listed last finishes it with patches, tufts and flowers', () => {
  const house = [{ op: 'walls', phase: 'h', color: 'White', courses: [0, 3], base: 0, segments: [[10, 10, 20, 10], [10, 20, 20, 20], [10, 11, 10, 19], [20, 11, 20, 19]] },
    { op: 'floor', phase: 'h', color: 'Tan' }];
  const bare = engine.compile({ name: 'b', phases: ['h', 'g'], ops: house });
  assert.match(bare.warnings.map((w) => w.msg).join(' '), /The baseplate is bare in an open \d+ x \d+ stretch/);
  for (const texture of ['lawn', 'meadow', 'dry']) {
    const r = engine.compile({ name: 'l', phases: ['h', 'g'], ops: [...house, { op: 'lawn', phase: 'g', texture }] });
    assert.deepEqual([texture, r.errors.map((e) => e.msg), r.warnings.map((w) => w.msg)], [texture, [], []]);
    const lawn = r.parts.filter((p) => p.op === 2);
    assert.ok(lawn.some((p) => p.key.startsWith('plate:')) && lawn.some((p) => p.key === 'sprig1'), `${texture} has patches and tufts`);
    assert.ok(lawn.every((p) => engine.easyToGet(p.no, p.color)), `${texture} uses parts that are easy to get`);
    assert.ok(!lawn.some((p) => p.x >= 10 && p.x <= 20 && p.z >= 10 && p.z <= 20), 'nothing inside the house');
  }
  assert.match(engine.compile({ name: 'x', phases: ['h', 'g'], ops: [...house, { op: 'lawn', phase: 'g', texture: 'astroturf' }] }).errors[0].msg, /Lawn texture must be one of lawn, meadow, dry/);
  assert.deepEqual(engine.compile({ name: 'a', lot: false, phases: ['h'], ops: house }).warnings, [], 'a building alone skips the check');
});

test('paving and floors show some stud texture: a share of the tiles become plates of the same size, in patches', () => {
  const drive = (extra) => ({ name: 'd', variation: 'subtle', phases: ['p'], ops: [{ op: 'fill', phase: 'p', kind: 'tile', color: 'Light Bluish Gray', rects: [[0, 0, 23, 23]], ...extra }] });
  const plain = compile({ ...drive({ studs: 0 }) }), textured = compile(drive({}));
  assert.deepEqual([textured.errors.length, textured.warnings.length], [0, 0]);
  const plates = textured.parts.filter((p) => p.kind === 'plate');
  assert.ok(plates.length > 0 && plates.length < textured.parts.length * 0.3, `some studded pieces (${plates.length} of ${textured.parts.length})`);
  assert.equal(textured.parts.length, plain.parts.length, 'same pieces, some swapped');
  textured.parts.forEach((p, k) => assert.deepEqual([p.x, p.y, p.z, p.w, p.d, p.h], [plain.parts[k].x, plain.parts[k].y, plain.parts[k].z, plain.parts[k].w, plain.parts[k].d, plain.parts[k].h]));
  assert.ok(plates.every((p) => engine.easyToGet(p.no, p.color)));
  // a lift-off roof's tiles stay smooth unless asked
  assert.equal(compile(drive({ liftoff: 'R', y: 0 })).parts.filter((p) => p.kind === 'plate').length, 0);
  assert.equal(compile(drive({ studs: 0.3 })).parts.filter((p) => p.kind === 'plate').length > plates.length, true);
});

test('a roof beside a window keeps below its sill: slopes there become flat tiles, and anything else in front is flagged', () => {
  // a one-story wing roofed against a two-story wall whose upper window starts just above the wing's walls
  const tall = { op: 'walls', phase: 'w', color: 'White', courses: [0, 7], base: 0, segments: [[4, 4, 14, 4], [4, 10, 14, 10], [4, 5, 4, 9], [14, 5, 14, 9]],
    openings: [{ cells: [8, 10, 9, 10], courses: [6, 7], fill: { part: 'win22', color: 'White' } }] }; // glass from height 18, where the roof beside it tops out
  const wing = { op: 'walls', phase: 'w', color: 'White', courses: [0, 3], base: 0, segments: [[4, 11, 14, 11], [4, 16, 14, 16], [4, 12, 4, 15], [14, 12, 14, 15]] };
  const roof = { op: 'roof', phase: 'r', rect: [4, 11, 14, 16], base: 12, abut: ['N'], color: 'Dark Orange' };
  const r = compile({ name: 'w', phases: ['w', 'r'], ops: [tall, wing, roof, { op: 'floor', phase: 'w', color: 'Tan' }] });
  assert.deepEqual(r.warnings.filter((w) => /window/.test(w.msg)), []);
  // within two studs of the window, the roof ends in flat tiles no higher than the sill (a tile may cover the frame's foot)
  const front = r.parts.filter((p) => p.op === 2 && p.x <= 9 && p.x + p.w > 8 && p.z >= 11 && p.z <= 12 && p.y + p.h > 17);
  assert.ok(front.length && front.every((p) => p.key !== 'cheese' && p.y + p.h <= 19), 'no slope rises in front of the window');
  assert.ok(front.some((p) => p.key === 'tile:1x1'), 'a flat ledge of tiles, not bare studs');
  assert.ok(r.parts.some((p) => p.op === 2 && p.key === 'cheese' && p.z === 11 && p.x === 11), 'slopes stay elsewhere along that edge');
  // a wall built across the window's height outside it is flagged
  const blocked = compile({ name: 'b', phases: ['w'], ops: [tall,
    { op: 'fill', phase: 'w', kind: 'brick', color: 'White', rects: [[8, 11, 9, 11]], y: 18 }] });
  assert.match(blocked.warnings.map((w) => w.msg).join(' '), /stands in front of the w window at \(8, 10\)/);
});

test('a lift-off hip roof over an L holds together at its inside corners, whatever sizes the packer has', () => {
  // the next course puts a slope, not a plate, over a cell whose only outside neighbour is diagonal, so
  // that cell doesn't tie its piece to the course above (GoBricks' 1 x 3 plates once stranded a corner here)
  const walls = { op: 'walls', phase: 'walls', color: 'Tan', courses: [10, 14], base: 2, liftoff: 'Top floor', seat: true,
    slab: { color: 'Tan', rects: [[13, 14, 33, 23], [14, 22, 33, 39], [16, 37, 31, 43], [14, 13, 24, 13]] },
    segments: [[19, 15, 25, 15], [16, 16, 19, 16], [25, 16, 28, 16], [28, 20, 30, 20], [15, 26, 16, 26], [15, 36, 16, 36], [16, 39, 22, 39], [22, 41, 30, 41],
      [15, 26, 15, 36], [16, 16, 16, 26], [16, 36, 16, 39], [19, 15, 19, 16], [22, 39, 22, 41], [25, 15, 25, 16], [28, 16, 28, 20], [30, 20, 30, 41]] };
  const roof = { op: 'roof', phase: 'roof', rects: [[22, 20, 30, 41], [16, 16, 28, 39], [15, 26, 16, 36], [19, 15, 25, 16]], base: 18,
    color: 'Dark Orange', fascia: 'Dark Brown', liftoff: 'Roof' };
  for (const supplier of [undefined, 'gobricks']) {
    const r = compile({ name: 'L', plate: 48, supplier, phases: ['walls', 'roof'], ops: [walls, roof] });
    assert.deepEqual(r.errors, [], supplier || 'LEGO');
  }
});

test('a design held to GoBricks uses exactly the parts and colors GoBricks makes, and warns about any other', () => {
  const { SUPPLY, supplies, supplierNo, easyToGet } = engine, G = SUPPLY.gobricks;
  assert.ok(G.made['3001'].Tan > 0 && supplies(G, '3001', 'Tan') && !supplies(G, '3001', 'Light Gray'));
  assert.equal(supplierNo(G, '3008', 'Tan'), 'GDS-536-031');
  const plants = (kind) => compile({ name: 'g', supplier: 'gobricks', plate: 48, phases: ['p'], ops: [{ op: 'plant', phase: 'p', kind, at: [[20, 0, 20]] }] });
  assert.deepEqual(plants('shade tree').warnings, []);
  assert.deepEqual(plants('palm').warnings, []);
  // GoBricks has no lavender: the checker names the colors it does make the part in
  assert.match(plants('jacaranda').warnings.map((w) => w.msg).join(' '), /GoBricks doesn't make Plant leaves 6 x 5 in Lavender \(2\): use a color it makes \(Reddish Brown, Green.*\) or another part \(the jacaranda plant uses it: pick another plant\)/);
  // the packer keeps to the sizes GoBricks makes in a color: no 1 x 8 or 1 x 6 plates in Coral
  const coral = compile({ name: 'c', supplier: 'gobricks', phases: ['p'], ops: [{ op: 'fill', phase: 'p', kind: 'plate', color: 'Coral', rects: [[2, 2, 17, 3]], y: 0 }] });
  assert.deepEqual(coral.warnings, []);
  assert.ok(coral.parts.every((q) => supplies(G, q.no, q.color)) && !coral.parts.some((q) => q.no === '3460' || q.no === '3666'));
  // a part LEGO sets rarely include but GoBricks makes: fine with GoBricks, flagged for LEGO
  const pick = Object.entries(G.made).flatMap(([no, m]) => Object.keys(m).map((c) => [no, c])).find(([no, c]) => /^30(0[1-9]|10)$/.test(no) && !easyToGet(no, c));
  const size = Object.entries(engine.SIZE_PARTS.brick).find(([, no]) => no === pick[0])[0];
  const one = (d) => compile({ name: 'o', phases: ['p'], ...d, ops: [{ op: 'place', phase: 'p', part: 'brick:' + size, color: pick[1], at: [4, 0, 4] }] });
  assert.deepEqual(one({ supplier: 'gobricks' }).warnings, []);
  assert.match(one({}).warnings.map((w) => w.msg).join(' '), /hard to get/);
  assert.match(compile({ name: 'x', supplier: 'acme', phases: ['p'], ops: [] }).errors[0].msg, /Unknown supplier "acme"; known: gobricks/);
  // GoBricks makes the 1 x 2 x 3 window, but its store's part-list upload doesn't know it, so it can't be ordered
  const win = (part) => compile({ name: 'w', supplier: 'gobricks', phases: ['p'], ops: [{ op: 'walls', phase: 'p', color: 'White', courses: [0, 3], base: 0,
    segments: [[2, 2, 9, 2]], openings: [{ cells: [4, 2, 5, 2], courses: [0, 2], fill: { part, color: 'Dark Green' } }] }] }).warnings.map((w) => w.msg);
  assert.deepEqual(win('win22'), []);
  assert.match(win('win23').join(' '), /Window 1 x 2 x 3 \(60593\) can't be ordered from GoBricks: use another part/);
  // GoBricks' own thick green baseplate (no LEGO number), so the lawn is patches on green as with LEGO
  const yard = (supplier) => compile({ name: 'y', lot: true, plate: 48, supplier, phases: ['g'], ops: [{ op: 'lawn', phase: 'g' }] });
  const ground = (r) => new Set(r.parts.filter((q) => q.y === 0).flatMap((q) => q.occ.filter((v) => v[2] === 0).map((v) => v[0] + ',' + v[1]))).size;
  const lego = yard(undefined), gds = yard('gobricks'), plate = gds.inventory.find((e) => e.kind === 'baseplate');
  assert.equal(lego.stats.baseColor, 'Green'); assert.equal(lego.stats.baseThick, 0);
  assert.deepEqual([plate.gds, plate.color, gds.stats.baseThick], ['GDS-2238-040', 'Green', 1]);
  assert.ok(ground(gds) < 48 * 48 / 2); assert.deepEqual(gds.errors, []); assert.deepEqual(gds.warnings, []);
  // a supplier without its own baseplate: a neutral one it sells the LEGO baseplate in, with the lawn laid over it
  const own = G.baseplates; delete G.baseplates;
  try {
    const n = yard('gobricks');
    assert.ok(supplies(G, '4186', n.stats.baseColor) && n.stats.baseColor !== 'Green', n.stats.baseColor);
    assert.equal(ground(n), 48 * 48); assert.deepEqual(n.warnings, []);
  } finally { G.baseplates = own; }
});

test('a low pitch rises a plate every 2 or 3 studs and still holds together, over one rectangle and a union', () => {
  const walls = { op: 'walls', phase: 'walls', color: 'Tan', courses: [0, 3], base: 0, seat: true, segments: [[4, 4, 20, 4], [4, 16, 20, 16], [4, 4, 4, 16], [20, 4, 20, 16]] };
  const height = (r) => Math.max(...r.parts.filter((p) => p.op === 1).map((p) => p.y + p.h));
  const tops = {};
  for (const pitch of [undefined, 2, 3]) for (const supplier of [undefined, 'gobricks']) {
    for (const shape of [{ rect: [4, 4, 20, 16] }, { rects: [[4, 4, 20, 10], [4, 10, 12, 16]] }]) {
      const r = compile({ name: 'P', supplier, phases: ['walls', 'roof'], ops: [walls, { op: 'roof', phase: 'roof', ...shape, base: 13, color: 'Dark Tan', fascia: 'Dark Brown', liftoff: 'Roof', pitch }] });
      assert.deepEqual(r.errors, [], `pitch ${pitch} ${supplier || 'LEGO'} ${Object.keys(shape)[0]}`);
      if (shape.rect && !supplier) tops[pitch || 1] = height(r);
    }
  }
  // 13 studs across: 7 courses at the usual pitch, about half and a third of that lower
  assert.ok(tops[2] < tops[1] && tops[3] < tops[2], JSON.stringify(tops));
  assert.match(compile({ name: 'P', phases: ['walls', 'roof'], ops: [walls, { op: 'roof', phase: 'roof', rect: [4, 4, 20, 16], base: 13, color: 'Dark Tan', pitch: 5 }] }).errors[0].msg, /pitch/);
});

test('a shed roof rises to one side and ends in an overhang there, with no taller wall behind it', () => {
  const walls = { op: 'walls', phase: 'walls', color: 'Tan', courses: [0, 3], base: 0, seat: true, segments: [[4, 4, 12, 4], [4, 20, 12, 20], [4, 4, 4, 20], [12, 4, 12, 20]] };
  for (const supplier of [undefined, 'gobricks']) for (const pitch of [1, 3]) {
    const r = compile({ name: 'S', supplier, phases: ['walls', 'roof'], ops: [walls,
      { op: 'roof', phase: 'roof', rect: [4, 4, 12, 20], base: 13, color: 'Dark Tan', fascia: 'Dark Brown', gable: ['N', 'S'], shed: 'E', pitch, liftoff: 'Roof' }] });
    assert.deepEqual(r.errors, [], `pitch ${pitch} ${supplier || 'LEGO'}`);
    assert.deepEqual(r.warnings.filter((w) => /abuts|stepped edge/.test(w.msg)), []);
    const roof = r.parts.filter((p) => p.op === 1), hi = Math.max(...roof.map((p) => p.y + p.h));
    // the high side overhangs the east wall by a stud, at the roof's full height
    assert.ok(roof.some((p) => p.x + p.w - 1 === 13 && p.y + p.h >= hi - 1), `pitch ${pitch}: no overhang on the high side`);
    assert.ok(!roof.some((p) => p.x + p.w - 1 > 13));
  }
  assert.match(compile({ name: 'S', phases: ['walls', 'roof'], ops: [walls, { op: 'roof', phase: 'roof', rect: [4, 4, 12, 20], base: 13, color: 'Dark Tan', shed: 'E', abut: ['E'] }] }).errors[0].msg, /shed/);
});
