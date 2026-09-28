#!/usr/bin/env node
// A quick first look at the photos before designing: what they show, and questions about what
// they leave open (plus landscaping style), each with a recommended answer. Cheap by default.
//   node scripts/survey.js front.jpg side.jpg [--plan plan.png] [--notes "..."] --out survey.json
//   Options: --model claude-opus-5-5 (or a cheaper one)  --effort low|medium  --fake
//            --address "..."  add the street and slope from USGS elevations and OpenStreetMap to the notes
// Edit "answers" in the saved file (question id -> option id, or your own words), then:
//   node scripts/design.js front.jpg side.jpg --choices survey.json [--answer landscape=drought]
const fs = require('node:fs');
const path = require('node:path');
const { surveyHouse } = require('../src/server/designer');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const flag = (name) => { const i = args.indexOf('--' + name); if (i >= 0) { args.splice(i, 1); return true; } return false; };
const address = opt('address', null);
let notes = opt('notes', '');
const out = opt('out', 'survey.json'), planFile = opt('plan', null);
const model = opt('model', process.env.BRICKHOUSE_SURVEY_MODEL || process.env.BRICKHOUSE_MODEL || 'claude-opus-5-5');
const effort = opt('effort', process.env.BRICKHOUSE_SURVEY_EFFORT || 'low');
const fake = flag('fake');
const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const readImage = (f) => {
  const t = types[path.extname(f).toLowerCase()]; if (!t) throw new Error(`Unsupported image type: ${f}`);
  return { mediaType: t, data: fs.readFileSync(f).toString('base64') };
};

// --address: geocode it and add the street and slope (USGS elevations, OpenStreetMap streets) to the notes.
async function addTerrain() {
  if (!address) return;
  const place = await require('../src/server/lookup').geocode(address);
  if (!place) { console.log(`Terrain skipped: ${address} not found.`); return; }
  try {
    const t = await require('../src/server/terrain').lookupTerrain(place, address);
    notes = [notes, `Address: ${place.label}.`, t.note].filter(Boolean).join(' ');
    if (t.note) console.log(t.note);
  } catch (e) { console.log(`Terrain skipped: ${e.message}`); }
}

(async () => {
  await addTerrain();
  const client = fake ? require('../src/server/fakeClient').makeFakeClient({ delayMs: 50 }) : require('../src/server/client').makeAnthropicClient();
  if (!client) { console.error('Set BRICKHOUSE_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY (or pass --fake).'); process.exit(2); }
  const t0 = Date.now();
  const sv = await surveyHouse({ client, model, effort, photos: args.map(readImage), plan: planFile ? readImage(planFile) : null, notes,
    onEvent: (ev) => { if (ev.type === 'thought') console.log(`  thinking: ${ev.text.replace(/\s+/g, ' ').slice(0, 300)}`); } });
  console.log(`${sv.summary}\n`);
  sv.seen.forEach((s) => console.log(`  seen: ${s}`));
  for (const q of sv.questions) {
    console.log(`\n${q.id}: ${q.question}${q.why ? `\n  (${q.why})` : ''}`);
    q.options.forEach((o) => console.log(`  ${o.id === q.recommended ? '*' : ' '} ${o.id}: ${o.label}${o.detail ? ' - ' + o.detail : ''}`));
  }
  const u = sv.usage;
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)} s (${model}, effort ${effort}). Tokens: ${u.input} input, ${u.cacheWrite} cache write, ${u.output} output`);
  fs.writeFileSync(out, JSON.stringify({ ...sv, answers: Object.fromEntries(sv.questions.map((q) => [q.id, q.recommended])) }, null, 2));
  console.log(`Saved ${out}; * marks the recommended answers, which are filled in as "answers".`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
