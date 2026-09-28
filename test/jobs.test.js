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
