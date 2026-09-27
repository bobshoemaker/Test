// Engine regression tests. Piece counts are snapshots: update them when a design changes on purpose.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compile } = require('../src/engine/engine.js');

const load = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '../designs', name + '.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

for (const [name, pieces] of [['savannah-dr', 1202], ['634-unit-a', 778]]) {
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
