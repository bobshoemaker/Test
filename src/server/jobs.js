// Design jobs. Designing a house costs a few dollars of API time, so on a public site a job only
// runs once its design fee is paid: create() saves the request and returns a Stripe Checkout link;
// start() runs the job only after Stripe confirms that job's session is paid, and only once. With no
// Stripe key (local, demo) jobs start right away. Jobs run on the server whether or not anyone is
// watching; the viewer polls get() for progress, so closing the tab (or paying) doesn't lose it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RESUME_WITHIN_MS = 24 * 3600e3; // older cut-off jobs are left alone (no surprise API spend on stale ones)
const FULFILLMENT = ['new', 'ordered', 'packed', 'shipped', 'cancelled']; // a kit order's progress, set on the admin page
const MAX_RESUMES = 2; // times a job cut off by a restart is picked up again (a crash that recurs stops there)

// kitCents(plate): the kit's price for a design on that baseplate, or null when kits aren't on sale.
// preview(design): what a customer sees before ordering the kit (preview.js); the full design after.
// notify(job, 'ready' | 'kit'): email the owner (mail.js), when the job has an email; never fails a job.
// onKit(job): a kit order came in (the server checks the supplier's stock for it); never fails the order.
// hold: every finished design waits for the admin's approval before its owner sees it (or gets its email);
// meanwhile the admin can ask for changes in words (reviseRun), undo them, and approve.
// intake: a paid request waits (status "intake") for the admin to look over its photos and add what the design needs (their
// own photos, the house picked on the map, instructions) before it runs (begin).
function createJobs({ dir, stripe = null, feeCents = 0, currency = 'usd', run, fixRun = null, reviseRun = null, hold = false, intake = false, now = () => Date.now(),
  kitCents = () => null, preview = null, notify = null, onKit = null }) {
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
  // previews by the design object they were made from (drafts and results), so polling doesn't recompile
  const previews = new WeakMap();
  const shown = (design, full) => { if (!design || full || !preview) return design;
    if (!previews.has(design)) { try { previews.set(design, preview(design)); } catch (e) { previews.set(design, { preview: true, name: design.name, parts: [], steps: [], subs: [], stats: {}, errors: [], warnings: [] }); } }
    return previews.get(design); };
  // held: finished under the hold (j.review) and not yet approved, so its owner sees it as still in progress. Designs
  // finished before the hold was turned on (no j.review) stay as their owners have seen them.
  const held = (j) => hold && !!j.review && !j.approved;
  const plateOf = (j) => (j.result && j.result.design && j.result.design.plate) || (j.params && j.params.plate) || 32;

  function emit(j, ev) {
    const { design, renders, overlay, site, report, stage, ...rest } = ev; // drafts are served separately; images stay on the server
    if (ev.type === 'draft' && design) { j.draft = design; j.draftN = (j.draftN || 0) + 1; rest.draftN = j.draftN; }
    if (ev.type === 'done') j.result = ev;
    // the mapped site: kept so a resumed design keeps its walls, and its report (with the map pictures) for the admin
    if (ev.type === 'siteDone' && site) { j.site = site; j.siteReport = report || null; }
    if (ev.type === 'site' && stage) { rest.id = stage.id; rest.title = stage.title; }
    j.events.push({ ...rest, t: now() });
    if (ev.type === 'done' || ev.type === 'error' || ev.type === 'draft' || ev.type === 'part' || ev.type === 'siteDone') save(j); // part: where a restart picks up
  }

  const ordered = (j) => { if (onKit) Promise.resolve().then(() => onKit(j)).catch((e) => console.error(`Stock check for ${j.id} failed: ${e.message}`)); };
  const tell = (j, kind) => { if (!notify || !j.email) return;
    Promise.resolve().then(() => notify(j, kind)).catch((e) => console.error(`Email (${kind}) for ${j.id} failed: ${e.message}`)); };
  // A change that didn't go through leaves the design as it was: say so on it, and drop the copy kept for undo,
  // so Undo still takes back the last change that did.
  const revisionFailed = (j, why) => {
    const rev = (j.revisions || []).find((r) => j.revising && r.at === j.revising.at);
    if (rev && !rev.failed) { rev.failed = why; if ((j.versions || []).length) j.versions.pop(); }
    j.revising = null;
  };
  function launch(j, fn) {
    j.status = 'running'; save(j);
    fn(j.params, (ev) => emit(j, ev))
      .then(() => { j.status = 'done';
        // after a revision the viewer shows what it ended on
        if (j.revising && j.result) { j.draft = j.result.design; j.draftN = (j.draftN || 0) + 1; }
        j.revising = null;
        if (j.result && hold && !j.review && !j.approved && !j.readySent) j.review = { since: now() }; // waiting for the admin
        if (j.result && !j.readySent && !held(j)) { j.readySent = now(); tell(j, 'ready'); } // once: not again after a fix round
        save(j); })
      .catch((e) => { const message = e && e.message ? e.message : String(e); emit(j, { type: 'error', message });
        if (j.revising) revisionFailed(j, message);
        // a revision that fails leaves the design as it was
        j.status = j.result ? 'done' : 'error'; save(j); });
  }

  // A change to a finished design (the admin's): the one it had is kept so the change can be undone.
  function change(id, { note, parts, runFn, extra }) {
    const j = load(id);
    if (!j || !runFn) return { code: 404, error: 'No such job' };
    if (j.status !== 'done' || !j.result) return { code: 409, error: j.status === 'running' ? 'A change is already being made.' : 'The design is not finished yet.' };
    if (!note) return { code: 400, error: 'Say what to change.' };
    j.versions = j.versions || []; j.revisions = j.revisions || [];
    j.versions.push({ at: now(), result: j.result });
    const rev = { at: now(), note, parts };
    j.revisions.push(rev); j.revising = { at: rev.at, note };
    emit(j, { type: 'status', message: `Making the change: ${note}` });
    const design = j.result.design;
    launch(j, (params, e) => runFn({ ...params, design, ...extra }, (ev) => { if (ev.type === 'cost') rev.costUsd = ev.usd; e(ev); }));
    return { code: 200, status: j.status };
  }

  return {
    fee: feeOn ? { amountCents: feeCents, currency } : null,

    // A new job for these (already cleaned) design parameters. Returns {id, checkout?}.
    async create(params, origin) {
      // the owner's email (to send the link) and the site's address (for links in emails) ride on the job, not in its params
      const { email = null, ...rest } = params;
      const j = { id: crypto.randomUUID(), createdAt: now(), status: feeOn ? 'awaiting_payment' : 'queued', params: rest, events: [], email, origin };
      jobs.set(j.id, j);
      if (!feeOn) { if (intake) { j.status = 'intake'; save(j); } else { save(j); launch(j, run); } return { id: j.id }; }
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
          if (!j.email && s.customer_details && s.customer_details.email) j.email = String(s.customer_details.email).toLowerCase();
        }
        if (intake && !j.begun) { j.status = 'intake'; save(j); } else launch(j, run);
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
        if (j.result) { j.status = 'done';
          if (j.revising) revisionFailed(j, 'Cut off by a server restart.');
          save(j); continue; }
        if (now() - (j.createdAt || 0) > RESUME_WITHIN_MS) { emit(j, { type: 'error', message: 'The design was cut off and is too old to pick up again.' }); j.status = 'error'; save(j); continue; }
        if ((j.resumes || 0) >= MAX_RESUMES) { emit(j, { type: 'error', message: 'The design was cut off too many times to finish.' }); j.status = 'error'; save(j); continue; }
        j.resumes = (j.resumes || 0) + 1;
        const parts = j.events.filter((e) => e.type === 'part' && Number.isInteger(e.n));
        let fromPart = parts.length ? parts[parts.length - 1].n : 1;
        const seed = fromPart > 1 ? j.draft : null;
        if (!seed) fromPart = 1;
        emit(j, { type: 'status', message: `Picking the design up again at part ${fromPart}.`, resumed: fromPart });
        launch(j, (params, e) => run({ ...params, resume: { fromPart, seed, site: j.site || null } }, e));
        ids.push(j.id);
      }
      return ids;
    },

    // One of the job's own photos, by index (the viewer shows them beside the model): {mediaType, data}.
    photo(id, n) {
      const j = load(id), ph = j && j.params && Array.isArray(j.params.photos) ? j.params.photos[n] : null;
      return ph && typeof ph.data === 'string' ? { mediaType: ph.mediaType, data: ph.data } : null;
    },

    // A design's line in "Your designs": its name (once a draft has one), the address it was made for, where it's
    // got to, and when it was started; null for no such job.
    summary(id) {
      const j = load(id);
      if (!j) return null;
      const d = (j.result && j.result.design) || j.draft || {};
      return { id: j.id, name: d.name || '', address: (j.params && j.params.address) || '', at: j.createdAt,
        status: j.status === 'done' && !held(j) ? 'ready' : j.status === 'error' ? 'problem' : j.status === 'awaiting_payment' ? 'unpaid' : 'designing' }; // intake too
    },

    // For the admin page: every job, newest first, with what the owner needs to run the business.
    list() {
      const out = [];
      for (const f of fs.readdirSync(dir)) {
        const j = f.endsWith('.json') ? load(f.slice(0, -5)) : null;
        if (!j) continue;
        // an error from before the latest Run again or restart is over: only one since then counts
        const since = j.events.reduce((k, e, i) => (e.type === 'status' && e.resumed ? i : k), -1);
        const d = (j.result && j.result.design) || j.draft || {}, parts = j.events.filter((e) => e.type === 'part'), err = j.events.slice(since + 1).filter((e) => e.type === 'error').pop();
        out.push({ id: j.id, createdAt: j.createdAt, status: j.status, name: d.name || '', address: (j.params && j.params.address) || '',
          plate: d.plate || (j.params && j.params.plate) || 32, email: j.email || null, photos: j.params && Array.isArray(j.params.photos) ? j.params.photos.length : 0,
          part: parts.length ? `${parts[parts.length - 1].n} of ${parts[parts.length - 1].of}` : null, error: err ? err.message : null,
          pieces: j.result && j.result.stats ? j.result.stats.pieces : null, problems: j.result ? (j.result.errors || 0) + (j.result.warnings || 0) : null,
          paid: !!j.paid, kit: j.kit ? { at: j.kit.at, amount: j.kit.amount, currency: j.kit.currency, name: j.kit.name, email: j.kit.email, shipping: j.kit.shipping, test: !!j.kit.test } : null,
          review: j.review || j.approved ? { approved: j.approved ? j.approved.at : null, since: j.review ? j.review.since : null, revisions: (j.revisions || []).length, revising: !!j.revising } : null,
          fulfillment: j.fulfillment || null, stock: j.stock || null, site: j.site ? { ftPerStud: j.site.ftPerStud, costUsd: j.site.costUsd, report: !!j.siteReport, needsCheck: !!(j.site.found && j.site.found.needsCheck) } : null });
      }
      return out.sort((a, b) => b.createdAt - a.createdAt);
    },

    // How the house was found and mapped from above, for the admin: {report, costUsd}, or null.
    siteReport(id) {
      const j = load(id);
      return j && j.siteReport ? { report: j.siteReport, costUsd: j.site ? j.site.costUsd : null } : null;
    },

    // The owner's progress on a kit order: status (ordered, packed, shipped), the supplier's order number, tracking.
    // Marking it shipped with tracking emails the customer once (notify 'shipped').
    setFulfillment(id, { status, supplierOrder, tracking, note } = {}) {
      const j = load(id);
      if (!j || !j.kit) return { code: 404, error: 'No kit order for that design.' };
      if (!FULFILLMENT.includes(status)) return { code: 400, error: `Status is one of ${FULFILLMENT.join(', ')}.` };
      const clip = (t, n) => String(t || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
      const was = j.fulfillment || {}, keep = (v, k, n) => (v === undefined ? was[k] || '' : clip(v, n)); // fields not sent stay as they were
      j.fulfillment = { status, supplierOrder: keep(supplierOrder, 'supplierOrder', 80), tracking: keep(tracking, 'tracking', 120), note: keep(note, 'note', 500), at: now(),
        shippedSent: was.shippedSent };
      if (status === 'shipped' && j.fulfillment.tracking && !j.fulfillment.shippedSent) { j.fulfillment.shippedSent = now(); tell(j, 'shipped'); }
      save(j);
      return { code: 200, fulfillment: j.fulfillment };
    },

    // The last stock check of a kit's parts at the supplier (server.js stockCheck), kept for the admin page.
    setStock(id, stock) {
      const j = load(id);
      if (!j) return null;
      j.stock = stock; save(j);
      return stock;
    },

    // Run a failed or cut-off design again, from the part it reached (its last draft), as a restart would.
    retry(id) {
      const j = load(id);
      if (!j) return { code: 404, error: 'No such job' };
      if (!['error', 'interrupted'].includes(j.status)) return { code: 409, error: `It's ${j.status}, not failed.` };
      if (feeOn && j.sessionId && !j.paid) return { code: 409, error: 'The design fee was never paid.' };
      const parts = j.events.filter((e) => e.type === 'part' && Number.isInteger(e.n));
      let fromPart = parts.length ? parts[parts.length - 1].n : 1; const seed = fromPart > 1 ? j.draft : null; if (!seed) fromPart = 1;
      emit(j, { type: 'status', message: `Running the design again from part ${fromPart}.`, resumed: fromPart });
      launch(j, (params, e) => run({ ...params, resume: { fromPart, seed, site: j.site || null } }, e));
      return { code: 200, status: j.status, fromPart };
    },

    // The finished designs made with this email address, newest first: [{id, name, at, origin}].
    // The designs made with an email address, newest first: finished ones and ones still being designed
    // (not ones whose design fee was never paid).
    byEmail(email) {
      const out = [];
      for (const f of fs.readdirSync(dir)) {
        const j = f.endsWith('.json') ? load(f.slice(0, -5)) : null;
        if (!j || j.email !== email || j.status === 'awaiting_payment') continue;
        out.push({ ...this.summary(j.id), origin: j.origin });
      }
      return out.sort((a, b) => b.at - a.at);
    },

    // Progress since event index `after`, plus the latest draft when the viewer doesn't have it yet.
    // full: the whole design even without a kit order (the server's own machine, for the owner)
    get(id, { after = 0, have = 0, full = false } = {}) {
      const j = load(id);
      if (!j) return null;
      const open = full || !!j.kit;
      // held for the admin's check: its owner sees it still in progress ("review"), with no drafts or result
      if (held(j) && !full && j.result) {
        return { id: j.id, status: 'review', paid: !!j.paid || !feeOn, kit: null, kitCents: null, kitCurrency: currency,
          photos: j.params && Array.isArray(j.params.photos) ? j.params.photos.length : 0,
          events: j.events.slice(after).filter((e) => e.type === 'status' || e.type === 'part' || e.type === 'site'), next: j.events.length };
      }
      return { id: j.id, status: j.status, paid: !!j.paid || !feeOn,
        ...(full && (j.review || j.approved) ? { review: { approved: j.approved ? j.approved.at : null, revisions: (j.revisions || []).map(({ at, note, parts, costUsd, undone, failed }) => ({ at, note, parts, costUsd, undone: !!undone, failed: failed || null })),
          revising: j.revising || null, canUndo: (j.versions || []).length > 0 } } : {}),
        kit: j.kit ? { at: j.kit.at, test: !!j.kit.test } : null, kitCents: kitCents(plateOf(j)), kitCurrency: currency,
        photos: j.params && Array.isArray(j.params.photos) ? j.params.photos.length : 0,
        events: j.events.slice(after), next: j.events.length,
        // a design in progress isn't shown to its owner, only that it's in progress: drafts go out once it's finished
        // (or to the server's own machine and the admin, who watch it take shape)
        ...(j.draftN > have && (full || j.status === 'done' || j.result) ? { draft: shown(j.draft, open), draftN: j.draftN } : {}),
        ...(j.status === 'done' && j.result ? { result: { ...j.result, design: shown(j.result.design, open) } } : {}) };
    },

    // Order the kit for a finished design: a Stripe Checkout (with the shipping address) for the kit's price,
    // or, with no Stripe key (local, demo, a test site), a test order that unlocks it at once. With {session}
    // (back from Stripe), confirm that this job's own kit session is paid and record the order.
    async kit(id, { origin, session } = {}) {
      const j = load(id);
      if (!j) return { code: 404, error: 'No such job' };
      if (j.status !== 'done' || !j.result || held(j)) return { code: 409, error: 'The design is not finished yet.' };
      if (j.kit) return { code: 200, ordered: true };
      if (!stripe) { j.kit = { at: now(), test: true }; save(j); ordered(j); return { code: 200, ordered: true, test: true }; }
      if (session) {
        if (session !== j.kitSession) return { code: 402, error: 'This payment link is not for this kit.' };
        const s = await stripe.getSession(session);
        if (s.payment_status !== 'paid' || !s.metadata || s.metadata.job !== id || s.metadata.kind !== 'kit') return { code: 402, error: 'The kit has not been paid for yet.' };
        const cd = s.customer_details || {}, ship = (s.collected_information && s.collected_information.shipping_details) || s.shipping_details || null;
        j.kit = { at: now(), amount: s.amount_total, currency: s.currency, session, email: cd.email || null, name: (ship && ship.name) || cd.name || null, shipping: ship ? ship.address : cd.address || null };
        save(j);
        if (!j.email && cd.email) j.email = String(cd.email).toLowerCase();
        tell(j, 'kit'); ordered(j);
        return { code: 200, ordered: true };
      }
      const cents = kitCents(plateOf(j));
      if (!cents) return { code: 503, error: 'Kit orders are not open yet.' };
      const s = await stripe.createCheckout({ jobId: j.id, amountCents: cents, currency, kind: 'kit', shipping: true,
        name: `Brick model kit: ${(j.result.design && j.result.design.name) || 'your house'}`,
        successUrl: `${origin}/app?job=${j.id}&kit={CHECKOUT_SESSION_ID}`, cancelUrl: `${origin}/app?job=${j.id}` });
      j.kitSession = s.id; save(j);
      return { code: 200, checkout: s.url };
    },

    // What the admin sees to prepare a request before its design: the owner's request (photos by index, served by photo()).
    intakeOf(id) {
      const j = load(id);
      if (!j) return null;
      const p = j.params || {};
      return { id: j.id, status: j.status, createdAt: j.createdAt, address: p.address || '', notes: p.ownerNotes !== undefined ? p.ownerNotes : p.notes || '', plate: p.plate || 32, choices: p.choices || [],
        views: p.views || [], photos: Array.isArray(p.photos) ? p.photos.length : 0, plan: !!p.plan, email: j.email || null, begun: j.begun || null };
    },

    // The admin starts the design, with what they added: their own photos (views like "aerial"), photos of the owner's
    // to leave out, views corrected, the house picked on the map ({lat, lon}), and instructions for the design.
    begin(id, { views = null, drop = [], add = [], instructions = '', pickAt = null } = {}) {
      const j = load(id);
      if (!j) return { code: 404, error: 'No such job' };
      if (j.status !== 'intake') return { code: 409, error: `It's ${j.status}, not waiting to start.` };
      const p = j.params, keep = (p.photos || []).map((_, i) => !drop.includes(i));
      if (Array.isArray(views)) { const nv = (p.photos || []).map((_, i) => views[i] || null); p.viewsChanged = JSON.stringify(nv) !== JSON.stringify((p.photos || []).map((_, i) => (p.views || [])[i] || null)); p.views = nv; }
      p.dropped = (p.photos || []).map((_, i) => i).filter((i) => !keep[i]); // photo() still serves them, for the owner's page
      p.teamPhotos = add; p.instructions = instructions || ''; p.pickAt = pickAt || null;
      j.begun = { at: now(), photosAdded: add.length, dropped: p.dropped.length, picked: !!pickAt, instructions: !!instructions };
      emit(j, { type: 'status', message: 'Our team looked over the photos; starting the design.' });
      launch(j, run);
      return { code: 200, status: j.status };
    },

    // The admin asks for a change in words, about the pieces they selected (selection: [{op, phase, kind, parts: [...]}]):
    // the design is revised from the one it has, and the one it had is kept so the change can be undone.
    revise(id, { note, selection = [], parts = 0 } = {}) {
      note = String(note || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 1000);
      return change(id, { note, parts: Number(parts) || 0, runFn: reviseRun, extra: { note, selection } });
    },

    // The admin has the design go through repair rounds again until it compiles clean ("Fix what the checker
    // found"), kept and undone like a change. Customers can't: what they see is what the admin approved.
    fix(id) { return change(id, { note: 'Fix what the checker found', parts: 0, runFn: fixRun, extra: {} }); },


    // Put back the design as it was before the last change.
    undo(id) {
      const j = load(id);
      if (!j) return { code: 404, error: 'No such job' };
      if (j.status !== 'done' || !(j.versions || []).length) return { code: 409, error: 'There is no change to undo.' };
      j.result = j.versions.pop().result;
      const last = [...(j.revisions || [])].reverse().find((r) => !r.undone && !r.failed); if (last) last.undone = now();
      j.draft = j.result.design; j.draftN = (j.draftN || 0) + 1;
      emit(j, { type: 'status', message: 'Undid the last change.' });
      save(j);
      return { code: 200, status: j.status };
    },

    // The admin approves the design: its owner sees it (and gets the "ready" email) from now on.
    approve(id) {
      const j = load(id);
      if (!j) return { code: 404, error: 'No such job' };
      if (j.status !== 'done' || !j.result) return { code: 409, error: 'The design is not finished yet.' };
      if (!j.approved) j.approved = { at: now() };
      if (!j.readySent) { j.readySent = now(); tell(j, 'ready'); }
      save(j);
      return { code: 200, approved: j.approved.at };
    },


  };
}

module.exports = { createJobs, MAX_RESUMES, FULFILLMENT };
