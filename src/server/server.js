// Brickhouse server. Serves the viewer and designs, and runs photo-to-model jobs.
//   npm start                      real Claude (needs BRICKHOUSE_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY)
//   BRICKHOUSE_FAKE=1 npm start    scripted Claude, no key needed
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { designHouse, surveyHouse, checkPhotos } = require('./designer');
const { reviseTask } = require('./prompt');
const { makePreview } = require('./preview');
const { makeMailer, cleanEmail, readyEmail, kitEmail, shippedEmail, mineEmail } = require('./mail');
const { scaleFor, sizeName } = require('./scale');
const { okPhoto, cleanViews, viewsNote: viewsNoteOf, VIEWS } = require('./views');
const { lookupAddress, fetchMapillaryImage } = require('./lookup');
const { lookupTerrain } = require('./terrain');
const { prepareDesign } = require('./pipeline');
const { siteReportHtml } = require('./sitereport');
const { createJobs } = require('./jobs');
const { makeStripe } = require('./payments');
const { anthropicKey, makeAnthropicClient } = require('./client');
const { makeQuoter, cleanLots, LDRAW_COLOR } = require('./gobricks');

const ROOT = path.resolve(__dirname, '../..');
loadDotEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 5173);
const MODEL = process.env.BRICKHOUSE_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.BRICKHOUSE_EFFORT || null; // low | medium | high | xhigh | max
// The survey (first look and questions for the owner) is meant to be cheap: low effort by default,
// optionally a cheaper model.
const SURVEY_MODEL = process.env.BRICKHOUSE_SURVEY_MODEL || MODEL;
const SURVEY_EFFORT = process.env.BRICKHOUSE_SURVEY_EFFORT || 'low';
// Mapping the house from above (site.js) decides the model's walls, so it may use a stronger model; it falls back
// to MODEL when that one isn't open to the account. A design stops at BRICKHOUSE_DESIGN_BUDGET_USD of API time
// (0 for no limit), keeping its last draft.
const SITE_MODEL = process.env.BRICKHOUSE_SITE_MODEL || MODEL;
// After the five parts, a model (the site model unless BRICKHOUSE_REVIEW_MODEL says) compares renders of the design with
// the photos and lists fixes the design then makes; BRICKHOUSE_REVIEW=0 turns it off.
const REVIEW = process.env.BRICKHOUSE_REVIEW === '0' ? null : { model: process.env.BRICKHOUSE_REVIEW_MODEL || SITE_MODEL, effort: 'high' };
// every paid request waits for the admin to look over its photos before its design starts (=0 turns it off)
const INTAKE = process.env.BRICKHOUSE_HOLD_BEFORE_DESIGN !== '0';
// every finished design waits for the admin's approval before its owner sees it (BRICKHOUSE_HOLD_FOR_REVIEW=0 turns it off)
const HOLD = process.env.BRICKHOUSE_HOLD_FOR_REVIEW !== '0';
const REVISE_BUDGET_USD = 5; // one requested change
const BUDGET_USD = process.env.BRICKHOUSE_DESIGN_BUDGET_USD !== undefined ? Number(process.env.BRICKHOUSE_DESIGN_BUDGET_USD) || null : 15;
const FAKE = process.env.BRICKHOUSE_FAKE === '1';
const MAX_BODY = 40 * 1024 * 1024;
const MAX_PHOTOS = 12; // the API takes up to 100 images a request; the design loop keeps the rest of its 90 for renders

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

function makeClient() {
  if (FAKE) return require('./fakeClient').makeFakeClient();
  return makeAnthropicClient();
}

// the top bar, one component for both pages (src/viewer/topbar.html), put in place of each page's placeholder
const { withTopbar } = require('./bundle');

