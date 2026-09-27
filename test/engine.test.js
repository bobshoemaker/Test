// Engine regression tests. Piece counts are snapshots: update them when a design changes on purpose.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compile } = require('../src/engine/engine.js');

const load = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '../designs', name + '.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

for (const [name, pieces] of [['savannah-dr', 1208], ['634-unit-a', 778]]) {
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
  assert.deepEqual([union.errors.length, union.warnings.length], [0, 0]);
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
  assert.deepEqual([tall.errors.length, tall.warnings.map((w) => w.msg)], [0, []]);
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
  assert.deepEqual([ok.errors, ok.warnings], [[], []]);
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
