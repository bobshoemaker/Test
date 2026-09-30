#!/usr/bin/env node
// Photos to design from the command line, using the same loop as the server.
//   node scripts/design.js front.jpg side.jpg --notes "garage on the right" --target 1200 --out designs/my-house.json
//   Options: --model claude-opus-5-5  --effort high|xhigh|max  --max-tokens 128000  --fake (scripted Claude, no key)
//            --parts  build in five turns (walls, roofs, site, planting, details); saves each compiled draft next to --out
//            --plan floorplan.png  the listing's floor plan; with --parts, Claude reads the footprint off it first
//                                  and the walls are locked to it (saved as <out>.footprint.json)
//            --footprint <out>.footprint.json  reuse a saved footprint instead of reading the plan again
//            --no-footprint  send the plan as a picture only, without locking the walls to it
//            --resume <draft>.json --from-part 2  continue from a design whose earlier parts are done
//            --address "..."  add the street and slope from USGS elevations and OpenStreetMap to the notes; with
//                             --parts and no --plan, the house is found on an aerial photo and mapped from above,
//                             and the walls are locked to that map (src/server/site.js; the report, its pictures
//                             and each stage's cost are saved as <out>.site.json and <out>.site-*.jpg)
//            --views front,right,back  which view each photo shows (front, left, right, back; blank for extras)
//            --site-model <model>  a stronger model for mapping the house (falls back to --model)
//            --no-site  skip the aerial mapping; lock the walls to the building outline instead, when there is one
//            --budget 15  stop at this many dollars of API time (site step included), keeping the last draft
//            --require-site  stop if the aerial mapping fails, instead of designing from the outline or the photos
//            --front-street "Wood Terrace"  on a corner lot, the street that goes at the front (z = 31)
//            --plate 48  the Grand: 48 x 48 baseplate at 1.5 ft per stud, about 2,400 pieces
//            --plate 16  the Mini: 16 x 16 plate at 4 ft per stud, about 250 to 450 pieces
//            --choices survey.json [--answer id=option ...]  the owner's answers from scripts/survey.js
//            --parts-limit 1  stop after the first N parts   --no-render  don't send renders of each draft
const fs = require('node:fs');
const path = require('node:path');
const { designHouse, resolveChoices } = require('../src/server/designer');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const flag = (name) => { const i = args.indexOf('--' + name); if (i >= 0) { args.splice(i, 1); return true; } return false; };
const address = opt('address', null), frontStreet = opt('front-street', null);
let notes = opt('notes', '');
const plateSize = Number(opt('plate', 32));
const target = Number(opt('target', require('../src/server/scale').scaleFor(plateSize).target)), out = opt('out', null);
const model = opt('model', process.env.BRICKHOUSE_MODEL || 'claude-opus-5-5'), effort = opt('effort', process.env.BRICKHOUSE_EFFORT || null);
const maxTokens = Number(opt('max-tokens', 64000));
const partsLimit = Number(opt('parts-limit', 5)), planFile = opt('plan', null), footprintFile = opt('footprint', null);
const choicesFile = opt('choices', null), answerArgs = [];
for (let i; (i = args.indexOf('--answer')) >= 0;) answerArgs.push(args.splice(i, 2)[1]);
const resumeFile = opt('resume', null), fromPart = Number(opt('from-part', resumeFile ? 2 : 1));
const views = String(opt('views', '')).split(',').map((v) => v.trim() || null), siteModel = opt('site-model', process.env.BRICKHOUSE_SITE_MODEL || null);
const budget = Number(opt('budget', 0)) || null;
const fake = flag('fake'), parts = flag('parts'), noRender = flag('no-render'), noFootprint = flag('no-footprint'), noSite = flag('no-site'), requireSite = flag('require-site');
const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const readImage = (f) => {
  const t = types[path.extname(f).toLowerCase()]; if (!t) throw new Error(`Unsupported image type: ${f}`);
  return { mediaType: t, data: fs.readFileSync(f).toString('base64') };
};
const photos = args.map(readImage), plan = planFile ? readImage(planFile) : null;

