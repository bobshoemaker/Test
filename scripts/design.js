#!/usr/bin/env node
// Photos to design from the command line, using the same loop as the server.
//   node scripts/design.js front.jpg side.jpg --notes "garage on the right" --target 1200 --out designs/my-house.json
//   Options: --model claude-opus-5-5  --effort high|xhigh|max  --max-tokens 128000  --fake (scripted Claude, no key)
//            --parts  build in four turns (walls, roofs, site, planting); saves each compiled draft next to --out
//            --plan floorplan.png  the listing's floor plan; with --parts, Claude reads the footprint off it first
//                                  and the walls are locked to it (saved as <out>.footprint.json)
//            --footprint <out>.footprint.json  reuse a saved footprint instead of reading the plan again
//            --no-footprint  send the plan as a picture only, without locking the walls to it
//            --resume <draft>.json --from-part 2  continue from a design whose earlier parts are done
//            --address "..."  add the street and slope from USGS elevations and OpenStreetMap to the notes; with
//                             --parts and no --plan, the walls are locked to the house's building outline
//            --front-street "Wood Terrace"  on a corner lot, the street that goes at the front (z = 31)
//            --plate 48  the larger model: 48 x 48 baseplate at 1.5 ft per stud, about 2,400 pieces
//            --choices survey.json [--answer id=option ...]  the owner's answers from scripts/survey.js
//            --parts-limit 1  stop after the first N parts   --no-render  don't send renders of each draft
const fs = require('node:fs');
const path = require('node:path');
const { designHouse, resolveChoices } = require('../src/server/designer');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const flag = (name) => { const i = args.indexOf('--' + name); if (i >= 0) { args.splice(i, 1); return true; } return false; };
const address = opt('address', null), frontStreet = opt('front-street', null);
let terrain = null;
let notes = opt('notes', '');
const plateSize = Number(opt('plate', 32));
const target = Number(opt('target', require('../src/server/scale').scaleFor(plateSize).target)), out = opt('out', null);
const model = opt('model', process.env.BRICKHOUSE_MODEL || 'claude-opus-5-5'), effort = opt('effort', process.env.BRICKHOUSE_EFFORT || null);
const maxTokens = Number(opt('max-tokens', 64000));
const partsLimit = Number(opt('parts-limit', 4)), planFile = opt('plan', null), footprintFile = opt('footprint', null);
const choicesFile = opt('choices', null), answerArgs = [];
for (let i; (i = args.indexOf('--answer')) >= 0;) answerArgs.push(args.splice(i, 2)[1]);
const resumeFile = opt('resume', null), fromPart = Number(opt('from-part', resumeFile ? 2 : 1));
const fake = flag('fake'), parts = flag('parts'), noRender = flag('no-render'), noFootprint = flag('no-footprint');
const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const readImage = (f) => {
  const t = types[path.extname(f).toLowerCase()]; if (!t) throw new Error(`Unsupported image type: ${f}`);
  return { mediaType: t, data: fs.readFileSync(f).toString('base64') };
};
const photos = args.map(readImage), plan = planFile ? readImage(planFile) : null;

// --address: geocode it and add the street and slope (USGS elevations, OpenStreetMap streets) to the notes.
async function addTerrain() {
  if (!address) return;
  const place = await require('../src/server/lookup').geocode(address);
  if (!place) { console.log(`Terrain skipped: ${address} not found.`); return; }
  try {
    const t = await require('../src/server/terrain').lookupTerrain(place, address, { plate: plateSize });
    terrain = t;
    notes = [notes, `Address: ${place.label}.`, t.note].filter(Boolean).join(' ');
    if (t.note) console.log(t.note);
  } catch (e) { console.log(`Terrain skipped: ${e.message}`); }
}

