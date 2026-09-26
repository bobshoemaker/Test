// The Claude loop, driven by a scripted client: draft with an error, then a fixed final design.
const test = require('node:test');
const assert = require('node:assert/strict');
const { designHouse, extractJson } = require('../src/server/designer');
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

test('parts mode builds in four appended turns and reports each part', async () => {
  const client = makeFakeClient({ delayMs: 0 });
  const sent = [];
  const create = client.messages.create.bind(client.messages);
  client.messages.create = async (params) => { sent.push(JSON.parse(JSON.stringify(params.messages))); return create(params); };
  const seen = [];
  const out = await designHouse({ client, model: 'fake', mode: 'parts', photos: [{ mediaType: 'image/jpeg', data: 'AAAA' }], onEvent: (ev) => seen.push(ev) });
  assert.deepEqual(seen.filter((e) => e.type === 'part').map((e) => e.name), ['Walls', 'Roofs', 'Site', 'Planting']);
  assert.equal(seen.filter((e) => e.type === 'partDone').length, 4);
  assert.equal(seen.find((e) => e.type === 'draft').part, 'Walls');
  assert.match(sent[0][0].content.at(-1).text, /PART 1 OF 4, WALLS/);
  // Each part's request extends the previous one; nothing earlier is edited.
  for (let i = 1; i < sent.length; i++) assert.deepEqual(sent[i].slice(0, sent[i - 1].length), sent[i - 1]);
  assert.match(sent.at(-1).at(-1).content[0].text, /PART 4 OF 4/);
  assert.equal(out.result.errors.length, 0);
});

test('extractJson accepts fenced and surrounded JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here it is: {"a":2} done'), { a: 2 });
  assert.equal(extractJson('no json'), null);
});

test('design mode needs photos or notes', async () => {
  await assert.rejects(designHouse({ client: makeFakeClient(), model: 'fake' }), /photo or a description/);
});
