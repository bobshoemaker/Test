// The photo check every design request passes: only photos of one home go ahead.
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkPhotos, photoVerdict } = require('../src/server/designer');

const say = (...shows) => ({ photos: shows.map((s, i) => ({ photo: i + 1, shows: s, note: `photo ${i + 1}` })), planIsFloorPlan: true });

test('photos of one home pass, inside shots and a blurry one included', () => {
  assert.equal(photoVerdict(say('home', 'home', 'inside', 'unclear'), 4, false).ok, true);
});

test('a different house, a non-home and a non-building are refused, naming the photo', () => {
  let v = photoVerdict(say('home', 'different_home'), 2, false);
  assert.equal(v.ok, false); assert.match(v.message, /Photo 2 looks like a different house/); assert.match(v.message, /just one house/);
  v = photoVerdict(say('not_home'), 1, false);
  assert.equal(v.ok, false); assert.match(v.message, /Photo 1 doesn't look like a home/);
  v = photoVerdict(say('home', 'not_building', 'home'), 3, false);
  assert.deepEqual(v.problems.map((p) => p.photo), [2]);
});

test('no clear outside view, or a plan that is not a plan, is refused', () => {
  assert.match(photoVerdict(say('inside', 'unclear'), 2, false).message, /clear photo of the front/);
  assert.match(photoVerdict({ ...say('home'), planIsFloorPlan: false }, 1, true).message, /floor plan doesn't look/);
  assert.equal(photoVerdict({ ...say('home'), planIsFloorPlan: false }, 1, false).ok, true); // no plan sent
});

test('the verdict ignores numbers outside the photos and treats a missing photo as unclear', () => {
  const v = photoVerdict({ photos: [{ photo: 1, shows: 'home', note: '' }, { photo: 9, shows: 'not_building', note: '' }], planIsFloorPlan: true }, 2, false);
  assert.equal(v.ok, true);
});

const photo = { mediaType: 'image/jpeg', data: 'AAAA' };
function client(replies) {
  const calls = [];
  return { calls, messages: { create: async (p) => { calls.push(p); return replies.shift(); } } };
}
const toolReply = (input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_photo_check', input }] });

test('checkPhotos sends every image with a strict tool and no forced tool choice', async () => {
  const c = client([toolReply(say('home', 'home'))]);
  const v = await checkPhotos({ client: c, model: 'm', photos: [photo, photo] });
  assert.equal(v.ok, true);
  const p = c.calls[0];
  assert.equal(p.messages[0].content.filter((b) => b.type === 'image').length, 2);
  assert.equal(p.tools[0].strict, true); assert.equal(p.tool_choice, undefined); assert.equal(p.temperature, undefined);
  assert.deepEqual(p.output_config, { effort: 'low' });
});

test('a refusal is a no, a missing answer is asked again, then an error', async () => {
  assert.equal((await checkPhotos({ client: client([{ stop_reason: 'refusal', content: [] }]), model: 'm', photos: [photo] })).ok, false);
  const again = client([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hmm' }] }, toolReply(say('home'))]);
  assert.equal((await checkPhotos({ client: again, model: 'm', photos: [photo] })).ok, true);
  assert.equal(again.calls.length, 2);
  const none = { stop_reason: 'end_turn', content: [] };
  await assert.rejects(checkPhotos({ client: client([none, none]), model: 'm', photos: [photo] }), /couldn't check the photos/);
});

test('a request with no photos and no plan (a description only) is not checked', async () => {
  const c = client([]);
  assert.equal((await checkPhotos({ client: c, model: 'm', photos: [] })).ok, true);
  assert.equal(c.calls.length, 0);
});
