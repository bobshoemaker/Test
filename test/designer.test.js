// The Claude loop, driven by a scripted client: draft with an error, then a fixed final design.
const test = require('node:test');
const assert = require('node:assert/strict');
const { designHouse, extractJson, surveyHouse, resolveChoices } = require('../src/server/designer');
const { makeFakeClient } = require('../src/server/fakeClient');

test('the loop compiles drafts, reports errors to Claude, and returns a clean design', async () => {
  const client = makeFakeClient({ delayMs: 0 });
  const seen = [];
  const sent = [], sentParams = [];
  const create = client.messages.create.bind(client.messages);
  client.messages.create = async (params) => { sentParams.push(params); sent.push(JSON.parse(JSON.stringify(params.messages))); return create(params); };
  const out = await designHouse({
    client, model: 'fake', photos: [{ mediaType: 'image/jpeg', data: 'AAAA' }], target: 800,
    onEvent: (ev) => seen.push(ev),
  });
  assert.equal(out.compiles, 1);
  assert.equal(out.result.errors.length, 0);
  assert.equal(out.result.warnings.length, 0);
  const draft = seen.find((e) => e.type === 'draft');
  assert.ok(draft && draft.errors > 0, 'the first draft should carry the deliberate collision');
  // Round 2 must include the assistant turn (with its thinking block) and the tool result.
  const round2 = sent[1];
  assert.equal(round2[1].role, 'assistant');
  assert.equal(round2[1].content[0].type, 'thinking');
  const toolResult = round2[2].content[0];
  assert.equal(toolResult.type, 'tool_result');
  assert.match(toolResult.content, /collides/);
  // The first request carries the photo and the task.
  assert.equal(sent[0][0].content[0].type, 'image');
  assert.match(sent[0][0].content.at(-1).text, /Aim for about 800 pieces/);
  // Every round asks for automatic caching and leaves room for long thinking.
  for (const p of sentParams) { assert.deepEqual(p.cache_control, { type: 'ephemeral' }); assert.equal(p.max_tokens, 64000); }
});

test('parts mode builds in five appended turns and reports each part', async () => {
  const client = makeFakeClient({ delayMs: 0 });
  const sent = [];
  const create = client.messages.create.bind(client.messages);
  client.messages.create = async (params) => { sent.push(JSON.parse(JSON.stringify(params.messages))); return create(params); };
  const seen = [];
  const out = await designHouse({ client, model: 'fake', mode: 'parts', photos: [{ mediaType: 'image/jpeg', data: 'AAAA' }], onEvent: (ev) => seen.push(ev) });
  assert.deepEqual(seen.filter((e) => e.type === 'part').map((e) => e.name), ['Walls', 'Roofs', 'Site', 'Planting', 'Details']);
  assert.equal(seen.filter((e) => e.type === 'partDone').length, 5);
  assert.equal(seen.find((e) => e.type === 'draft').part, 'Walls');
  assert.match(sent[0][0].content.at(-1).text, /PART 1 OF 5, WALLS/);
  // Each part's request extends the previous one; nothing earlier is edited.
  for (let i = 1; i < sent.length; i++) assert.deepEqual(sent[i].slice(0, sent[i - 1].length), sent[i - 1]);
  assert.match(sent.at(-1).at(-1).content[0].text, /PART 5 OF 5/);
  assert.equal(out.result.errors.length, 0);
});

test('each compile result carries renders of the draft when a renderer is given', async () => {
  const client = makeFakeClient({ delayMs: 0 });
  const sent = [];
  const create = client.messages.create.bind(client.messages);
  client.messages.create = async (params) => { sent.push(JSON.parse(JSON.stringify(params.messages))); return create(params); };
  const render = async () => [{ label: 'front', data: 'PNG1' }, { label: 'three-quarter', data: 'PNG2' }];
  let drafted = null;
  await designHouse({ client, model: 'fake', mode: 'parts', partsLimit: 1, render, photos: [{ mediaType: 'image/jpeg', data: 'AAAA' }],
    onEvent: (ev) => { if (ev.type === 'draft') drafted = ev; } });
  const result = sent[1].at(-1).content[0];
  assert.equal(result.type, 'tool_result');
  assert.deepEqual(result.content.filter((b) => b.type === 'image').map((b) => b.source.data), ['PNG1', 'PNG2']);
  assert.equal(drafted.renders.length, 2);
  assert.equal(sent.length, 2, 'partsLimit 1 stops after the first part');
});

