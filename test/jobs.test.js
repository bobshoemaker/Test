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
    createCheckout: async ({ jobId, amountCents, successUrl }) => {
      const id = `cs_test_${sessions.size + 1}`;
      sessions.set(id, { id, url: `https://checkout.stripe.test/${id}`, payment_status: 'unpaid', metadata: { job: jobId }, amount_total: amountCents, currency: 'usd', successUrl });
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
  assert.match(decodeURIComponent(sent.body), /mode=payment&client_reference_id=j1&metadata\[job\]=j1&line_items\[0\]\[quantity\]=1&line_items\[0\]\[price_data\]\[currency\]=usd&line_items\[0\]\[price_data\]\[unit_amount\]=1500/);
  assert.equal(makeStripe({ secretKey: '' }), null);
});

test('a job cut off by a restart is picked up again at the part it was on, from its last draft', async () => {
  const dir = tmp(), calls = [];
  // the first server: the job gets through part 1 and into part 2, then the server goes away mid-run
  const hang = async (p, emit) => { calls.push(p.resume || null); emit({ type: 'part', n: 1, of: 5, name: 'Walls' });
    emit({ type: 'draft', n: 1, design: { name: 'walls', phases: ['a'], ops: [] }, stats: { pieces: 1 } }); emit({ type: 'part', n: 2, of: 5, name: 'Roofs' }); await new Promise(() => {}); };
  const first = createJobs({ dir, run: hang });
  const { id } = await first.create({ notes: 'house', photos: [] }, 'https://site.test');
  await until(() => first.get(id).events.length >= 3);
  // a restart: a new server on the same saved jobs
  const second = createJobs({ dir, run: hang });
  assert.deepEqual(second.resumeInterrupted(), [id]);
  await until(() => calls.length === 2);
  assert.deepEqual(calls[1], { fromPart: 2, seed: { name: 'walls', phases: ['a'], ops: [] } });
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
