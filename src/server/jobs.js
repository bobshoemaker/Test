// Design jobs. Designing a house costs a few dollars of API time, so on a public site a job only
// runs once its design fee is paid: create() saves the request and returns a Stripe Checkout link;
// start() runs the job only after Stripe confirms that job's session is paid, and only once. With no
// Stripe key (local, demo) jobs start right away. Jobs run on the server whether or not anyone is
// watching; the viewer polls get() for progress, so closing the tab (or paying) doesn't lose it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FIXES = 2; // "ask Claude to fix these" rounds included with a paid job
const RESUME_WITHIN_MS = 24 * 3600e3; // older cut-off jobs are left alone (no surprise API spend on stale ones)
const MAX_RESUMES = 2; // times a job cut off by a restart is picked up again (a crash that recurs stops there)

function createJobs({ dir, stripe = null, feeCents = 0, currency = 'usd', run, fixRun = null, now = () => Date.now() }) {
  fs.mkdirSync(dir, { recursive: true });
  const jobs = new Map();
  const file = (id) => path.join(dir, `${id}.json`);
  const save = (j) => fs.writeFileSync(file(j.id), JSON.stringify(j));
  const load = (id) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    if (jobs.has(id)) return jobs.get(id);
    if (!fs.existsSync(file(id))) return null;
    const j = JSON.parse(fs.readFileSync(file(id), 'utf8'));
    if (j.status === 'running') j.status = 'interrupted'; // the server restarted mid-job; it may run again
    jobs.set(id, j);
    return j;
  };
  const feeOn = !!(stripe && feeCents > 0);

  function emit(j, ev) {
    const { design, renders, overlay, ...rest } = ev; // drafts are served separately; images stay on the server
    if (ev.type === 'draft' && design) { j.draft = design; j.draftN = (j.draftN || 0) + 1; rest.draftN = j.draftN; }
    if (ev.type === 'done') j.result = ev;
    j.events.push({ ...rest, t: now() });
    if (ev.type === 'done' || ev.type === 'error' || ev.type === 'draft' || ev.type === 'part') save(j); // part: where a restart picks up
  }

  function launch(j, fn) {
    j.status = 'running'; save(j);
    fn(j.params, (ev) => emit(j, ev))
      .then(() => { j.status = 'done'; save(j); })
      .catch((e) => { emit(j, { type: 'error', message: e && e.message ? e.message : String(e) }); j.status = 'error'; save(j); });
  }

  return {
    fee: feeOn ? { amountCents: feeCents, currency } : null,

    // A new job for these (already cleaned) design parameters. Returns {id, checkout?}.
    async create(params, origin) {
      const j = { id: crypto.randomUUID(), createdAt: now(), status: feeOn ? 'awaiting_payment' : 'queued', params, events: [], fixes: 0 };
      jobs.set(j.id, j);
      if (!feeOn) { save(j); launch(j, run); return { id: j.id }; }
      const s = await stripe.createCheckout({ jobId: j.id, amountCents: feeCents, currency, name: 'Brick model design fee',
        successUrl: `${origin}/app?job=${j.id}&session={CHECKOUT_SESSION_ID}`, cancelUrl: `${origin}/app?job=${j.id}&canceled=1` });
      j.sessionId = s.id; save(j);
      return { id: j.id, checkout: s.url };
    },

    // After Stripe sends the owner back: run the job if its own session is paid. Idempotent.
    async start(id, sessionId) {
      const j = load(id);
      if (!j) return { code: 404, error: 'No such job' };
      if (j.status === 'awaiting_payment' || (j.status === 'interrupted' && j.paid)) {
        if (!j.paid) {
          if (!sessionId || sessionId !== j.sessionId) return { code: 402, error: 'This payment link is not for this design.' };
          const s = await stripe.getSession(sessionId);
          if (s.payment_status !== 'paid' || (s.metadata && s.metadata.job) !== id) return { code: 402, error: 'The design fee has not been paid yet.' };
          j.paid = { at: now(), amount: s.amount_total, currency: s.currency };
        }
        launch(j, run);
      }
      return { code: 200, status: j.status };
    },

    // At server start: pick up every job a restart cut off (a deploy, the server running out of memory) at
    // the part it was on, from its last draft, so a paid design isn't left half built. A cut-off fix round
    // gives the round back and keeps the design it had. Returns the ids picked up.
    resumeInterrupted() {
      const ids = [];
      for (const f of fs.readdirSync(dir)) {
        const j = f.endsWith('.json') ? load(f.slice(0, -5)) : null;
        if (!j || j.status !== 'interrupted' || (feeOn && j.sessionId && !j.paid)) continue;
        if (j.result) { j.status = 'done'; j.fixes = Math.max(0, j.fixes - 1); save(j); continue; }
        if (now() - (j.createdAt || 0) > RESUME_WITHIN_MS) { emit(j, { type: 'error', message: 'The design was cut off and is too old to pick up again.' }); j.status = 'error'; save(j); continue; }
        if ((j.resumes || 0) >= MAX_RESUMES) { emit(j, { type: 'error', message: 'The design was cut off too many times to finish.' }); j.status = 'error'; save(j); continue; }
        j.resumes = (j.resumes || 0) + 1;
        const parts = j.events.filter((e) => e.type === 'part' && Number.isInteger(e.n));
        let fromPart = parts.length ? parts[parts.length - 1].n : 1;
        const seed = fromPart > 1 ? j.draft : null;
        if (!seed) fromPart = 1;
        emit(j, { type: 'status', message: `Picking the design up again at part ${fromPart}.`, resumed: fromPart });
        launch(j, (params, e) => run({ ...params, resume: { fromPart, seed } }, e));
        ids.push(j.id);
      }
      return ids;
    },

    // One of the job's own photos, by index (the viewer shows them beside the model): {mediaType, data}.
    photo(id, n) {
      const j = load(id), ph = j && j.params && Array.isArray(j.params.photos) ? j.params.photos[n] : null;
      return ph && typeof ph.data === 'string' ? { mediaType: ph.mediaType, data: ph.data } : null;
    },

    // Progress since event index `after`, plus the latest draft when the viewer doesn't have it yet.
    get(id, { after = 0, have = 0 } = {}) {
      const j = load(id);
      if (!j) return null;
      return { id: j.id, status: j.status, paid: !!j.paid || !feeOn, fixesLeft: MAX_FIXES - j.fixes,
        photos: j.params && Array.isArray(j.params.photos) ? j.params.photos.length : 0,
        events: j.events.slice(after), next: j.events.length,
        ...(j.draftN > have ? { draft: j.draft, draftN: j.draftN } : {}), ...(j.status === 'done' && j.result ? { result: j.result } : {}) };
    },

    // One more round on a finished paid job's design ("fix these"), limited per job.
    fix(id) {
      const j = load(id);
      if (!j || !fixRun) return { code: 404, error: 'No such job' };
      if (j.status !== 'done' || !j.result) return { code: 409, error: 'The design is not finished yet.' };
      if (j.fixes >= MAX_FIXES) return { code: 429, error: 'The fix rounds included with this design are used up.' };
      j.fixes++;
      const design = j.result.design;
      launch(j, (params, e) => fixRun({ ...params, design }, e));
      return { code: 200, status: j.status };
    },
  };
}

module.exports = { createJobs, MAX_FIXES, MAX_RESUMES };
