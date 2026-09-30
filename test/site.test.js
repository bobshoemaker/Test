// Finding and mapping the house from above (site.js): the pure steps, with no network, Claude or browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fitPlan, lockPlan, siteInStuds, siteNoteText, cleanPlan, coverage, mergeBuildings, numberCandidates, facingStreets, candidateLine, siteFrame, wallAxes, tigerStreets, sameStreet } = require('../src/server/site');
const { scaleFor, storyCoursesAt } = require('../src/server/scale');
const { skeletonOps, checkFootprint } = require('../src/server/footprint');
const { compile } = require('../src/engine/engine.js');
const { frame } = require('../src/server/terrain');

// A long ranch house (55 x 74 ft) with a two-story garage wing at the front right, on a 60 x 146 ft lot whose front
// line is 22 ft in front of it, and a driveway down the right side. Feet: u to the right, v back from the street.
const LONG = {
  summary: 'A long one-story ranch with a two-story wing over the garage.',
  blocks: [{ name: 'Garage wing', stories: 2, rects: [[36, 0, 54, 24]], roof: 'hip' }, { name: 'House', stories: 1, rects: [[0, 0, 54, 46], [18, 46, 46, 74]], roof: 'hip' }],
  openings: [{ block: 'Garage wing', kind: 'garage door', at: [45, 0], widthFt: 16 }, { block: 'House', kind: 'door', at: [12, 0], widthFt: 3 }],
  site: { driveways: [[55, -22, 60, 60]], lawn: [[0, -20, 34, -2]], trees: [{ at: [8, 90], kind: 'palm', diameterFt: 12 }], fences: [{ line: [0, 100, 60, 100], kind: 'block wall' }] },
};
const LOT = [0, -22, 60, 124];
const plan = () => cleanPlan(JSON.parse(JSON.stringify(LONG))).plan;

