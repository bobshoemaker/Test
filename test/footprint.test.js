// Floor plan footprint to locked walls: scale, layout on the baseplate, doors, and the conformance check.
const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutFootprint, footprintFromOutline, skeletonOps, checkFootprint, calibrate, segmentsFromCells } = require('../src/server/footprint');
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

test('a building outline turned 20 degrees becomes square locked walls with the street in front', () => {
  // An L-shaped house (metres): 16 x 8 with a 6 x 5 wing and a shed behind, turned 20 degrees.
  const rot = (deg) => ([x, y]) => { const a = deg * Math.PI / 180; return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; };
  const house = [[-8, -5], [8, -5], [8, 3], [2, 3], [2, 8], [-4, 8], [-4, 3], [-8, 3]].map(rot(20));
  const shed = [[-8, 10], [-4, 10], [-4, 12], [-8, 12]].map(rot(20));
  const toStreet = rot(20)([0, -1]); // the street is off the 16 m side
  const L = footprintFromOutline({ buildings: [{ name: 'House', levels: 1, polygon: house }, { name: 'Shed', levels: 1, polygon: shed }], toStreet });
  assert.equal(L.source, 'outline');
  assert.deepEqual(L.problems, []);
  const h = L.blocks.find((b) => b.name === 'House');
  const xs = h.cellRects.flatMap((r) => [r[0], r[2]]), zs = h.cellRects.flatMap((r) => [r[1], r[3]]);
  assert.equal(Math.max(...xs) - Math.min(...xs), Math.round(16 / 0.6096), '16 m across the street side');
  assert.equal(Math.max(...zs), 29, 'the street side sits at row 29');
  const ops = skeletonOps(L);
  assert.deepEqual(compile({ name: 'o', phases: ops.map((o) => o.phase), ops }).errors, []);
});

test('on the 48 x 48 plate at 1.5 ft per stud the same house is a third larger, with a front yard', () => {
  const L = layoutFootprint(PLAN, { size: 48, ftPerStud: 1.5, frontYard: 3 });
  assert.deepEqual(L.problems, []);
  assert.equal(L.size, 48);
  const house = L.blocks.find((b) => b.name === 'House');
  assert.equal(Math.max(...house.cellRects.map((r) => r[3])), 42, 'three yard rows in front of row 45');
  const wing = L.blocks.find((b) => b.name === 'Wing');
  assert.equal(house.cellRects[0][2] - wing.cellRects[0][0], Math.round(20 / 1.5), 'wing plus house, 20 ft wide = 13 studs at 1.5 ft');
});

test('a story is about 9 ft of courses at either scale', () => {
  const tall = (opts) => skeletonOps(layoutFootprint(PLAN, opts)).find((o) => o.block === 'Wing').courses;
  assert.deepEqual(tall(), [0, 7], 'two stories of 4 courses at 2 ft per stud');
  assert.deepEqual(tall({ size: 48, ftPerStud: 1.5, frontYard: 3 }), [0, 9], 'two stories of 5 courses at 1.5 ft per stud');
});

test('a plan with no size labels is scaled from standard lengths, flagged as an estimate', () => {
  const noSizes = { ...PLAN, rooms: PLAN.rooms.map(({ label, ...r }) => r), lengths: [{ what: 'two-car garage door', linePx: [20, 60, 180, 60], ft: 16 }, { what: 'garage depth', linePx: [0, 0, 0, 200], ft: 20 }] };
  const L = layoutFootprint(noSizes);
  assert.equal(L.scale.pxPerFt, 10);
  assert.match(L.scale.estimated, /no size labels/);
  assert.match(layoutFootprint({ ...noSizes, lengths: [] }).problems[0], /standard things/);
});