test('a floor plan goes after the photos and the task explains it', async () => {
  const client = makeFakeClient({ delayMs: 0 });
  const sent = [];
  const create = client.messages.create.bind(client.messages);
  client.messages.create = async (params) => { sent.push(JSON.parse(JSON.stringify(params.messages))); return create(params); };
  await designHouse({ client, model: 'fake', mode: 'parts', partsLimit: 1, lockFootprint: false, photos: [{ mediaType: 'image/jpeg', data: 'PHOTO' }], plan: { mediaType: 'image/png', data: 'PLAN' } });
  const first = sent[0][0].content;
  assert.deepEqual(first.filter((b) => b.type === 'image').map((b) => b.source.data), ['PHOTO', 'PLAN']);
  assert.match(first.at(-1).text, /1 attached photo using|1 attached photo\./);
  assert.match(first.at(-1).text, /FLOOR PLAN\. The last image/);
});

test('with a plan, parts mode reads the footprint first and holds every draft to it', async () => {
  const { layoutFootprint, skeletonOps } = require('../src/server/footprint');
  const footprint = {
    street: 'S',
    rooms: [{ name: 'Living', label: '14 X 20', rectPx: [100, 200, 240, 400] }, { name: 'Bed', label: '10 x 10', rectPx: [0, 100, 100, 200] }],
    blocks: [{ name: 'Wing', levels: 2, rectsPx: [[0, 100, 100, 200]] }, { name: 'House', levels: 1, rectsPx: [[100, 100, 200, 400]] }],
    openings: [{ block: 'Wing', kind: 'garage door', atPx: [50, 200], widthFt: 8 }],
  };
  const ops = skeletonOps(layoutFootprint(footprint));
  ops[1].segments[0][0] += 1; // Claude nudges a locked wall
  const replies = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'submit_footprint', input: footprint }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'The footprint matches the plan.' }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'compile_design', input: { design: { name: 'x', phases: ops.map((o) => o.phase), ops } } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Walls done.' }] },
  ];
  const sent = [];
  const client = { messages: { create: async (params) => { sent.push(JSON.parse(JSON.stringify(params))); return { role: 'assistant', ...replies[sent.length - 1] }; } } };
  const seen = [];
  const out = await designHouse({ client, model: 'fake', mode: 'parts', partsLimit: 1, photos: [{ mediaType: 'image/jpeg', data: 'PHOTO' }],
    plan: { mediaType: 'image/png', data: 'PLAN' }, onEvent: (ev) => seen.push(ev) });
  assert.equal(sent[0].tools[0].name, 'submit_footprint');
  assert.ok(seen.some((e) => e.type === 'footprintDone'));
  assert.match(sent[2].messages[0].content.at(-1).text, /LOCKED WALLS FROM THE FLOOR PLAN/);
  const result = JSON.parse(sent[3].messages.at(-1).content[0].content);
  assert.match(result.problems[0], /Floor plan \(op 1\): the House walls must keep the locked segments/);
  assert.ok(out.planProblems.length > 0);
});

test('parts mode can resume at a later part from an earlier design', async () => {
  const client = makeFakeClient({ delayMs: 0 });
  const sent = [];
  const create = client.messages.create.bind(client.messages);
  client.messages.create = async (params) => { sent.push(JSON.parse(JSON.stringify(params.messages))); return create(params); };
  const seed = JSON.parse(require('../src/server/prompt').example());
  const seen = [];
  await designHouse({ client, model: 'fake', mode: 'parts', seed, fromPart: 2, photos: [{ mediaType: 'image/jpeg', data: 'AAAA' }], onEvent: (ev) => seen.push(ev) });
  assert.deepEqual(seen.filter((e) => e.type === 'part').map((e) => e.name), ['Roofs', 'Site', 'Planting', 'Details']);
  const first = sent[0][0].content.at(-1).text;
  assert.match(first, /THE DESIGN SO FAR\. Parts 1 to 1 are done/);
  assert.match(first, /PART 2 OF 5, ROOFS/);
  await assert.rejects(designHouse({ client, model: 'fake', mode: 'parts', fromPart: 2, photos: [{ mediaType: 'image/jpeg', data: 'AAAA' }] }), /needs the design/);
});