test('a submitted site plan is cleaned, and its problems are said plainly', () => {
  const { plan: p, problems } = cleanPlan({
    blocks: [{ name: 'A', stories: 1, rects: [[10, 0, 0, 20]] }, { name: 'A', stories: 1, rects: [[0, 0, 5, 5]] }, { name: 'B', stories: 5, rects: [[0, 0, 0, 5], 'x'] }, { name: 'C', stories: 4, rects: [[20, 0, 30, 10]], roof: 'dome' }],
    openings: [{ block: 'A', kind: 'door', at: [5, 0], widthFt: 3 }, { block: 'A', kind: 'door', at: [5, 10], widthFt: 3 }, { block: 'Z', kind: 'door', at: [0, 0] }],
    site: { driveways: [[0, 0, 5, 5], [1, 2, 3]], trees: [{ at: [40, 40], kind: 'oak', diameterFt: 500 }] },
  });
  assert.deepEqual(p.blocks.map((b) => [b.name, b.stories, b.rects, b.roof]), [['A', 1, [[0, 0, 10, 20]], 'hip'], ['C', 3, [[20, 0, 30, 10]], 'hip']]);
  assert.match(problems.join(' '), /Two blocks are called "A"/);
  assert.match(problems.join(' '), /Block "B" has no valid rectangles/);
  assert.match(problems.join(' '), /Block "C" has 4 stories; use 1 to 3/);
  assert.match(problems.join(' '), /The door of A at \[5,10\] is 5 ft from that block's walls/);
  assert.match(problems.join(' '), /"Z" isn't one/);
  assert.deepEqual(p.site.driveways, [[0, 0, 5, 5]]);
  assert.equal(p.site.trees[0].diameterFt, 60);
  const palm = cleanPlan({ blocks: [{ name: 'Wing', stories: 2, rects: [[0, 0, 20, 40]] }], openings: [], site: { trees: [{ at: [10, 20], kind: 'palm' }, { at: [25, 20], kind: 'oak' }] } });
  assert.deepEqual(palm.plan.site.trees.map((t) => t.kind), ['oak']);
  assert.match(palm.problems[0], /The palm at \[10,20\] is inside Wing; a tree's trunk stands outside the house/);
});

test('coverage says how much of the outline the blocks share, and where they differ', () => {
  const outline = [[0, 0], [40, 0], [40, 30], [0, 30]];
  const same = coverage(outline, [{ rects: [[0, 0, 40, 30]] }]);
  assert.equal(same.iou, 1);
  assert.equal(same.outlineSqFt, 1200);
  const half = coverage(outline, [{ rects: [[0, 0, 20, 30]] }]);
  assert.equal(half.missingSqFt, 600);
  assert.deepEqual(half.missingBox, [21, 1, 40, 30]);
  assert.ok(Math.abs(half.iou - 0.5) < 0.01);
  const over = coverage(outline, [{ rects: [[0, 0, 40, 40]] }]);
  assert.equal(over.extraSqFt, 400);
});

test('a long house on the Classic: the scale stretches to 3 ft per stud, the yards give way, and the Grand is suggested', () => {
  const fit = fitPlan(plan(), { plate: 32, lotRect: LOT });
  assert.equal(fit.ftPerStud, 3);
  assert.deepEqual(fit.houseFt, [54, 74]);
  assert.deepEqual([fit.frontRows, fit.backRows], [3, 1]); // the front yard first: the view from the street
  assert.equal(fit.recommended, 48);
  assert.deepEqual(fit.center, [0, 60]); // the whole lot fits across, so both lot lines show
  const grand = fitPlan(plan(), { plate: 48, lotRect: LOT });
  assert.equal(grand.ftPerStud, 2);
  assert.equal(grand.recommended, 48);
  assert.deepEqual(grand.problems, []);
  // the Mini can't hold it within its range: the house stays whole anyway, and the Classic is the next step up
  const mini = fitPlan(plan(), { plate: 16, lotRect: LOT });
  assert.ok(mini.ftPerStud > 5);
  assert.equal(mini.recommended, 32);
  assert.match(mini.problems[0], /too long for the Mini at its coarsest 5 ft per stud, so it is shown whole/);
});

test('an ordinary house keeps the size\'s usual scale and a real front yard', () => {
  const small = cleanPlan({ blocks: [{ name: 'House', stories: 1, rects: [[0, 0, 40, 30]] }], openings: [], site: { streetEdge: -20 } }).plan;
  const fit = fitPlan(small, { plate: 32, lotRect: [-5, -20, 45, 100] });
  assert.equal(fit.ftPerStud, 2);
  assert.deepEqual([fit.frontRows, fit.backRows], [10, 4]);
  assert.equal(fit.recommended, 32);
  assert.equal(fitPlan(small, { plate: 16, lotRect: [-5, -20, 45, 100] }).ftPerStud, 4);
});

test('the map locks the walls at the fitted scale, and the lot comes out in studs', () => {
  const p = plan(), fit = fitPlan(p, { plate: 32, lotRect: LOT }), locked = lockPlan(p, fit);
  assert.equal(locked.source, 'site');
  assert.deepEqual(locked.problems, []);
  assert.deepEqual(locked.blocks.map((b) => [b.name, b.levels, b.stories, b.roof]), [['Garage wing', 2, 2, 'hip'], ['House', 1, 1, 'hip']]);
  const house = locked.blocks.find((b) => b.name === 'House'), garage = locked.blocks.find((b) => b.name === 'Garage wing');
  // 54 ft across at 3 ft per stud is 18 studs between wall lines; the front wall sits in front of 3 rows of yard
  assert.deepEqual(house.cellRects[0], [6, 10, 24, 26]);
  assert.equal(garage.cellRects[0][3], 26);
  assert.equal(32 - 2 - 1 - 26, fit.frontRows);
  assert.deepEqual(garage.openings.map((o) => [o.kind, o.side]), [['garage door', 'S']]);
  assert.equal(garage.openings[0].cells[2] - garage.openings[0].cells[0] + 1, 5); // 16 ft at 3 ft per stud
  // the walls ops Claude starts from: a story is 3 courses at this scale
  assert.equal(storyCoursesAt(3), 3);
  const ops = skeletonOps(locked);
  assert.deepEqual(ops.find((o) => o.block === 'Garage wing').courses, [0, 5]);
  assert.match(ops.find((o) => o.block === 'Garage wing').openings[0].note, /from the map/);
  assert.match(checkFootprint({ ops: [] }, locked)[0], /^Locked walls: no walls op has "block"/);
  const studs = siteInStuds(p, locked, { lotRect: LOT });
  assert.deepEqual(studs.streetRows, [30, 31]);
  assert.deepEqual([studs.lot.left, studs.lot.right], [6, 26]); // the left lot line on the house's left wall line
  assert.equal(studs.driveways[0][3], 29); // reaches the sidewalk
  assert.equal(studs.trees.length, 0); // the palm is past the back of the plate
  const note = siteNoteText({ plan: p, locked, studs, fit, facts: 'built 1948' });
  assert.match(note, /at 3 ft per stud \(set "stud": 3 in the design; this size is usually 2 ft per stud/);
  assert.match(note, /left lot line at x = 6, right lot line at x = 26/);
  assert.match(note, /Driveway: \[25, \d+, 26, 29\]/);
});

test('a fitted scale travels with the design: the compiler counts a story at it', () => {
  const walls = { op: 'walls', phase: 'p', color: 'White', courses: [0, 2], base: 0, segments: [[2, 2, 9, 2], [2, 9, 9, 9], [2, 3, 2, 8], [9, 3, 9, 8]] };
  const floor = { op: 'floor', phase: 'p', kind: 'tile', color: 'Tan' };
  const usual = compile({ name: 'c', lot: false, phases: ['p'], ops: [walls, floor] });
  assert.match(usual.warnings.map((w) => w.msg).join(), /walls at least 4 courses tall/);
  const fitted = compile({ name: 'c', lot: false, stud: 3, phases: ['p'], ops: [walls, floor] });
  assert.deepEqual(fitted.warnings.map((w) => w.msg), []);
  assert.equal(fitted.stats.ftPerStud, 3);
  assert.equal(compile({ name: 'c', lot: false, stud: 40, phases: ['p'], ops: [] }).stats.ftPerStud, 2); // out of range: the size's own
  assert.equal(scaleFor(32, 2.5).storyCourses, '3');
  assert.equal(scaleFor(32).fitted, false);
});

test('buildings from two sources merge, and the candidates are numbered nearest first', () => {
  const origin = { lat: 34, lon: -118 }, { toXY, toLL } = frame(origin);
  const square = (e, n, h) => [[e - h, n - h], [e + h, n - h], [e + h, n + h], [e - h, n + h]].map(toLL);
  const structs = [{ id: 'usa-1', ring: square(30, 0, 6) }, { id: 'usa-2', ring: square(-15, 5, 5) }, { id: 'usa-3', ring: square(0, 200, 6) }, { id: 'usa-4', ring: square(10, 10, 2) }];
  const osm = [{ id: 'osm-1', ring: square(30, 1, 5), address: '12 Elm St' }, { id: 'osm-2', ring: square(0, -40, 6), address: '9 Elm St' }];
  const all = mergeBuildings(structs, osm, toXY);
  assert.deepEqual(all.map((b) => b.id), ['usa-1', 'usa-2', 'usa-3', 'usa-4', 'osm-2']);
  assert.equal(all[0].address, '12 Elm St');
  const c = numberCandidates(all);
  // usa-3 is too far, usa-4 too small (a shed)
  assert.deepEqual(c.map((b) => [b.n, b.id]), [[1, 'usa-2'], [2, 'usa-1'], [3, 'osm-2']]);
});

test('the site frame turns with the street, and wall axes follow a turned building', () => {
  const origin = { lat: 34, lon: -118 };
  const fr = siteFrame(origin, [0, 1]); // the street is to the south: right is east
  const [u, v] = fr.toUV(frame(origin).toLL([3.048, 6.096]));
  assert.ok(Math.abs(u - 10) < 1e-6 && Math.abs(v - 20) < 1e-6);
  const back = fr.toLL([10, 20]);
  assert.ok(Math.abs(back.lat - frame(origin).toLL([3.048, 6.096]).lat) < 1e-9);
  const t = Math.PI / 6, rot = ([x, y]) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];
  const axes = wallAxes([[0, 0], [20, 0], [20, 10], [0, 10]].map(rot));
  assert.ok(axes.some((a) => Math.abs(a[0] - Math.cos(t)) < 1e-6 && Math.abs(a[1] - Math.sin(t)) < 1e-6));
});

test('each candidate is described from its street: which side, how wide across the front and how deep', () => {
  const origin = { lat: 34, lon: -118 }, { toXY, toLL } = frame(origin);
  // a street running east-west 30 m south of the point; a house north of it, 20 m wide and 30 m deep
  const street = { name: 'Elm Street', line: [[-200, -30], [200, -30]] };
  const ring = [[40, -15], [60, -15], [60, 15], [40, 15]].map(toLL);
  const [c] = facingStreets(numberCandidates(mergeBuildings([{ id: 'usa-1', ring, heightFt: 14 }], [], toXY)), [street]);
  assert.deepEqual(c.facing, { street: 'Elm Street', side: 'north', widthFt: 66, depthFt: 98, setbackFt: 49 });
  assert.match(candidateLine(c), /^1\. on the north side of Elm Street, about 66 ft across the front and 98 ft deep, 49 ft back from the street's centre line; about 6460 sq ft outline, about 14 ft tall; 50 m east of the red dot$/);
});

test('the site report page escapes what Claude and the records wrote, and shows each stage with its pictures', () => {
  const { siteReportHtml } = require('../src/server/sitereport');
  const html = siteReportHtml({ address: '5 Elm St <b>', seconds: 300, stages: [
    { id: 'pick', title: 'Which building is the house', summary: 'Picked 3 <script>alert(1)</script>', details: ['a & b'], usd: 0.16, secs: 61,
      thoughts: ['looked at "3"'], images: [{ name: 'closeup-3', label: 'Close-up of 3', mediaType: 'image/jpeg', data: 'AAAA' }] }] }, { costUsd: 2.5 });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /Picked 3 &lt;script&gt;/);
  assert.match(html, /5 Elm St &lt;b&gt; · 5 min · \$2\.50 of API time/);
  assert.match(html, /<img src="data:image\/jpeg;base64,AAAA" alt="Close-up of 3"/);
  assert.match(html, /at 1:01 · \$0\.16/);
  assert.match(html, /looked at &quot;3&quot;/);
});

test('streets come from Census TIGER: named, nearest first, the pieces of a street kept apart', async () => {
  const origin = { lat: 34, lon: -118 }, { toLL } = frame(origin);
  const path = (pts) => pts.map((p) => { const ll = toLL(p); return [ll.lon, ll.lat]; });
  const features = [
    { attributes: { NAME: 'E Brisbane St' }, geometry: { paths: [path([[-100, -30], [0, -30]])] } },
    { attributes: { NAME: 'E Brisbane St' }, geometry: { paths: [path([[20, -35], [120, -35]])] } }, // the next block, a little off line
    { attributes: { NAME: 'S Myrtle Ave' }, geometry: { paths: [path([[150, -200], [150, 200]])] } },
    { attributes: { NAME: '' }, geometry: { paths: [path([[0, 5], [10, 5]])] } },
  ];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ features }) });
  const streets = await tigerStreets(origin, 170, { fetchImpl });
  assert.deepEqual(streets.map((x) => [x.name, Math.round(x.distanceM)]), [['E Brisbane St', 30], ['S Myrtle Ave', 150]]);
  const { nearestOnLine } = require('../src/server/terrain');
  // no made-up segment joins the two blocks: the gap between x = 0 and x = 20 is not part of the street
  assert.ok(nearestOnLine([10, -32], streets[0].line).d > 2);
  assert.ok(sameStreet('East Brisbane Street', 'brisbane street') && sameStreet('E Brisbane St', 'Brisbane St'));
  assert.ok(!sameStreet('E Andre St', 'Brisbane St'));
});