(async () => {
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
  // what happened, for a report: the site's stages, each part, each draft, the cost
  const run = { address, plate: plateSize, model, siteModel: siteModel || model, effort, started: new Date().toISOString(), site: null, parts: [], drafts: [] };
  const saveRun = () => fs.writeFileSync(`${base}.run.json`, JSON.stringify(run, null, 2));
  const log = (ev) => {
    if (ev.type === 'status') console.log(`${clock()} ${ev.message}`);
    if (ev.type === 'progress') console.log(`${clock()}   ...${ev.block === 'tool_use' ? 'writing' : ev.block === 'text' ? 'replying' : ev.block === 'thinking' ? 'thinking' : 'waiting for the model'} (${ev.secs} s into this turn)`);
    if (ev.type === 'thought') console.log(`${clock()}   thinking: ${ev.text.replace(/\s+/g, ' ').slice(0, 400)}`);
    if (ev.type === 'site') {
      const st = ev.stage;
      console.log(`\n${clock()} === ${st.title} ===\n${st.summary}`);
      (st.details || []).forEach((d) => console.log(`  - ${d}`));
      if (st.usd != null) console.log(`  cost: $${st.usd.toFixed(2)}`);
      (st.images || []).forEach((im) => { const f = `${base}.site-${im.name}.jpg`; fs.writeFileSync(f, Buffer.from(im.data, 'base64')); console.log(`  picture -> ${f}`); });
    }
  };
  // The same preparation as the server: address to terrain note; the house found and mapped from above and the
  // walls locked to the map (or to the building outline) when there's no plan (src/server/pipeline.js).
  const prep = await require('../src/server/pipeline').prepareDesign({ address, notes, plan, plate: plateSize, frontStreet,
    lockToOutline: parts && !noFootprint && !footprintFile, photos: parts && !noSite && !fake ? photos : [], views, client, model, siteModel,
    tools: renderer, onEvent: log });
  notes = prep.notes;
  prep.log.forEach((l) => console.log(l));
  if (requireSite && !prep.site) { console.error('The site mapping did not finish (see above); stopping before the design.'); if (renderer) await renderer.close(); process.exit(3); }
  if (prep.terrain && prep.terrain.note) console.log(prep.terrain.note);
  if (prep.report) {
    const { stages, ...rest } = prep.report;
    run.site = { ...rest, stages: stages.map(({ images = [], ...st }) => ({ ...st, images: images.map((im) => ({ name: im.name, label: im.label, file: `${path.basename(base)}.site-${im.name}.jpg` })) })),
      fit: prep.site.fit, costUsd: prep.site.costUsd, credits: prep.site.credits, note: prep.site.note };
    fs.writeFileSync(`${base}.site.json`, JSON.stringify({ ...prep.site, images: undefined }, null, 2));
    (prep.site.images || []).forEach((im, i) => fs.writeFileSync(`${base}.site-design-${i + 1}.jpg`, Buffer.from(im.data, 'base64')));
    console.log(`${clock()} Site mapped at ${prep.site.ftPerStud} ft per stud for $${prep.site.costUsd.toFixed(2)} -> ${base}.site.json`);
    saveRun();
  }
  const locked = footprintFile ? JSON.parse(fs.readFileSync(footprintFile, 'utf8')) : prep.locked;
  if (prep.locked && !footprintFile) {
    prep.locked.blocks.forEach((b) => console.log(`  ${b.name} (${b.levels} level${b.levels > 1 ? 's' : ''}): studs ${JSON.stringify(b.cellRects)}`));
    fs.writeFileSync(`${base}.footprint.json`, JSON.stringify(prep.locked, null, 2));
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
    ...(prep.site && !footprintFile ? { ftPerStud: prep.site.ftPerStud, siteImages: prep.site.images, siteNote: prep.site.note } : {}),
    budgetUsd: budget, spentUsd: prep.site ? prep.site.costUsd : 0,
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
      if (ev.type === 'status' || ev.type === 'progress' || ev.type === 'thought') log(ev);
      if (ev.type === 'thought' && run.parts.length) (run.parts[run.parts.length - 1].thoughts = run.parts[run.parts.length - 1].thoughts || []).push(ev.text);
      if (ev.type === 'part') { console.log(`\n${clock()} === Part ${ev.n} of ${ev.of}: ${ev.name} ===`); run.parts.push({ n: ev.n, name: ev.name, started: Math.round((Date.now() - t0) / 1000) }); }
      if (ev.type === 'draft') {
        run.drafts.push({ n: ev.n, part: ev.part, pieces: ev.stats.pieces, errors: ev.errors, warnings: ev.warnings, problems: ev.problems, renders: (ev.renders || []).length });
        const file = `${base}.draft-${ev.n}.json`;
        fs.writeFileSync(file, JSON.stringify(ev.design, null, 2));
        console.log(`${clock()}   draft ${ev.n}${ev.part ? ' (' + ev.part + ')' : ''}: ${ev.stats.pieces} pieces, ${ev.errors} errors, ${ev.warnings} warnings -> ${file}`);
        ev.problems.slice(0, 5).forEach((p) => console.log(`${clock()}     ${p}`));
        const views = ['front', 'three-quarter', 'back-left', 'back-right'];
        (ev.renders || []).forEach((r, i) => fs.writeFileSync(`${base}.draft-${ev.n}-${views[i] || i}.png`, Buffer.from(r.data, 'base64')));
        if ((ev.renders || []).length) console.log(`${clock()}   renders -> ${base}.draft-${ev.n}-{${views.slice(0, ev.renders.length).join(',')}}.png`);
      }
      if (ev.type === 'partDone') {
        const usd = require('../src/server/cost').costOf(ev.usage, model);
        console.log(`${clock()} Part ${ev.n} done${ev.summary ? ': ' + ev.summary : ''} (${ev.usage.output} output tokens, $${usd.toFixed(2)} so far)`);
        const p = run.parts[run.parts.length - 1];
        if (p) Object.assign(p, { summary: ev.summary, stats: ev.stats && { pieces: ev.stats.pieces, steps: ev.stats.steps }, usdSoFar: usd, secs: Math.round((Date.now() - t0) / 1000) - p.started });
        saveRun();
      }
    } }).finally(() => renderer && renderer.close());
  const s = res.result.stats;
  console.log(`Done in ${Math.round((Date.now() - t0) / 1000)} s: ${s.pieces} pieces, ${res.result.errors.length + (res.planProblems || []).length} errors, ${res.result.warnings.length} warnings${res.note ? ' (' + res.note + ')' : ''}`);
  if (res.planProblems && res.planProblems.length) res.planProblems.forEach((p) => console.log(`  ${p}`));
  const u = res.usage;
  if (u) console.log(`Tokens: ${u.input} input, ${u.cacheRead} cache read, ${u.cacheWrite} cache write, ${u.output} output`);
  const siteUsd = prep.site ? prep.site.costUsd : 0;
  console.log(`Cost: $${(siteUsd + res.costUsd).toFixed(2)} (site $${siteUsd.toFixed(2)}, design $${res.costUsd.toFixed(2)})`);
  if (prep.site && prep.site.credits) res.design.mapCredits = prep.site.credits;
  const file = out || `designs/generated/${(res.design.name || 'house').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  fs.writeFileSync(file, JSON.stringify(res.design, null, 2));
  Object.assign(run, { seconds: Math.round((Date.now() - t0) / 1000), final: { file, stats: { pieces: s.pieces, steps: s.steps, lots: s.lots, ftPerStud: s.ftPerStud },
    errors: res.result.errors.length + (res.planProblems || []).length, warnings: res.result.warnings.length, note: res.note || null, problems: [...(res.planProblems || []), ...res.result.errors.map((e) => e.msg), ...res.result.warnings.map((w) => w.msg)].slice(0, 20) },
    usage: u, costUsd: { site: siteUsd, design: res.costUsd, total: siteUsd + res.costUsd } });
  saveRun();
  console.log(`Saved ${file} (run log ${base}.run.json)`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