test('the survey asks about what the photos leave open, always adds landscaping, and sends at low effort', async () => {
  const sent = [];
  const input = {
    summary: 'Stucco house.', seen: ['Flat roof edge'], landscapeSeen: 'olive trees and agaves.',
    questions: [
      { id: 'roof', topic: 'roof', question: 'Flat or sloped roof?', why: 'Parapet hides it.', recommended: 'nope',
        options: [{ id: 'flat', label: 'Flat, tile caps' }, { id: 'tile', label: 'Low tile hip roof' }] },
      { id: 'bad', topic: 'other', question: 'Only one option', options: [{ id: 'x', label: 'X' }], recommended: 'x' },
    ],
  };
  const client = { messages: { create: async (p) => { sent.push(p); return { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 's', name: 'submit_survey', input }] }; } } };
  const out = await surveyHouse({ client, model: 'fake', photos: [{ mediaType: 'image/jpeg', data: 'A' }] });
  assert.deepEqual(sent[0].output_config, { effort: 'low' });
  assert.deepEqual(out.questions.map((q) => q.id), ['roof', 'landscape'], 'a question with one option is dropped');
  assert.equal(out.questions[0].recommended, 'flat', 'an unknown recommendation falls back to the first option');
  assert.match(out.questions[1].options[0].detail, /olive trees and agaves/);
  const choices = resolveChoices(out.questions, { landscape: 'drought' });
  assert.deepEqual(choices.map((c) => c.answer), ['Flat, tile caps', 'Drought-tolerant']);
  assert.equal(resolveChoices(out.questions, { roof: 'Tile, but only on the back half' })[0].answer, 'Tile, but only on the back half');
});

test('the owner\'s choices go into the design task as binding', async () => {
  const client = makeFakeClient({ delayMs: 0 });
  const sent = [];
  const create = client.messages.create.bind(client.messages);
  client.messages.create = async (params) => { sent.push(JSON.parse(JSON.stringify(params.messages))); return create(params); };
  const choices = [{ question: 'Which landscaping style should the model use?', answer: 'Lush garden', detail: 'Lawn and hedges.' }];
  await designHouse({ client, model: 'fake', mode: 'parts', partsLimit: 1, photos: [{ mediaType: 'image/jpeg', data: 'A' }], choices });
  assert.match(sent[0][0].content.at(-1).text, /CHOICES FROM THE OWNER[\s\S]*landscaping style should the model use\? Lush garden: Lawn and hedges\./);
});

test('the 48 x 48 plate is set on drafts and explained in the task', async () => {
  const client = makeFakeClient({ delayMs: 0 });
  const sent = [];
  const create = client.messages.create.bind(client.messages);
  client.messages.create = async (params) => { sent.push(JSON.parse(JSON.stringify(params.messages))); return create(params); };
  let draft = null;
  await designHouse({ client, model: 'fake', mode: 'parts', partsLimit: 1, plate: 48, photos: [{ mediaType: 'image/jpeg', data: 'A' }], onEvent: (ev) => { if (ev.type === 'draft') draft = ev.design; } });
  assert.match(sent[0][0].content.at(-1).text, /PLATE AND SCALE\. This model is on the 48 x 48 baseplate: set "plate": 48/);
  assert.equal(draft.plate, 48);
});

test('the Mini (16 x 16) is set on drafts, and the task says how to build at its scale', async () => {
  const client = makeFakeClient({ delayMs: 0 });
  const sent = [];
  const create = client.messages.create.bind(client.messages);
  client.messages.create = async (params) => { sent.push(JSON.parse(JSON.stringify(params.messages))); return create(params); };
  let draft = null;
  await designHouse({ client, model: 'fake', mode: 'parts', partsLimit: 1, plate: 16, photos: [{ mediaType: 'image/jpeg', data: 'A' }], onEvent: (ev) => { if (ev.type === 'draft') draft = ev.design; } });
  const task = sent[0][0].content.at(-1).text;
  assert.match(task, /on the 16 x 16 baseplate: set "plate": 16 in the design\. x and z run 0\.\.15 and the street is along z = 15\. The scale is about 4 ft per stud/);
  assert.match(task, /This is the Mini[\s\S]*transparent bricks/);
  assert.equal(draft.plate, 16);
});

test('extractJson accepts fenced and surrounded JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here it is: {"a":2} done'), { a: 2 });
  assert.equal(extractJson('no json'), null);
});

test('design mode needs photos or notes', async () => {
  await assert.rejects(designHouse({ client: makeFakeClient(), model: 'fake' }), /photo or a description/);
});