const STATIC = {
  '/': ['src/viewer/landing.html', 'text/html; charset=utf-8'],
  '/app': ['src/viewer/index.html', 'text/html; charset=utf-8'],
  '/admin': ['src/viewer/admin.html', 'text/html; charset=utf-8'],
  '/admin/intake': ['src/viewer/intake.html', 'text/html; charset=utf-8'], // preparing a request before its design (its API is the admin's)
  '/index.html': ['src/viewer/index.html', 'text/html; charset=utf-8'],
  '/img/sample-634.jpg': ['src/viewer/img/sample-634.jpg', 'image/jpeg'],
  '/img/sample-savannah.jpg': ['src/viewer/img/sample-savannah.jpg', 'image/jpeg'],
  '/img/hero-house.png': ['src/viewer/img/hero-house.png', 'image/png'],
  '/img/build-house.png': ['src/viewer/img/build-house.png', 'image/png'],
  '/viewer/app.js': ['src/viewer/app.js', 'text/javascript; charset=utf-8'],
  '/viewer/ldraw-parts.js': ['src/viewer/ldraw-parts.js', 'text/javascript; charset=utf-8'],
  '/engine.js': ['src/engine/engine.js', 'text/javascript; charset=utf-8'],
  '/parts-availability.js': ['src/engine/parts-availability.js', 'text/javascript; charset=utf-8'],
  '/suppliers.js': ['src/engine/suppliers.js', 'text/javascript; charset=utf-8'],
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// Customers' houses (designs/generated) are private: each customer sees theirs through its job link.
// Only a request made on this machine itself (local development, no proxy in front) may list or open them.
function onThisMachine(req) {
  const a = req.socket.remoteAddress || '';
  return !req.headers['x-forwarded-for'] && (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1');
}

function listDesigns(all) {
  const out = [];
  for (const dir of all ? ['designs', 'designs/generated'] : ['designs']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) if (f.endsWith('.json')) out.push((dir === 'designs' ? '' : 'generated/') + f.replace(/\.json$/, ''));
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Upload is too large (40 MB max).')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function slug(s) { return String(s || 'house').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'house'; }

const NO_KEY = 'Set BRICKHOUSE_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) in .env, or run with BRICKHOUSE_FAKE=1 to try the flow.';
// Draft renders need Playwright; one browser serves every job, started on first use.
let rendererP = null;
const getRenderer = () => (rendererP = rendererP || require('./render').makeRenderer().catch(() => null));
// Free text from the form, cleaned before it goes anywhere near the design: no control characters, one line, no
// double quotes (the task quotes the notes), and short. The limits match the form's (index.html).
const NOTES_MAX = 500, ADDRESS_MAX = 200, ANSWER_MAX = 200;
const cleanText = (t, max) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/"/g, "'").replace(/\s+/g, ' ').trim().slice(0, max);
// an address: some letters and some length, no more than a real one needs
const cleanAddress = (a) => { const t = cleanText(a, ADDRESS_MAX); return t.length >= 5 && /[a-z]/i.test(t) ? t : null; };
const cleanPhotos = (list) => (list || []).slice(0, MAX_PHOTOS).filter(okPhoto);
// The upload page's checklist says which view each photo is (views.js): a sentence after the owner's notes
const viewsNote = (photos, views) => viewsNoteOf(photos, views, MAX_PHOTOS);
const withViews = (notes, body) => [notes, viewsNote(body.photos, body.views)].filter(Boolean).join(' ');

// POST /api/survey {photos, notes}: a cheap first look; returns {summary, seen, questions} for the owner to answer.
async function handleSurvey(req, res) {
  const client = makeClient();
  if (!client) return send(res, 503, { error: NO_KEY });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: e.message }); }
  const photos = cleanPhotos(body.photos);
  if (!photos.length) return send(res, 400, { error: 'Add at least one photo to check.' });
  if (limited(req, 'survey', 30)) return send(res, 429, { error: 'Too many checks from here; try again in an hour.' });
  try {
    const screen = await checkPhotos({ client, model: SURVEY_MODEL, photos, plan: cleanPhotos([body.plan])[0] || null });
    if (!screen.ok) return send(res, 422, { error: screen.message, problems: screen.problems });
    // With an address, the survey sees the same building, street and slope facts as the design.
    const prep = await prepareDesign({ address: cleanAddress(body.address), notes: withViews(cleanText(body.notes, NOTES_MAX), body), plate: scaleFor(body.plate).plate, lockToOutline: false });
    const out = await surveyHouse({ client, model: SURVEY_MODEL, effort: SURVEY_EFFORT, photos, plan: cleanPhotos([body.plan])[0] || null, notes: prep.notes });
    send(res, 200, { summary: out.summary, seen: out.seen, questions: out.questions, model: FAKE ? 'fake' : SURVEY_MODEL });
  } catch (e) { send(res, 502, { error: e && e.message ? e.message : String(e) }); }
}

// POST /api/address {address}: whether it's a real street address, and how the lookup reads it ({ok, label?, message?}),
// checked on the upload page as the owner leaves the field. BRICKHOUSE_ADDRESS_CHECK=0 turns the check off.
const addressCheck = (a) => (process.env.BRICKHOUSE_ADDRESS_CHECK === '0' ? Promise.resolve({ ok: true, unchecked: true })
  : require('./lookup').checkAddress(a).catch(() => ({ ok: true, unchecked: true })));
async function handleAddress(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: e.message }); }
  const a = cleanAddress(body.address);
  if (!a) return send(res, 200, { ok: false, message: 'Please enter the house\'s address.' });
  if (limited(req, 'address', 60)) return send(res, 429, { error: 'Too many checks from here; try again in an hour.' });
  const r = await addressCheck(a);
  send(res, 200, { ok: r.ok, ...(r.label ? { label: r.label } : {}), ...(r.message ? { message: r.message } : {}) });
}

// A design request's parameters, cleaned: photos, notes, target, choices, credits, plan, address, plate.
function parseDesignRequest(body) {
  const sc = scaleFor(body.plate);
  return {
    photos: cleanPhotos(body.photos), plate: sc.plate,
    views: cleanViews(body.photos, body.views, MAX_PHOTOS), // which view each kept photo shows, for the site step
    target: Math.max(300, Math.min(3000, Number(body.target) || sc.target)),
    notes: withViews(cleanText(body.notes, NOTES_MAX), body), // the checklist's views follow the owner's notes
    ownerNotes: cleanText(body.notes, NOTES_MAX), // the notes alone, for when our team changes the photos before the design
    // The owner's answers to the survey, as {question, answer, detail}; the design follows them.
    choices: (Array.isArray(body.choices) ? body.choices : []).slice(0, 8)
      .map((c) => c && ({ question: cleanText(c.question, 200), answer: cleanText(c.answer, ANSWER_MAX), detail: cleanText(c.detail, 300) }))
      .filter((c) => c && c.question && c.answer),
    // Credits for looked-up photos (source, author, license) travel with the saved design.
    credits: (Array.isArray(body.credits) ? body.credits : []).slice(0, MAX_PHOTOS)
      .map((c) => c && ({ credit: String(c.credit || '').slice(0, 200), license: String(c.license || '').slice(0, 60), page: String(c.page || '').slice(0, 300) }))
      .filter((c) => c && c.credit),
    plan: cleanPhotos([body.plan])[0] || null, address: cleanAddress(body.address),
    frontStreet: body.frontStreet ? String(body.frontStreet).slice(0, 100) : null,
    // optional: where to email the design's link (jobs.js keeps it on the job, not in the design's parameters)
    email: cleanEmail(body.email),
  };
}

