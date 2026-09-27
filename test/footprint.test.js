// Floor plan footprint to locked walls: scale, layout on the baseplate, doors, and the conformance check.
const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutFootprint, skeletonOps, checkFootprint, calibrate, segmentsFromCells } = require('../src/server/footprint');
const { compile } = require('../src/engine/engine.js');

// 10 px per ft: a 20 x 30 ft house (two blocks sharing a wall) with a detached 20 x 10 ft garage behind it.
const PLAN = {
  street: 'S',
  rooms: [{ name: 'Living', label: '14 X 20', rectPx: [100, 200, 240, 400] }, { name: 'Bed', label: '10 x 10', rectPx: [0, 100, 100, 200] }],
  blocks: [
    { name: 'Wing', levels: 2, rectsPx: [[0, 100, 100, 200]] },
    { name: 'House', levels: 1, rectsPx: [[100, 100, 200, 400]] },
    { name: 'Garage', levels: 1, rectsPx: [[0, 0, 200, 60]] },
  ],
  openings: [
    { block: 'Wing', kind: 'garage door', atPx: [50, 200], widthFt: 8 },
    { block: 'House', kind: 'door', atPx: [100, 300], widthFt: 3 },
  ],
  stairs: [{ name: 'Front steps', rectPx: [60, 280, 100, 320] }],
};

test('the scale comes from labeled rooms, whichever way the label is written', () => {
  const cal = calibrate([{ name: 'a', label: '20 x 14', rectPx: [0, 0, 140, 200] }, { name: 'b', label: '10 X 10', rectPx: [0, 0, 100, 100] }]);
  assert.equal(cal.pxPerFt, 10);
});

test('the footprint lands on the baseplate at 2 ft per stud with the front at row 29', () => {
  const L = layoutFootprint(PLAN);
  assert.deepEqual(L.problems, []);
  const house = L.blocks.find((b) => b.name === 'House'), wing = L.blocks.find((b) => b.name === 'Wing');
  assert.equal(Math.max(...house.cellRects.map((r) => r[3])), 29);
  // 20 ft wide house = 10 studs between wall centers; the shared wall at px 100 is one row of cells.
  const w = house.cellRects[0][2] - wing.cellRects[0][0];
  assert.equal(w, 10);
  const houseCells = new Set(house.cells.map((c) => c.join()));
  assert.ok(wing.cells.every((c) => !houseCells.has(c.join())), 'a shared wall belongs to one block');
  // The garage door is 4 studs on the wing's front wall; the house door is on the house's west wall.
  assert.deepEqual(wing.openings.map((o) => [o.kind, o.side, o.cells[2] - o.cells[0] + 1]), [['garage door', 'S', 4]]);
  assert.equal(L.blocks.flatMap((b) => b.openings).find((o) => o.kind === 'door').side, 'W');
});

test('a plan whose street is on the east side is turned so that side faces z = 31', () => {
  const L = layoutFootprint({ ...PLAN, street: 'E', blocks: [{ name: 'House', levels: 1, rectsPx: [[0, 0, 200, 100]] }],
    openings: [{ block: 'House', kind: 'door', atPx: [200, 50], widthFt: 3 }], stairs: [] });
  assert.deepEqual(L.problems, []);
  assert.equal(L.blocks[0].openings[0].side, 'S');
});

test('a detached garage far behind the house is pulled forward to fit', () => {
  const far = { ...PLAN, blocks: PLAN.blocks.map((b) => (b.name === 'Garage' ? { ...b, rectsPx: [[0, -200, 200, -140]] } : b)) };
  const L = layoutFootprint(far);
  assert.deepEqual(L.problems, []);
  assert.ok(L.blocks.find((b) => b.name === 'Garage').pulledForward > 0);
  assert.ok(Math.min(...L.blocks.flatMap((b) => b.cellRects.map((r) => r[1]))) >= 0);
  const tooDeep = layoutFootprint({ ...PLAN, blocks: [{ name: 'House', levels: 1, rectsPx: [[0, 0, 100, 700]] }], openings: [] });
  assert.match(tooDeep.problems.join(' '), /too deep/);
});

test('the skeleton walls compile, and moving a locked wall or door is reported', () => {
  const L = layoutFootprint(PLAN);
  const ops = skeletonOps(L);
  const design = { name: 't', phases: ops.map((o) => o.phase), ops };
  assert.deepEqual(compile(design).errors, []);
  assert.deepEqual(checkFootprint(design, L), []);
  const moved = JSON.parse(JSON.stringify(design));
  moved.ops[1].segments[0][0] += 1;
  assert.match(checkFootprint(moved, L).join(' '), /House walls must keep the locked segments/);
  const door = JSON.parse(JSON.stringify(design));
  const o = door.ops.find((x) => x.openings.some((p) => /garage/.test(p.note))).openings[0];
  o.cells = [o.cells[0] + 1, o.cells[1], o.cells[2] + 1, o.cells[3]];
  assert.match(checkFootprint(door, L).join(' '), /garage door on the Wing S wall must stay/);
  const untagged = JSON.parse(JSON.stringify(design));
  delete untagged.ops[0].block;
  assert.match(checkFootprint(untagged, L).join(' '), /no walls op has "block": "Wing"/);
});

test('segments cover exactly the cells they came from', () => {
  const cells = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [5, 5]];
  const got = new Set();
  for (const [x0, z0, x1, z1] of segmentsFromCells(cells)) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) got.add(x + ',' + z);
  assert.deepEqual([...got].sort(), cells.map((c) => c.join()).sort());
});

test('a corner lot keeps room for the second street on its side instead of centering the house', () => {
  const L = layoutFootprint({ ...PLAN, sideStreet: 'W' });
  assert.deepEqual(L.problems, []);
  assert.deepEqual(L.sideStreet, { planSide: 'W', side: 'left', columns: [0, 1] });
  assert.equal(Math.min(...L.blocks.flatMap((b) => b.cellRects.map((r) => r[0]))), 2);
  const R = layoutFootprint({ ...PLAN, street: 'E', sideStreet: 'N', blocks: [{ name: 'House', levels: 1, rectsPx: [[0, 0, 200, 100]] }], openings: [], stairs: [] });
  assert.equal(R.sideStreet.side, 'right', 'with the street on the east, north is on the right as seen from it');
  assert.equal(Math.max(...R.blocks.flatMap((b) => b.cellRects.map((r) => r[2]))), 29);
});