test('a run that ends with problems gets repair rounds on just those, and converges', async () => {
  const { example } = require('../src/server/prompt');
  const good = JSON.parse(example()), bad = JSON.parse(example());
  bad.ops.find((o) => o.op === 'sub' && o.name === 'Cactus').copies = [[20, 0, 26]]; // collides with the driveway
  let n = 0, sentGood = false;
  const client = { messages: { create: async (params) => {
    const texts = params.messages.filter((m) => m.role === 'user').flatMap((m) => m.content).filter((b) => b.type === 'text').map((b) => b.text);
    const repairing = texts.some((t) => /^REPAIR/.test(t));
    if (sentGood) return { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fixed.' }] };
    sentGood = repairing;
    return { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${++n}`, name: 'compile_design', input: { design: repairing ? good : bad } }] };
  } } };
  const seen = [];
  const out = await designHouse({ client, model: 'fake', mode: 'parts', photos: [{ mediaType: 'image/jpeg', data: 'AAAA' }], onEvent: (e) => seen.push(e) });
  assert.deepEqual(seen.filter((e) => e.type === 'part').map((e) => e.name).slice(5), ['Repair 1']);
  assert.deepEqual([out.result.errors.length, out.result.warnings.length], [0, 0]);
});

test('a scale fitted to the house rides on every draft, and the map images go after the photos', async () => {
  const client = makeFakeClient({ delayMs: 0 });
  const sent = [];
  const create = client.messages.create.bind(client.messages);
  client.messages.create = async (params) => { sent.push(JSON.parse(JSON.stringify(params.messages))); return create(params); };
  const seen = [];
  const out = await designHouse({ client, model: 'fake', mode: 'parts', partsLimit: 1, photos: [{ mediaType: 'image/jpeg', data: 'AAAA' }], ftPerStud: 2.5,
    siteImages: [{ mediaType: 'image/jpeg', data: 'MAP1', caption: 'the house from above' }], siteNote: 'SITE PLAN FROM THE MAP. Driveway: [24, 8, 27, 29].', onEvent: (ev) => seen.push(ev) });
  const first = sent[0][0].content;
  assert.deepEqual(first.filter((b) => b.type === 'image').map((b) => b.source.data), ['AAAA', 'MAP1']);
  assert.match(first.find((b) => b.type === 'text').text, /^Map image 1: the house from above\.$/);
  assert.match(first.at(-1).text, /2\.5 ft per stud instead of the usual 2 \(set "stud": 2\.5 in the design\)/);
  assert.match(first.at(-1).text, /SITE PLAN FROM THE MAP\. Driveway/);
  assert.equal(seen.find((e) => e.type === 'draft').design.stud, 2.5);
  assert.equal(out.design.stud, 2.5);
  assert.ok(out.costUsd >= 0);
});

test('a design stops at its cost limit and keeps the last compiled draft', async () => {
  const client = makeFakeClient({ delayMs: 0 });
  const create = client.messages.create.bind(client.messages);
  client.messages.create = async (params) => ({ ...(await create(params)), usage: { input_tokens: 100000, output_tokens: 50000 } });
  const seen = [];
  const out = await designHouse({ client, model: 'claude-opus-5-5', mode: 'parts', photos: [{ mediaType: 'image/jpeg', data: 'AAAA' }], budgetUsd: 2, spentUsd: 1, onEvent: (ev) => seen.push(ev) });
  // each turn costs $1.40, on top of the $1 spent before the loop: past $2 after the first, but that one has no
  // draft yet; it stops after the second
  assert.equal(seen.filter((e) => e.type === 'part').length, 1);
  assert.match(out.note, /Stopped at the cost limit \(\$3\.80 of \$2\)/);
  assert.equal(out.compiles, 1);
});

test('after the five parts a photo review compares renders with the photos, and the design applies its fixes', async () => {
  const client = makeFakeClient({ delayMs: 0 });
  const create = client.messages.create.bind(client.messages), sent = [];
  client.messages.create = async (params) => {
    if (params.tools[0].name === 'submit_review') {
      sent.push(params);
      return { role: 'assistant', stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 1000 }, content: [{ type: 'tool_use', id: 'r1', name: 'submit_review',
        input: { matches: ['two stories on the right'], fixes: [{ feature: 'massing', photo: 2, problem: 'The upper floor sits flush over the garage.', fix: 'Make it jut one stud past the garage door on its own slab.' }] } }] };
    }
    sent.push(JSON.parse(JSON.stringify(params)));
    return create(params);
  };
  const render = async () => ['front', 'three-quarter', 'back-left', 'back-right'].map((label) => ({ label, data: 'PNG' }));
  const seen = [];
  const out = await designHouse({ client, model: 'fake', mode: 'parts', photos: [{ mediaType: 'image/jpeg', data: 'AAAA' }], views: ['front'], render,
    review: { model: 'claude-fable-5-1' }, onEvent: (ev) => seen.push(ev) });
  const rv = sent.find((p) => p.tools[0].name === 'submit_review');
  assert.equal(rv.model, 'claude-fable-5-1');
  assert.equal(rv.messages[0].content.filter((b) => b.type === 'image').length, 5); // the photo and four renders
  assert.match(rv.messages[0].content.at(-1).text, /photo 1 \(the front of the house, straight on\)/);
  assert.ok(seen.some((e) => e.type === 'part' && e.name === 'Photo review'));
  const after = sent[sent.indexOf(rv) + 1];
  assert.match(JSON.stringify(after.messages.at(-1).content), /PHOTO REVIEW\. .*Make it jut one stud past the garage door on its own slab/);
  assert.equal(out.review.fixes.length, 1);
  assert.ok(out.review.usd > 0 && out.costUsd >= out.review.usd);
});
