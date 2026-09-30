// Design jobs and the design fee: nothing runs until Stripe says that job's session is paid.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJobs, MAX_FIXES } = require('../src/server/jobs');
const { makeStripe, form } = require('../src/server/payments');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-'));
const until = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); };

// A fake Stripe: sessions are created unpaid; pay(id) marks one paid.
function fakeStripe() {
  const sessions = new Map();
  return {
    sessions,
    pay: (id) => { sessions.get(id).payment_status = 'paid'; },
    createCheckout: async ({ jobId, amountCents, successUrl, kind = 'fee' }) => {
      const id = `cs_test_${sessions.size + 1}`;
      sessions.set(id, { id, url: `https://checkout.stripe.test/${id}`, payment_status: 'unpaid', metadata: { job: jobId, kind }, amount_total: amountCents, currency: 'usd', successUrl });
      return sessions.get(id);
    },
    getSession: async (id) => sessions.get(id),
  };
}

test('with a fee, a job waits for its own paid session, runs once, and survives a reload', async () => {
  const stripe = fakeStripe(); let runs = 0;
  const run = async (p, emit) => { runs++; emit({ type: 'status', message: 'working' }); emit({ type: 'draft', n: 1, design: { name: 'd' }, stats: { pieces: 1 } }); emit({ type: 'done', design: { name: p.notes } }); };
  const dir = tmp(), jobs = createJobs({ dir, stripe, feeCents: 1500, run });
  assert.deepEqual(jobs.fee, { amountCents: 1500, currency: 'usd' });
  const { id, checkout } = await jobs.create({ notes: 'house', photos: [] }, 'https://site.test');
  assert.match(checkout, /^https:\/\/checkout\.stripe\.test\/cs_test_1$/);
  assert.equal(stripe.sessions.get('cs_test_1').successUrl, `https://site.test/app?job=${id}&session={CHECKOUT_SESSION_ID}`);
  assert.equal(jobs.get(id).status, 'awaiting_payment');
  // not paid yet, or someone else's session: nothing runs
  assert.equal((await jobs.start(id, 'cs_test_1')).code, 402);
  const other = await jobs.create({ notes: 'other' }, 'https://site.test'); stripe.pay('cs_test_2');
  assert.equal((await jobs.start(id, 'cs_test_2')).code, 402, "another job's paid session doesn't start this one");
  assert.equal(runs, 0);
  stripe.pay('cs_test_1');
  assert.equal((await jobs.start(id, 'cs_test_1')).code, 200);
  await until(() => jobs.get(id).status === 'done');
  assert.equal((await jobs.start(id, 'cs_test_1')).code, 200);
  assert.equal(runs, 1, 'returning to the success page again does not run it twice');
  const g = jobs.get(id);
  assert.deepEqual([g.status, g.paid, g.result.design.name, g.draftN, g.draft.name], ['done', true, 'house', 1, 'd']);
  assert.equal(jobs.get(id, { after: g.next, have: 1 }).events.length, 0, 'polling only returns what is new');
  // another server process (a restart) reads the job back from disk
  assert.equal(createJobs({ dir, stripe, feeCents: 1500, run }).get(id).status, 'done');
  assert.equal(jobs.get(other.id).status, 'awaiting_payment');
});

test('fix rounds need a finished job and are limited; without a fee jobs start at once', async () => {
  let fixes = 0;
  const jobs = createJobs({ dir: tmp(), run: async (p, e) => e({ type: 'done', design: { name: 'x' } }), fixRun: async (p, e) => { fixes++; e({ type: 'done', design: p.design }); } });
  assert.equal(jobs.fee, null);
  const { id, checkout } = await jobs.create({ notes: 'n' }, 'http://x');
  assert.equal(checkout, undefined);
  await until(() => jobs.get(id).status === 'done');
  for (let k = 0; k < MAX_FIXES; k++) { assert.equal(jobs.fix(id).code, 200); await until(() => jobs.get(id).status === 'done'); }
  assert.equal(jobs.fix(id).code, 429);
  assert.equal(fixes, MAX_FIXES);
  assert.equal(jobs.get('not-a-job'), null);
});

