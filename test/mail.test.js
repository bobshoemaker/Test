// Email through Resend: the request it sends, and when a job sends it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeMailer, cleanEmail, readyEmail, mineEmail } = require('../src/server/mail');
const { createJobs } = require('../src/server/jobs');

const until = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); };

test('the mailer posts JSON to Resend with the key, and is off without one', async () => {
  let sent;
  const m = makeMailer({ apiKey: 're_test', from: 'Brickhouse <hi@x.test>', fetchImpl: async (url, o) => { sent = { url, ...o }; return { ok: true, json: async () => ({ id: 'e1' }) }; } });
  await m.send({ to: 'a@b.test', ...readyEmail({ name: '806 Alta St', link: 'https://site.test/app?job=1' }) });
  assert.equal(sent.url, 'https://api.resend.com/emails');
  assert.equal(sent.headers.authorization, 'Bearer re_test');
  const body = JSON.parse(sent.body);
  assert.deepEqual([body.from, body.to, body.subject], ['Brickhouse <hi@x.test>', ['a@b.test'], 'Your brick house is ready: 806 Alta St']);
  assert.match(body.html, /href="https:\/\/site.test\/app\?job=1"/);
  assert.match(body.text, /See your house: https:\/\/site.test\/app\?job=1/);
  assert.doesNotMatch(body.html + body.text, /\bAI\b|Claude/);
  assert.equal(makeMailer({ apiKey: '' }), null);
  const bad = makeMailer({ apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: 'domain not verified' }) }) });
  await assert.rejects(bad.send({ to: 'a@b.test', subject: 's', html: 'h', text: 't' }), /Resend: domain not verified/);
  const me = mineEmail({ count: 2, link: 'https://s/app?mine=t.k' });
  assert.match(me.html, /<a href="https:\/\/s\/app\?mine=t\.k"[^>]*>See my designs<\/a>/);
  assert.match(me.text, /the 2 designs made with this email address[\s\S]*24 hours/);
});

test('emails are checked and kept in lower case', () => {
  assert.equal(cleanEmail(' Owner@Example.COM '), 'owner@example.com');
  for (const bad of ['', 'no-at', 'a@b', 'a b@c.com', 'a@b.c', null, 42]) assert.equal(cleanEmail(bad), null);
});

test('a job emails its owner once when the design is ready (not again after a fix), and is found by email', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-')), told = [];
  const run = async (p, emit) => emit({ type: 'done', design: { name: 'house' } });
  const jobs = createJobs({ dir, run, fixRun: run, notify: async (j, kind) => told.push([kind, j.email, j.origin]) });
  const { id } = await jobs.create({ notes: 'x', photos: [], email: 'a@b.test' }, 'https://site.test');
  await until(() => told.length === 1);
  assert.deepEqual(told, [['ready', 'a@b.test', 'https://site.test']]);
  jobs.fix(id); await until(() => jobs.get(id).status === 'done'); await new Promise((r) => setTimeout(r, 20));
  assert.equal(told.length, 1);
  // no email given: nothing sent
  await jobs.create({ notes: 'y', photos: [] }, 'https://site.test'); await new Promise((r) => setTimeout(r, 20));
  assert.equal(told.length, 1);
  const found = createJobs({ dir, run }).byEmail('a@b.test');
  assert.deepEqual(found.map((d) => [d.id, d.name, d.origin]), [[id, 'house', 'https://site.test']]);
  assert.deepEqual(jobs.byEmail('other@b.test'), []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')).params.email, undefined, 'the email stays out of the design parameters');
});

test('an order\'s design asks its owner for their OK, says one change is included, and when it builds without an answer', () => {
  const { approveEmail } = require('../src/server/mail');
  const e = approveEmail({ name: '806 Alta St', link: 'https://site.test/app?job=1', until: 'Friday, October 3 at 5:00 PM PDT' });
  assert.match(e.subject, /ready to look at: 806 Alta St/);
  assert.match(e.text, /change it once/); assert.match(e.text, /by Friday, October 3 at 5:00 PM PDT/);
  assert.match(e.text, /See your house: https:\/\/site\.test\/app\?job=1/);
  assert.doesNotMatch(e.text, /Claude|AI\b/);
});