// Save a finished design and report it.
function finishDesign(out, p, emit, t0, site = null) {
  if (p.credits.length) out.design.photoCredits = p.credits;
  if (site && site.credits && site.credits.length) out.design.mapCredits = site.credits;
  const name = `${slug(out.design.name)}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  fs.writeFileSync(path.join(ROOT, 'designs/generated', name + '.json'), JSON.stringify(out.design, null, 2));
  emit({ type: 'done', design: out.design, stats: out.result.stats, errors: out.result.errors.length + (out.planProblems || []).length, planProblems: out.planProblems || [],
    warnings: out.result.warnings.length, compiles: out.compiles, seconds: Math.round((Date.now() - t0) / 1000),
    saved: `generated/${name}`, note: out.note || null, model: FAKE ? 'fake' : MODEL });
}

// The photos a design uses: the owner's (less any our team left out) then the ones our team added before the design, with
// which view each shows and a sentence saying so (the owner's notes come first; they may say more).
const MAX_TEAM_PHOTOS = 4;
function designPhotos(p) {
  const drop = new Set(p.dropped || []), photos = [], views = [], team = [];
  (p.photos || []).forEach((ph, i) => { if (!drop.has(i)) { photos.push(ph); views.push((p.views || [])[i] || null); team.push(false); } });
  (p.teamPhotos || []).forEach((t) => { photos.push({ mediaType: t.mediaType, data: t.data }); views.push(t.view || null); team.push(true); });
  if (p.ownerNotes === undefined || (!drop.size && !(p.teamPhotos || []).length && !p.viewsChanged)) return { photos, views, notes: p.notes }; // as the owner sent them
  const said = views.map((v, i) => (v && VIEWS[v] ? `photo ${i + 1}${team[i] ? ' (added by our team)' : ''} shows ${VIEWS[v]}` : team[i] ? `photo ${i + 1} was added by our team` : null)).filter(Boolean);
  return { photos, views, notes: [p.ownerNotes, said.length ? `Which photo shows what: ${said.join(', ')} (left and right as seen from the street).` : ''].filter(Boolean).join(' ') };
}

// The same steps as scripts/design.js: address facts, the house found and mapped from above (or walls locked to
// the plan or the building outline), then the house built in parts with renders of each draft (pipeline.js).
// A resumed job reuses the site it mapped (jobs.js keeps it), so its walls stay the ones the draft was built on.
async function runDesign(p0, emit) {
  const client = makeClient(), t0 = Date.now();
  if (!client) throw new Error(NO_KEY);
  const dp = designPhotos(p0), p = { ...p0, photos: dp.photos, views: dp.views, notes: dp.notes };
  const renderer = await getRenderer(), kept = (p.resume && p.resume.site) || null;
  if (p.address && !kept) emit({ type: 'status', message: 'Looking up the building, streets and slope…' });
  const prep = await prepareDesign({ address: p.address, notes: p.notes, plan: p.plan, plate: p.plate, frontStreet: p.frontStreet, site: kept,
    photos: FAKE ? [] : p.photos, views: p.views || [], client, model: MODEL, siteModel: SITE_MODEL, tools: renderer, onEvent: emit, pickAt: p.pickAt || null });
  prep.log.forEach((m) => emit({ type: 'status', message: m }));
  if (prep.site && !kept) emit({ type: 'siteDone', site: prep.site, report: prep.report || null });
  const out = await designHouse({ client, model: MODEL, effort: EFFORT, photos: p.photos, plan: p.plan, notes: prep.notes, target: p.target, choices: p.choices,
    plate: p.plate, mode: 'parts', locked: prep.locked, render: renderer && renderer.render, planTools: renderer, onEvent: emit, supplier: SUPPLIER,
    ...(prep.site ? { ftPerStud: prep.site.ftPerStud, siteImages: prep.site.images, siteNote: prep.site.note } : {}),
    budgetUsd: BUDGET_USD, spentUsd: prep.site && !kept ? prep.site.costUsd || 0 : 0, review: FAKE ? null : REVIEW, views: p.views || [], teamNotes: p.instructions || '',
    ...(p.resume ? { fromPart: p.resume.fromPart, seed: p.resume.seed } : {}) });
  finishDesign(out, p, emit, t0, prep.site);
}

// Repair rounds on a finished design, which the admin asks for from the review card (jobs.js fix).
async function runFix(p, emit) {
  const client = makeClient(), t0 = Date.now();
  if (!client) throw new Error(NO_KEY);
  const out = await designHouse({ client, model: MODEL, effort: EFFORT, photos: p.photos, notes: p.notes, target: p.target, plate: p.plate, mode: 'fix', design: p.design, onEvent: emit,
    ftPerStud: p.design && p.design.stud, budgetUsd: BUDGET_USD }); // a scale fitted to the house stays with it
  finishDesign(out, p, emit, t0);
}

// The pieces the admin clicked, by the ops that made them, for the change they ask for (prompt.js reviseTask).
// Part ids are the engine's, from compiling the same design the admin's viewer compiled.
function selectionOf(design, ids) {
  const { compile } = require('../engine/engine.js');
  const want = new Set((Array.isArray(ids) ? ids : []).slice(0, 3000).map(Number).filter(Number.isInteger)), r = compile(design), byOp = new Map();
  for (const p of r.parts) if (want.has(p.id) && Number.isInteger(p.op)) { if (!byOp.has(p.op)) byOp.set(p.op, []); byOp.get(p.op).push(p); }
  return [...byOp].map(([op, ps]) => { const o = design.ops[op] || {};
    return { op, kind: o.op || 'op', phase: o.phase || '', note: o.note || '', count: ps.length, of: r.parts.filter((q) => q.op === op).length,
      parts: ps.slice(0, 12).map((p) => ({ name: p.name, color: p.color, at: [p.x, p.y, p.z] })) }; });
}

// A change the admin asked for on a finished design (jobs.js revise): Claude edits it from the one it has.
async function runRevise(p, emit) {
  const client = makeClient(), t0 = Date.now();
  if (!client) throw new Error(NO_KEY);
  const renderer = await getRenderer(), dp = designPhotos(p); // the photos the design was made from, our team's included
  const out = await designHouse({ client, model: MODEL, effort: EFFORT, photos: dp.photos, notes: dp.notes, target: p.target, plate: p.plate, mode: 'fix', design: p.design,
    task: reviseTask({ design: p.design, note: p.note, selection: p.selection || [] }), render: renderer && renderer.render, supplier: SUPPLIER,
    ftPerStud: p.design && p.design.stud, budgetUsd: REVISE_BUDGET_USD, onEvent: emit });
  emit({ type: 'cost', usd: out.costUsd });
  finishDesign(out, p, emit, t0);
}

// Design jobs, paid for through Stripe Checkout when STRIPE_SECRET_KEY is set (see jobs.js).
// Kits are made from GoBricks bricks (bought at Brickwith), so every customer design is held to what GoBricks makes;
// BRICKHOUSE_SUPPLIER sets another ("" for LEGO availability). The scripted demo client's design isn't.
const SUPPLIER = FAKE ? null : (process.env.BRICKHOUSE_SUPPLIER !== undefined ? process.env.BRICKHOUSE_SUPPLIER || null : 'gobricks');
// Email through Resend (mail.js): RESEND_API_KEY turns it on, BRICKHOUSE_MAIL_FROM is the sender
const MAILER = makeMailer({ apiKey: process.env.RESEND_API_KEY, ...(process.env.BRICKHOUSE_MAIL_FROM ? { from: process.env.BRICKHOUSE_MAIL_FROM } : {}) });
const JOBS = createJobs({
  dir: path.join(ROOT, 'designs/generated/jobs'),
  stripe: makeStripe({ secretKey: process.env.STRIPE_SECRET_KEY, ...(process.env.BRICKHOUSE_STRIPE_API ? { apiBase: process.env.BRICKHOUSE_STRIPE_API } : {}) }), // the override is for local tests
  feeCents: Number(process.env.BRICKHOUSE_DESIGN_FEE_CENTS || 1500), currency: process.env.BRICKHOUSE_CURRENCY || 'usd',
  run: runDesign, fixRun: runFix, reviseRun: runRevise, hold: HOLD, intake: INTAKE,
  // the kit's price by baseplate: Mini (16), Classic (32) and Grand (48); unset means that size isn't on sale yet
  kitCents: (plate) => Number(process.env[`BRICKHOUSE_KIT_${sizeName(plate).toUpperCase()}_CENTS`]) || null,
  preview: makePreview,
  onKit: (j) => QUOTER && SUPPLIER === 'gobricks' && stockCheck(j.id),
  notify: async (j, kind) => {
    if (!MAILER) return;
    const link = `${j.origin}/app?job=${j.id}`, name = j.result && j.result.design && j.result.design.name;
    const make = kind === 'kit' ? kitEmail : kind === 'shipped' ? shippedEmail : readyEmail;
    await MAILER.send({ to: j.email, ...make({ name, link, tracking: j.fulfillment && j.fulfillment.tracking }) });
  },
});
const originOf = (req) => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

// A few requests per address per hour for the steps that cost something before any payment.
const hits = new Map();
function limited(req, key, perHour) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(), k = `${key}|${ip}`, t = Date.now();
  const recent = (hits.get(k) || []).filter((x) => t - x < 3600e3);
  recent.push(t); hits.set(k, recent);
  return recent.length > perHour;
}

async function handleJobs(req, res, url) {
  // POST /api/jobs/summary {ids}: the lines of "Your designs" on a device, for the ids it already holds (each id
  // is the design's own private link, so this shows nothing its holder can't already open)
  if (req.method === 'POST' && url.pathname === '/api/jobs/summary') {
    let ids;
    try { ids = JSON.parse(await readBody(req)).ids; } catch (e) { return send(res, 400, { error: e.message }); }
    if (!Array.isArray(ids)) return send(res, 400, { error: 'Send {ids: [...]}' });
    const ok = ids.slice(0, 50).filter((x) => typeof x === 'string' && /^[a-f0-9-]{36}$/.test(x));
    return send(res, 200, { designs: ok.map((x) => JOBS.summary(x)).filter(Boolean) });
  }
  // GET /api/jobs/<id>/photos/<n>: the job's own photos, as private as the job's link
  const ph = /^\/api\/jobs\/([a-f0-9-]{36})\/photos\/(\d{1,2})$/.exec(url.pathname);
  if (req.method === 'GET' && ph) {
    const img = JOBS.photo(ph[1], Number(ph[2]));
    if (!img || !/^image\/(jpeg|png|webp|gif)$/.test(img.mediaType)) return send(res, 404, { error: 'No such photo' });
    return send(res, 200, Buffer.from(img.data, 'base64'), img.mediaType);
  }
  const m = /^\/api\/jobs(?:\/([a-f0-9-]{36})(?:\/(start|kit))?)?$/.exec(url.pathname);
  if (!m) return send(res, 404, { error: 'Not found' });

  const [, id, action] = m;
  try {
    if (req.method === 'POST' && !id) {
      if (!FAKE && !anthropicKey()) return send(res, 503, { error: NO_KEY });
      if (limited(req, 'job', 20)) return send(res, 429, { error: 'Too many designs started from here; try again in an hour.' });
      const p = parseDesignRequest(JSON.parse(await readBody(req)));
      if (!p.address) return send(res, 400, { error: 'Please enter the house\'s address.', field: 'address' });
      // a real street address, before anything is saved or paid for (lookup.js checkAddress)
      const addr = await addressCheck(p.address);
      if (!addr.ok) return send(res, 422, { error: addr.message, field: 'address' });
      if (!p.photos.length && !p.notes) return send(res, 400, { error: 'Add at least one photo or a description.' });
      // Before anything is saved or paid for: the photos must show one home (photoVerdict in designer.js)
      const screen = await checkPhotos({ client: makeClient(), model: SURVEY_MODEL, photos: p.photos, plan: p.plan });
      if (!screen.ok) return send(res, 422, { error: screen.message, problems: screen.problems });
      return send(res, 200, await JOBS.create(p, originOf(req)));
    }
    if (req.method === 'POST' && action === 'start') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await JOBS.start(id, body.session ? String(body.session) : null);
      return send(res, r.code, r);
    }
    // order the kit (a Stripe Checkout link), or confirm it on return from Stripe ({session})
    if (req.method === 'POST' && action === 'kit') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const r = await JOBS.kit(id, { origin: originOf(req), session: body.session ? String(body.session) : null });
      return send(res, r.code, r);
    }
    if (req.method === 'GET' && !action) {
      // before the kit is ordered, the design comes as a preview (preview.js); the owner's own machine sees it all
      const r = JOBS.get(id, { after: Number(url.searchParams.get('after')) || 0, have: Number(url.searchParams.get('have')) || 0, full: onThisMachine(req) || isAdmin(req) });
      return r ? send(res, 200, r) : send(res, 404, { error: 'No such job' });
    }
    send(res, 405, { error: 'Method not allowed' });
  } catch (e) { send(res, 502, { error: e && e.message ? e.message : String(e) }); }
}

// "Your designs" on another device: POST /api/mine {email} emails a sign-in link, /app?mine=<token>, and
// GET /api/mine?token= lists that address's designs for it. Typing an email alone never shows anything (anyone
// could type anyone's), so the list needs the token, which only the inbox gets: the email and an expiry, signed
// with a server secret (BRICKHOUSE_SECRET, or one made once and kept with the jobs). It works for 24 hours.
const MINE_TTL_MS = 24 * 3600e3;
let mineSecret = null;
function secret() {
  if (mineSecret) return mineSecret;
  if (process.env.BRICKHOUSE_SECRET) return (mineSecret = process.env.BRICKHOUSE_SECRET);
  const f = path.join(ROOT, 'designs/generated/jobs/.secret');
  try { mineSecret = fs.readFileSync(f, 'utf8').trim(); } catch (e) { /* first run */ }
  if (!mineSecret) { mineSecret = require('node:crypto').randomBytes(32).toString('hex'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, mineSecret, { mode: 0o600 }); }
  return mineSecret;
}
const sign = (s) => require('node:crypto').createHmac('sha256', secret()).update('brickhouse-mine-v1|' + s).digest('base64url');
function mineToken(email, now = Date.now()) { const p = Buffer.from(JSON.stringify({ e: email, x: now + MINE_TTL_MS })).toString('base64url'); return `${p}.${sign(p)}`; }
function mineEmailOf(token, now = Date.now()) {
  const [p, sig] = String(token || '').split('.');
  if (!p || !sig || sig.length !== 43) return null;
  const want = Buffer.from(sign(p)), got = Buffer.from(sig);
  if (got.length !== want.length || !require('node:crypto').timingSafeEqual(got, want)) return null;
  try { const { e, x } = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); return typeof e === 'string' && x > now ? e : null; } catch (e) { return null; }
}
// GET /api/mine?token=: the designs for the link's email, [{id, name, at, status}]
function handleMineList(res, token) {
  const email = mineEmailOf(token);
  if (!email) return send(res, 401, { error: 'That link has expired. Enter your email again for a new one.' });
  send(res, 200, { designs: JOBS.byEmail(email).slice(0, 50).map(({ id, name, address, at, status }) => ({ id, name, address, at, status })) });
}
// POST /api/mine {email}: the answer is the same whether or not there are any designs, so it can't be used to
// learn whose email has designs.
async function handleMine(req, res) {
  if (!MAILER) return send(res, 503, { error: 'Email isn\'t set up on this site yet.' });
  let email;
  try { email = cleanEmail(JSON.parse(await readBody(req)).email); } catch (e) { return send(res, 400, { error: e.message }); }
  if (!email) return send(res, 400, { error: 'Please enter a valid email address.' });
  if (limited(req, 'mine', 5)) return send(res, 429, { error: 'Too many requests from here; try again in an hour.' });
  const designs = JOBS.byEmail(email);
  if (designs.length) try { await MAILER.send({ to: email, ...mineEmail({ count: designs.length, link: `${designs[0].origin || originOf(req)}/app?mine=${mineToken(email)}` }) }); }
  catch (e) { console.error(`Your designs email failed: ${e.message}`); }
  send(res, 200, { ok: true });
}

async function handleLookup(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: e.message }); }
  try { send(res, 200, await lookupAddress(body.address)); } catch (e) { send(res, 502, { error: e.message }); }
}

// GoBricks quotes come from its part-list matcher, which isn't a documented API (see gobricks.js):
// BRICKHOUSE_GOBRICKS_QUOTES=0 turns them off. BRICKHOUSE_CNY_PER_USD sets how many of GoBricks'
// yuan make a dollar at Brickwith, its store (about 3.5; the viewer uses that by default),
// for its approximate dollar figure.
const QUOTER = process.env.BRICKHOUSE_GOBRICKS_QUOTES === '0' ? null : makeQuoter();
const CNY_PER_USD = Number(process.env.BRICKHOUSE_CNY_PER_USD) || null;

// POST /api/quote {lots: [{no, color, q}]}: today's GoBricks price and stock for a parts list
async function handleQuote(req, res) {
  if (!QUOTER) return send(res, 503, { error: 'GoBricks quotes are off on this server.' });
  let lots;
  try { lots = cleanLots(JSON.parse(await readBody(req)).lots); } catch (e) { return send(res, 400, { error: e.message }); }
  if (!lots) return send(res, 400, { error: 'Send the parts list as {lots: [{no, color, q}]}, at most 600 lots.' });
  if (!QUOTER.cached(lots) && limited(req, 'quote', 30)) return send(res, 429, { error: 'Too many quotes from here; try again in an hour.' });
  try { send(res, 200, await QUOTER.quote(lots)); } catch (e) { send(res, 502, { error: e.message }); }
}

async function handlePhoto(res, id) {
  if (!process.env.MAPILLARY_TOKEN) return send(res, 503, { error: 'Set MAPILLARY_TOKEN in .env.' });
  try {
    const img = await fetchMapillaryImage(id, process.env.MAPILLARY_TOKEN);
    send(res, 200, img.bytes, img.mediaType);
  } catch (e) { send(res, 502, { error: e.message }); }
}

// On a public host, BRICKHOUSE_PASSWORD puts the whole site behind a browser password prompt (any
// user name), so strangers can't spend the API key. /healthz stays open for the host's health check.
const PASSWORD = process.env.BRICKHOUSE_PASSWORD || '';
function authorized(req) {
  if (!PASSWORD) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  const given = Buffer.from(m ? Buffer.from(m[1], 'base64').toString('utf8').replace(/^[^:]*:/, '') : '');
  const want = Buffer.from(PASSWORD);
  return given.length === want.length && require('node:crypto').timingSafeEqual(given, want);
}

// The admin page (/admin): every design and kit order, the parts list to order from Brickwith, fulfillment, retry.
// BRICKHOUSE_ADMIN_PASSWORD turns it on; signing in sets an HttpOnly, SameSite=Strict cookie holding an HMAC of
// the password, so changing the password signs everyone out. The admin also sees every design in full.
const crypto = require('node:crypto');
const ADMIN_PASSWORD = process.env.BRICKHOUSE_ADMIN_PASSWORD || '';
const adminToken = () => crypto.createHmac('sha256', ADMIN_PASSWORD).update('brickhouse-admin-v1').digest('hex');
const sameSecret = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
function isAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const m = /(?:^|;\s*)bh_admin=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return !!m && sameSecret(m[1], adminToken());
}
const adminCookie = (req, value, maxAge) => `bh_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${(req.headers['x-forwarded-proto'] || '') === 'https' ? '; Secure' : ''}`;
// A design's parts to order: the inventory without the baseplate, which is added by hand (GoBricks' own has no LEGO
// number), except the Mini's 16 x 16 plate, an ordinary part that goes in the list
function orderRows(design) {
  const { COLORS, BASEPLATES, compile } = require('../engine/engine.js');
  const plainPlate = !!(BASEPLATES[design.plate] || {}).thick;
  return compile(design).inventory.filter((e) => (e.kind !== 'baseplate' || plainPlate) && COLORS[e.color]);
}
// A design's parts as a BrickLink XML wanted list, for Brickwith's part-list upload
function partsXml(design) {
  const { COLORS } = require('../engine/engine.js');
  const rows = orderRows(design);
  return '<INVENTORY>\n' + rows.map((r) => `  <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${r.no}</ITEMID><COLOR>${COLORS[r.color].bl}</COLOR><MINQTY>${r.q}</MINQTY></ITEM>`).join('\n') + '\n</INVENTORY>\n';
}
// A kit's stock check: today's GoBricks stock for the parts the admin is about to order at Brickwith (run when
// the kit is ordered, and again from the admin page). Kept on the job: lots short of stock (with what GoBricks has),
// lots it doesn't make (the snapshot in suppliers.js has gone stale), and today's total in yuan. A failure is kept
// too, so the admin sees the check didn't happen; the order itself never depends on it.
async function stockCheck(id) {
  const j = JOBS.get(id, { full: true }), d = j && j.result && j.result.design;
  if (!d) return null;
  const lots = orderRows(d).filter((e) => LDRAW_COLOR[e.color] !== undefined).map((e) => ({ no: e.no, color: e.color, q: e.q, name: e.name }));
  let stock;
  try {
    const q = await QUOTER.quote(lots, { fresh: true });
    stock = { at: Date.now(), ok: !q.outOfStock.length && !q.notMade.length, lots: lots.length, total: q.total, currency: q.currency,
      short: q.outOfStock.map(({ no, name, color, q: need, stock: has, gds }) => ({ no, name, color, need, has: has || 0, gds })),
      notMade: q.notMade.map(({ no, name, color, q: need }) => ({ no, name, color, need })) };
  } catch (e) { stock = { at: Date.now(), error: e.message }; }
  return JOBS.setStock(id, stock);
}
async function handleAdmin(req, res, url) {
  if (!ADMIN_PASSWORD) return send(res, 503, { error: 'Set BRICKHOUSE_ADMIN_PASSWORD to use the admin page.' });
  if (req.method === 'POST' && url.pathname === '/admin/login') {
    if (limited(req, 'admin-login', 10)) return send(res, 429, { error: 'Too many tries; wait an hour.' });
    let pw = ''; try { pw = String(JSON.parse(await readBody(req)).password || ''); } catch (e) { /* no body */ }
    if (!sameSecret(pw, ADMIN_PASSWORD)) return send(res, 401, { error: 'Wrong password.' });
    res.setHeader('set-cookie', adminCookie(req, adminToken(), 30 * 86400));
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/admin/logout') { res.setHeader('set-cookie', adminCookie(req, '', 0)); return send(res, 200, { ok: true }); }
  if (!isAdmin(req)) return send(res, 401, { error: 'Sign in first.' });
  if (req.method === 'GET' && url.pathname === '/admin/api/jobs') return send(res, 200, { jobs: JOBS.list(), supplier: SUPPLIER, mail: !!MAILER, payments: !!JOBS.fee, stock: !!QUOTER });
  const m = /^\/admin\/api\/jobs\/([a-f0-9-]{36})\/(parts\.xml|fulfillment|retry|stock|site|revise|fix|undo|approve|intake|candidates|begin)$/.exec(url.pathname);
  if (!m) return send(res, 404, { error: 'Not found' });
  const [, id, what] = m;
  if (req.method === 'GET' && what === 'parts.xml') {
    const j = JOBS.get(id, { full: true }), d = j && j.result && j.result.design;
    if (!d) return send(res, 404, { error: 'No finished design.' });
    res.setHeader('content-disposition', `attachment; filename="${slug(d.name || 'design')}-parts.xml"`);
    return send(res, 200, partsXml(d), 'application/xml; charset=utf-8');
  }
  // how the house was found and mapped from above (site.js): each stage with its pictures and reasoning
  if (req.method === 'GET' && what === 'site') {
    const r = JOBS.siteReport(id);
    if (!r) return send(res, 404, { error: 'This design was not mapped from above.' });
    return send(res, 200, siteReportHtml(r.report, { costUsd: r.costUsd }), 'text/html; charset=utf-8');
  }
  if (req.method === 'POST' && what === 'fulfillment') {
    let body = {}; try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: e.message }); }
    const r = JOBS.setFulfillment(id, body); return send(res, r.code, r);
  }
  if (req.method === 'POST' && what === 'retry') { const r = JOBS.retry(id); return send(res, r.code, r); }
  // the check before a design goes to its owner: ask for a change about the selected pieces, undo it, approve
  if (req.method === 'POST' && what === 'revise') {
    let body = {}; try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: e.message }); }
    const j = JOBS.get(id, { full: true }), d = j && j.result && j.result.design;
    if (!d) return send(res, 404, { error: 'No finished design.' });
    const selection = selectionOf(d, body.parts);
    const r = JOBS.revise(id, { note: body.note, selection, parts: selection.reduce((n, s) => n + s.count, 0) }); return send(res, r.code, r);
  }
  if (req.method === 'POST' && what === 'fix') { const r = JOBS.fix(id); return send(res, r.code, r); }
  if (req.method === 'POST' && what === 'undo') { const r = JOBS.undo(id); return send(res, r.code, r); }
  // before the design: the request to look over, the buildings near the address to pick the house from, and starting it
  if (req.method === 'GET' && what === 'intake') { const r = JOBS.intakeOf(id); return r ? send(res, 200, r) : send(res, 404, { error: 'No such job' }); }
  if (req.method === 'POST' && what === 'candidates') {
    const r = JOBS.intakeOf(id);
    if (!r || !r.address) return send(res, 404, { error: 'This request has no address.' });
    const tools = await getRenderer();
    if (!tools) return send(res, 503, { error: 'The map needs the renderer (Playwright) on this server.' });
    try {
      const place = await require('./lookup').geocode(r.address);
      if (!place) return send(res, 404, { error: `The address wasn't found: ${r.address}` });
      const { findCandidates, candidateLine } = require('./site'), { frame } = require('./terrain'), { toLL } = frame(place);
      const f = await findCandidates({ address: r.address, place, tools });
      return send(res, 200, { image: `data:${f.mapImage.mediaType || 'image/jpeg'};base64,${f.mapImage.data}`, pin: { lat: place.lat, lon: place.lon },
        candidates: f.candidates.map((c) => ({ n: c.n, line: candidateLine(c).replace(/^\d+\.\s*/, ''), ...toLL(c.c) })) });
    } catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (req.method === 'POST' && what === 'begin') {
    let body = {}; try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: e.message }); }
    const r0 = JOBS.intakeOf(id); if (!r0) return send(res, 404, { error: 'No such job' });
    const views = Array.isArray(body.views) ? body.views.slice(0, r0.photos).map((v) => (VIEWS[v] ? v : null)) : null;
    const add = (Array.isArray(body.add) ? body.add : []).slice(0, MAX_TEAM_PHOTOS).filter(okPhoto).map((ph) => ({ mediaType: ph.mediaType, data: ph.data, view: VIEWS[ph.view] ? ph.view : null }));
    const drop = (Array.isArray(body.drop) ? body.drop : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < r0.photos);
    if (drop.length >= r0.photos && !add.length) return send(res, 400, { error: 'Keep at least one photo.' });
    const pk = body.pickAt && Number.isFinite(Number(body.pickAt.lat)) && Number.isFinite(Number(body.pickAt.lon)) ? { lat: Number(body.pickAt.lat), lon: Number(body.pickAt.lon) } : null;
    const r = JOBS.begin(id, { views, drop, add, pickAt: pk, instructions: String(body.instructions || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 2000) });
    return send(res, r.code, r);
  }
  if (req.method === 'POST' && what === 'approve') { const r = JOBS.approve(id); return send(res, r.code, r); }
  if (req.method === 'POST' && what === 'stock') {
    if (!QUOTER) return send(res, 503, { error: 'GoBricks quotes are off on this server (BRICKHOUSE_GOBRICKS_QUOTES=0).' });
    const stock = await stockCheck(id);
    return stock ? send(res, 200, { stock }) : send(res, 404, { error: 'No finished design.' });
  }
  send(res, 405, { error: 'Method not allowed' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') return send(res, 200, { ok: true });
  if (!authorized(req)) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="Brickhouse", charset="UTF-8"', 'content-type': 'text/plain' });
    return res.end('Password required.');
  }
  try {
    // the app moved from / to /app; payment links made before that still come back to /?job=…
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('job')) {
      res.writeHead(302, { location: '/app' + url.search }); return res.end();
    }
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      if (file.endsWith('.html')) return send(res, 200, withTopbar(fs.readFileSync(path.join(ROOT, file), 'utf8')), type);
      return send(res, 200, fs.readFileSync(path.join(ROOT, file)), type);
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, model: FAKE ? 'fake' : MODEL, effort: EFFORT, ready: FAKE || !!anthropicKey(), fee: JOBS.fee, maxPhotos: MAX_PHOTOS, streetPhotos: !!process.env.MAPILLARY_TOKEN, quote: !!QUOTER, cnyPerUsd: CNY_PER_USD, mail: !!MAILER });
    }
    if (req.method === 'GET' && url.pathname === '/api/designs') return send(res, 200, listDesigns(onThisMachine(req)));
    const m = /^\/designs\/((?:generated\/)?[a-z0-9._-]+)\.json$/i.exec(url.pathname);
    if (req.method === 'GET' && m) {
      if (m[1].startsWith('generated/') && !onThisMachine(req)) return send(res, 404, { error: 'No such design' });
      const file = path.join(ROOT, 'designs', m[1] + '.json');
      if (!fs.existsSync(file)) return send(res, 404, { error: 'No such design' });
      return send(res, 200, fs.readFileSync(file));
    }
    if (url.pathname === '/admin/login' || url.pathname === '/admin/logout' || url.pathname.startsWith('/admin/api/')) return handleAdmin(req, res, url);
    if (url.pathname.startsWith('/api/jobs')) return handleJobs(req, res, url);
    if (req.method === 'POST' && url.pathname === '/api/survey') {
      if (limited(req, 'survey', 30)) return send(res, 429, { error: 'Too many checks from here; try again in an hour.' });
      return handleSurvey(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/api/lookup') return handleLookup(req, res);
    if (req.method === 'POST' && url.pathname === '/api/address') return handleAddress(req, res);
    if (req.method === 'POST' && url.pathname === '/api/mine') return handleMine(req, res);
    if (req.method === 'GET' && url.pathname === '/api/mine') return handleMineList(res, url.searchParams.get('token'));
    if (req.method === 'POST' && url.pathname === '/api/quote') return handleQuote(req, res);
    const ph = /^\/api\/photo\/(\d{1,20})$/.exec(url.pathname);
    if (req.method === 'GET' && ph) return handlePhoto(res, ph[1]);
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    const resumed = JOBS.resumeInterrupted();
    if (resumed.length) console.log(`Picked up ${resumed.length} design${resumed.length === 1 ? '' : 's'} cut off by a restart: ${resumed.join(', ')}`);
    console.log(`Brickhouse on http://localhost:${PORT}  (model: ${FAKE ? 'fake' : MODEL}${EFFORT ? ', effort ' + EFFORT : ''})`);
    if (!FAKE && !anthropicKey()) console.log('No Anthropic API key: the viewer works, photo design is off. Add a key to .env or use BRICKHOUSE_FAKE=1.');
  });
}

module.exports = { server, cleanText, cleanAddress, parseDesignRequest, partsXml, viewsNote, mineToken, mineEmailOf, designPhotos };