(async () => {
  await addTerrain();
  let client;
  if (fake) client = require('../src/server/fakeClient').makeFakeClient({ delayMs: 50 });
  else {
    client = require('../src/server/client').makeAnthropicClient();
    if (!client) { console.error('Set BRICKHOUSE_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY (or pass --fake).'); process.exit(2); }
  }
  const t0 = Date.now(), clock = () => `[${Math.floor((Date.now() - t0) / 60000)}:${String(Math.floor((Date.now() - t0) / 1000) % 60).padStart(2, '0')}]`;
  const base = (out || 'designs/generated/house.json').replace(/\.json$/, '');
  const renderer = noRender ? null : await require('../src/server/render').makeRenderer().catch((e) => { console.log(`Renders off: ${e.message}`); return null; });
  if (!noRender && !renderer) console.log('Renders off: Playwright is not installed.');
  let locked = footprintFile ? JSON.parse(fs.readFileSync(footprintFile, 'utf8')) : null;
  // No plan: lock the walls to the house's building outline, when the address lookup found one.
  if (!locked && parts && !plan && !noFootprint && terrain) {
    const input = require('../src/server/terrain').outlineInput(terrain, { frontStreet });
    if (input) {
      const sc = require('../src/server/scale').scaleFor(plateSize);
      locked = require('../src/server/footprint').footprintFromOutline({ ...input, size: sc.size, ftPerStud: sc.ftPerStud, frontYard: sc.frontYard });
      console.log(`Walls locked to the building outline, ${input.front} at the front${input.side ? `, ${input.side} on the ${locked.sideStreet ? locked.sideStreet.side : '?'}` : ''}:`);
      locked.blocks.forEach((b) => console.log(`  ${b.name} (${b.levels} level${b.levels > 1 ? 's' : ''}): studs ${JSON.stringify(b.cellRects)}`));
      locked.problems.forEach((p) => console.log(`  problem: ${p}`));
      fs.writeFileSync(`${base}.footprint.json`, JSON.stringify(locked, null, 2));
    } else console.log('No building outline found; the walls are not locked.');
  }
  let choices = null;
  if (choicesFile) {
    const sv = JSON.parse(fs.readFileSync(choicesFile, 'utf8'));
    const answers = { ...(sv.answers || {}) };
    for (const a of answerArgs) { const i = a.indexOf('='); if (i > 0) answers[a.slice(0, i)] = a.slice(i + 1); }
    choices = resolveChoices(sv.questions, answers);
    choices.forEach((c) => console.log(`Choice: ${c.question} ${c.answer}`));
  }
  const res = await designHouse({ client, model, effort, maxTokens, photos, plan, notes, target, mode: parts ? 'parts' : 'design', partsLimit, plate: plateSize,
    render: renderer && renderer.render, planTools: renderer, lockFootprint: !noFootprint, locked,
    seed: resumeFile ? JSON.parse(fs.readFileSync(resumeFile, 'utf8')) : null, fromPart, choices,
    onEvent: (ev) => {
      if (ev.type === 'footprint') {
        console.log(`${clock()}   footprint ${ev.n}: scale ${ev.locked.scale ? ev.locked.scale.pxPerFt + ' px per ft' : 'unknown'}, street on the ${ev.locked.street || '?'} side of the plan`);
        (ev.locked.blocks || []).forEach((b) => console.log(`${clock()}     ${b.name} (${b.levels} level${b.levels > 1 ? 's' : ''}): studs ${JSON.stringify(b.cellRects)}${b.openings.length ? '; ' + b.openings.map((o) => `${o.kind} on the ${o.side} wall`).join(', ') : ''}`));
        ev.problems.forEach((p) => console.log(`${clock()}     problem: ${p}`));
        if (ev.overlay) { fs.writeFileSync(`${base}.footprint-${ev.n}.png`, Buffer.from(ev.overlay, 'base64')); console.log(`${clock()}   overlay -> ${base}.footprint-${ev.n}.png`); }
      }
      if (ev.type === 'footprintDone') {
        fs.writeFileSync(`${base}.footprint.json`, JSON.stringify(ev.locked, null, 2));
        console.log(`${clock()} Footprint locked -> ${base}.footprint.json (${ev.usage.output} output tokens so far)`);
      }
      if (ev.type === 'status') console.log(`${clock()} ${ev.message}`);
      if (ev.type === 'part') console.log(`\n${clock()} === Part ${ev.n} of ${ev.of}: ${ev.name} ===`);
      if (ev.type === 'progress') console.log(`${clock()}   ...${ev.block === 'tool_use' ? 'writing the design' : ev.block === 'text' ? 'replying' : ev.block === 'thinking' ? 'thinking' : 'waiting for the model'} (${ev.secs} s into this turn)`);
      if (ev.type === 'thought') console.log(`${clock()}   thinking: ${ev.text.replace(/\s+/g, ' ').slice(0, 400)}`);
      if (ev.type === 'draft') {
        const file = `${base}.draft-${ev.n}.json`;
        fs.writeFileSync(file, JSON.stringify(ev.design, null, 2));
        console.log(`${clock()}   draft ${ev.n}${ev.part ? ' (' + ev.part + ')' : ''}: ${ev.stats.pieces} pieces, ${ev.errors} errors, ${ev.warnings} warnings -> ${file}`);
        ev.problems.slice(0, 5).forEach((p) => console.log(`${clock()}     ${p}`));
        (ev.renders || []).forEach((r, i) => fs.writeFileSync(`${base}.draft-${ev.n}-${i ? 'three-quarter' : 'front'}.png`, Buffer.from(r.data, 'base64')));
        if ((ev.renders || []).length) console.log(`${clock()}   renders -> ${base}.draft-${ev.n}-front.png, -three-quarter.png`);
      }
      if (ev.type === 'partDone') console.log(`${clock()} Part ${ev.n} done${ev.summary ? ': ' + ev.summary : ''} (${ev.usage.output} output tokens so far)`);
    } }).finally(() => renderer && renderer.close());
  const s = res.result.stats;
  console.log(`Done in ${Math.round((Date.now() - t0) / 1000)} s: ${s.pieces} pieces, ${res.result.errors.length + (res.planProblems || []).length} errors, ${res.result.warnings.length} warnings${res.note ? ' (' + res.note + ')' : ''}`);
  if (res.planProblems && res.planProblems.length) res.planProblems.forEach((p) => console.log(`  ${p}`));
  const u = res.usage;
  if (u) console.log(`Tokens: ${u.input} input, ${u.cacheRead} cache read, ${u.cacheWrite} cache write, ${u.output} output`);
  const file = out || `designs/generated/${(res.design.name || 'house').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  fs.writeFileSync(file, JSON.stringify(res.design, null, 2));
  console.log(`Saved ${file}`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