test('the Stripe client sends a form-encoded one-off Checkout Session for the job', async () => {
  assert.equal(form({ a: 1, line_items: [{ price_data: { unit_amount: 1500 } }] }), 'a=1&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1500');
  let sent;
  const stripe = makeStripe({ secretKey: 'sk_test_x', fetchImpl: async (url, o) => { sent = { url, ...o }; return { ok: true, json: async () => ({ id: 'cs_1', url: 'https://checkout' }) }; } });
  await stripe.createCheckout({ jobId: 'j1', amountCents: 1500, name: 'Brick model design fee', successUrl: 's', cancelUrl: 'c' });
  assert.equal(sent.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(sent.headers.authorization, 'Bearer sk_test_x');
  assert.match(decodeURIComponent(sent.body), /mode=payment&client_reference_id=j1&metadata\[job\]=j1&metadata\[kind\]=fee&line_items\[0\]\[quantity\]=1&line_items\[0\]\[price_data\]\[currency\]=usd&line_items\[0\]\[price_data\]\[unit_amount\]=1500/);
  // a kit asks for a US shipping address and says it's a kit
  await stripe.createCheckout({ jobId: 'j1', amountCents: 9900, name: 'Kit', successUrl: 's', cancelUrl: 'c', kind: 'kit', shipping: true });
  assert.match(decodeURIComponent(sent.body), /metadata\[kind\]=kit&shipping_address_collection\[allowed_countries\]\[0\]=US/);
  assert.equal(makeStripe({ secretKey: '' }), null);
});

test('a job cut off by a restart is picked up again at the part it was on, from its last draft', async () => {
  const dir = tmp(), calls = [];
  // the first server: the job gets through part 1 and into part 2, then the server goes away mid-run
  const site = { locked: { source: 'site', blocks: [] }, ftPerStud: 2.5, note: 'SITE PLAN', images: [{ mediaType: 'image/jpeg', data: 'MAP' }], costUsd: 1.25 };
  const hang = async (p, emit) => { calls.push(p.resume || null); if (!p.resume) emit({ type: 'siteDone', site, report: { stages: [] } }); emit({ type: 'part', n: 1, of: 5, name: 'Walls' });
    emit({ type: 'draft', n: 1, design: { name: 'walls', phases: ['a'], ops: [] }, stats: { pieces: 1 } }); emit({ type: 'part', n: 2, of: 5, name: 'Roofs' }); await new Promise(() => {}); };
  const first = createJobs({ dir, run: hang });
  const { id } = await first.create({ notes: 'house', photos: [] }, 'https://site.test');
  await until(() => first.get(id).events.length >= 4);
  // the mapped site stays on the server (the owner's poll carries only that it happened)
  assert.deepEqual(Object.keys(first.get(id).events[0]).sort(), ['t', 'type']);
  // a restart: a new server on the same saved jobs
  const second = createJobs({ dir, run: hang });
  assert.deepEqual(second.resumeInterrupted(), [id]);
  await until(() => calls.length === 2);
  // with the site it mapped, so the walls stay the ones the draft was built on
  assert.deepEqual(calls[1], { fromPart: 2, seed: { name: 'walls', phases: ['a'], ops: [] }, site });
  // and the admin can read how the house was found
  assert.deepEqual(second.siteReport(id), { report: { stages: [] }, costUsd: 1.25 });
  assert.equal(second.list().find((x) => x.id === id).site.ftPerStud, 2.5);
  assert.equal(second.get(id).status, 'running');
  assert.match(second.get(id).events.map((e) => e.message).join(' '), /Picking the design up again at part 2/);
  // it gives up after MAX_RESUMES, so a crash that recurs doesn't loop forever
  const { MAX_RESUMES } = require('../src/server/jobs');
  for (let k = 1; k < MAX_RESUMES; k++) createJobs({ dir, run: hang }).resumeInterrupted();
  const last = createJobs({ dir, run: hang });
  assert.deepEqual(last.resumeInterrupted(), []);
  assert.equal(last.get(id).status, 'error');
});

test('a restart leaves unpaid jobs alone and gives back a cut-off fix round', async () => {
  const dir = tmp(), stripe = fakeStripe(); let runs = 0;
  const jobs = createJobs({ dir, stripe, feeCents: 1500, run: async () => { runs++; } });
  const unpaid = await jobs.create({ notes: 'x', photos: [] }, 'https://site.test');
  // a finished job whose fix round was running when the server went away
  const done = { id: '00000000-0000-4000-8000-000000000001', status: 'running', paid: { at: 1 }, params: {}, events: [], fixes: 1, result: { type: 'done', design: { name: 'kept' } } };
  fs.writeFileSync(path.join(dir, `${done.id}.json`), JSON.stringify(done));
  const after = createJobs({ dir, stripe, feeCents: 1500, run: async () => { runs++; } });
  assert.deepEqual(after.resumeInterrupted(), []);
  assert.equal(runs, 0);
  assert.equal(after.get(unpaid.id).status, 'awaiting_payment');
  // a job cut off long ago isn't picked up (no surprise spend on stale ones)
  const old = { id: '00000000-0000-4000-8000-000000000002', createdAt: Date.now() - 3 * 24 * 3600e3, status: 'running', params: {}, events: [] };
  fs.writeFileSync(path.join(dir, `${old.id}.json`), JSON.stringify(old));
  const later = createJobs({ dir, stripe, feeCents: 1500, run: async () => { runs++; } });
  assert.deepEqual([later.resumeInterrupted(), runs, later.get(old.id).status], [[], 0, 'error']);
  assert.deepEqual([after.get(done.id).status, after.get(done.id).fixesLeft, after.get(done.id).result.design.name], ['done', MAX_FIXES, 'kept']);
});

test("a job serves its own photos by index, for the viewer to show beside the model", async () => {
  const jobs = createJobs({ dir: tmp(), run: async () => {} });
  const { id } = await jobs.create({ notes: 'x', photos: [{ mediaType: 'image/jpeg', data: 'AAAA' }, { mediaType: 'image/png', data: 'BBBB' }] }, 'https://site.test');
  assert.equal(jobs.get(id).photos, 2);
  assert.deepEqual(jobs.photo(id, 1), { mediaType: 'image/png', data: 'BBBB' });
  assert.equal(jobs.photo(id, 2), null);
  assert.equal(jobs.photo('not-a-job', 0), null);
});

test('the design is a preview until its kit is ordered and paid; a design-fee payment doesn\'t unlock it', async () => {
  const stripe = fakeStripe(), design = { name: 'house', plate: 32 };
  const run = async (p, emit) => { emit({ type: 'draft', n: 1, design }); emit({ type: 'done', design }); };
  const jobs = createJobs({ dir: tmp(), stripe, feeCents: 0, run, kitCents: (plate) => (plate === 32 ? 9900 : null), preview: (d) => ({ preview: true, name: d.name }) });
  const { id } = await jobs.create({ notes: 'x', photos: [] }, 'https://site.test');
  await until(() => jobs.get(id).status === 'done');
  let g = jobs.get(id);
  assert.deepEqual([g.result.design, g.draft, g.kit, g.kitCents], [{ preview: true, name: 'house' }, { preview: true, name: 'house' }, null, 9900]);
  assert.deepEqual(jobs.get(id, { full: true }).result.design, design, "the owner's own machine sees it all");
  // ordering: a Stripe Checkout for the kit's price, with its return link
  const k = await jobs.kit(id, { origin: 'https://site.test' });
  const sess = [...stripe.sessions.values()].at(-1);
  assert.deepEqual([k.code, k.checkout, sess.amount_total], [200, sess.url, 9900]);
  assert.equal(sess.successUrl, `https://site.test/app?job=${id}&kit={CHECKOUT_SESSION_ID}`);
  // not paid, or another session: still a preview
  assert.equal((await jobs.kit(id, { session: sess.id })).code, 402);
  assert.equal((await jobs.kit(id, { session: 'cs_other' })).code, 402);
  assert.equal(jobs.get(id).result.design.preview, true);
  // paid: the order is kept (with where to ship it) and the full design is served
  stripe.pay(sess.id); Object.assign(sess, { customer_details: { email: 'a@b.test', name: 'A' }, shipping_details: { name: 'A B', address: { city: 'LA' } } });
  assert.equal((await jobs.kit(id, { session: sess.id })).code, 200);
  g = jobs.get(id);
  assert.deepEqual([g.result.design, g.kit.test], [design, false]);
});

test('without Stripe a kit order is a test order that unlocks at once; kits need a finished design', async () => {
  let finish; const run = (p, emit) => new Promise((r) => { finish = () => { emit({ type: 'done', design: { name: 'h' } }); r(); }; });
  const kits = [];
  const jobs = createJobs({ dir: tmp(), run, preview: () => ({ preview: true }), onKit: (j) => { kits.push(j.id); throw new Error('matcher down'); } });
  const { id } = await jobs.create({ notes: 'x', photos: [] }, 'https://site.test');
  assert.equal((await jobs.kit(id, {})).code, 409);
  finish(); await until(() => jobs.get(id).status === 'done');
  assert.deepEqual(await jobs.kit(id, {}), { code: 200, ordered: true, test: true }, 'a failed stock check never fails the order');
  assert.deepEqual([jobs.get(id).kit.test, jobs.get(id).result.design], [true, { name: 'h' }]);
  // the order starts a stock check, whose result the admin list shows
  await until(() => kits.length === 1); assert.deepEqual(kits, [id]);
  const stock = { at: 1, ok: false, lots: 2, short: [{ no: '3005', color: 'Tan', need: 4, has: 1 }], notMade: [] };
  jobs.setStock(id, stock);
  assert.deepEqual(jobs.list().find((r) => r.id === id).stock, stock);
});

test('the admin list, fulfillment (shipped with tracking emails once) and running a failed design again', async () => {
  const told = []; let fail = true;
  const run = async (p, emit) => { emit({ type: 'part', n: 1, of: 5, name: 'Walls' }); emit({ type: 'draft', n: 1, design: { name: 'h', phases: [], ops: [] } });
    if (fail) throw new Error('overloaded'); emit({ type: 'done', design: { name: 'h' }, stats: { pieces: 10 }, errors: 0, warnings: 0 }); };
  const jobs = createJobs({ dir: tmp(), run, notify: async (j, kind) => told.push(kind) });
  const { id } = await jobs.create({ notes: 'x', photos: [], address: '1 Elm St', email: 'a@b.test' }, 'https://s.test');
  await until(() => jobs.get(id).status === 'error');
  let row = jobs.list()[0];
  assert.deepEqual([row.id, row.status, row.error, row.address, row.email, row.part], [id, 'error', 'overloaded', '1 Elm St', 'a@b.test', '1 of 5']);
  // run again: picks up from part 1 (no seed past part 1) and finishes
  fail = false;
  assert.equal(jobs.retry(id).code, 200);
  await until(() => jobs.get(id).status === 'done');
  assert.equal(jobs.retry(id).code, 409, 'only a failed design runs again');
  // fulfillment needs a kit order; shipped with tracking emails once
  assert.equal(jobs.setFulfillment(id, { status: 'ordered' }).code, 404);
  await jobs.kit(id, {});
  assert.equal(jobs.setFulfillment(id, { status: 'lost' }).code, 400);
  assert.equal(jobs.setFulfillment(id, { status: 'ordered', supplierOrder: 'BW-1' }).code, 200);
  jobs.setFulfillment(id, { status: 'shipped', tracking: '1Z999' }); jobs.setFulfillment(id, { status: 'shipped', tracking: '1Z999' });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(told.filter((k) => k === 'shipped'), ['shipped']);
  row = jobs.list()[0];
  assert.deepEqual([row.fulfillment.status, row.fulfillment.supplierOrder, row.fulfillment.tracking, row.kit.test], ['shipped', 'BW-1', '1Z999', true]);
});

test("a design's line in Your designs: the address until a draft names it, and where it's got to", async () => {
  let finish; const run = (p, emit) => new Promise((r) => { finish = () => { emit({ type: 'done', design: { name: 'Brisbane St' } }); r(); }; });
  const jobs = createJobs({ dir: tmp(), run });
  const { id } = await jobs.create({ notes: 'x', photos: [], address: '157 Brisbane St' }, 'https://site.test');
  assert.deepEqual([jobs.summary(id).name, jobs.summary(id).address, jobs.summary(id).status], ['', '157 Brisbane St', 'designing']);
  finish(); await until(() => jobs.get(id).status === 'done');
  assert.deepEqual([jobs.summary(id).name, jobs.summary(id).status], ['Brisbane St', 'ready']);
  assert.equal(jobs.summary('00000000-0000-0000-0000-000000000000'), null);
});

test('a design in progress shows its owner only that it is in progress; the draft comes once it is finished', async () => {
  let finish; const run = (p, emit) => new Promise((r) => { emit({ type: 'draft', design: { name: 'half done' } }); finish = () => { emit({ type: 'done', design: { name: 'done' } }); r(); }; });
  const jobs = createJobs({ dir: tmp(), run, preview: (d) => ({ preview: true, name: d.name }) });
  const { id } = await jobs.create({ notes: 'x', photos: [] }, 'https://site.test');
  await until(() => jobs.get(id, { full: true }).draft);
  assert.equal(jobs.get(id).status, 'running');
  assert.equal(jobs.get(id).draft, undefined, 'no draft for the owner while it runs');
  assert.equal(jobs.get(id, { full: true }).draft.name, 'half done', 'the admin watches it take shape');
  finish(); await until(() => jobs.get(id).status === 'done');
  assert.equal(jobs.get(id).result.design.name, 'done');
});

test('held for the admin: the owner sees it in progress until it is approved; changes can be asked for and undone', async () => {
  const told = [];
  const run = async (p, emit) => { emit({ type: 'draft', design: { name: 'first' } }); emit({ type: 'done', design: { name: 'first' }, stats: { pieces: 10 } }); };
  let asked = null;
  const reviseRun = async (p, emit) => { asked = p; emit({ type: 'cost', usd: 0.8 }); emit({ type: 'done', design: { name: `${p.design.name}+${p.note}` }, stats: { pieces: 12 } }); };
  const J = createJobs({ dir: tmp(), run, reviseRun, fixRun: run, hold: true, notify: async (j, kind) => told.push(kind), kitCents: () => 5000 });
  const { id } = await J.create({ photos: [], notes: 'n', email: 'a@b.test' }, 'https://x');
  await until(() => J.get(id, { full: true }).status === 'done');
  // the owner: still in progress, no design, no email, no kit, no fix round
  const owner = J.get(id);
  assert.equal(owner.status, 'review'); assert.equal(owner.result, undefined); assert.equal(owner.draft, undefined);
  assert.ok(owner.events.every((e) => ['status', 'part', 'site'].includes(e.type)));
  assert.deepEqual(told, []);
  assert.equal(J.summary(id).status, 'designing');
  assert.equal((await J.kit(id, { origin: 'https://x' })).code, 409);
  assert.equal(J.fix(id).code, 409);
  // the admin: the design, and what the check needs
  const admin = J.get(id, { full: true });
  assert.equal(admin.result.design.name, 'first'); assert.equal(admin.review.approved, null); assert.equal(admin.review.canUndo, false);
  assert.equal(J.list()[0].review.approved, null);
  // a change in words about selected pieces
  assert.equal(J.revise(id, { note: '' }).code, 400);
  const sel = [{ op: 3, kind: 'roof', phase: 'Roof', count: 2, of: 40, parts: [] }];
  assert.equal(J.revise(id, { note: 'lower roof', selection: sel, parts: 2 }).code, 200);
  await until(() => J.get(id, { full: true }).status === 'done');
  assert.deepEqual(asked.selection, sel); assert.equal(asked.note, 'lower roof');
  let a = J.get(id, { full: true });
  assert.equal(a.result.design.name, 'first+lower roof'); assert.equal(a.draft.name, 'first+lower roof');
  assert.deepEqual(a.review.revisions.map((r) => [r.note, r.parts, r.costUsd, r.undone]), [['lower roof', 2, 0.8, false]]);
  assert.equal(J.get(id).status, 'review'); assert.deepEqual(told, []);
  // undo puts the first design back
  assert.equal(J.undo(id).code, 200);
  a = J.get(id, { full: true });
  assert.equal(a.result.design.name, 'first'); assert.equal(a.review.revisions[0].undone, true); assert.equal(a.review.canUndo, false);
  assert.equal(J.undo(id).code, 409);
  // approve: the owner sees it and is told once
  assert.equal(J.approve(id).code, 200); J.approve(id);
  await until(() => told.length);
  assert.deepEqual(told, ['ready']);
  assert.equal(J.get(id).status, 'done'); assert.equal(J.get(id).result.design.name, 'first');
  assert.equal(J.summary(id).status, 'ready');
});

test('without the hold, a finished design goes to its owner as before', async () => {
  const told = [];
  const J = createJobs({ dir: tmp(), run: async (p, emit) => emit({ type: 'done', design: { name: 'd' } }), notify: async (j, kind) => told.push(kind) });
  const { id } = await J.create({ photos: [], notes: 'n', email: 'a@b.test' }, 'https://x');
  await until(() => told.length);
  assert.equal(J.get(id).status, 'done'); assert.deepEqual(told, ['ready']); assert.equal(J.get(id, { full: true }).review, undefined);
});

test('turning the hold on leaves designs finished before it as their owners have seen them', async () => {
  const dir = tmp();
  const before = createJobs({ dir, run: async (p, emit) => emit({ type: 'done', design: { name: 'old' } }) });
  const { id } = await before.create({ photos: [], notes: 'n' }, 'https://x');
  await until(() => before.get(id).status === 'done');
  const after = createJobs({ dir, run: async () => {}, hold: true });
  assert.equal(after.get(id).status, 'done'); assert.equal(after.get(id).result.design.name, 'old');
  assert.equal(after.summary(id).status, 'ready');
  assert.equal(after.get(id, { full: true }).review, undefined); assert.equal(after.list()[0].review, null);
});
