// Brickhouse server. Serves the viewer and designs, and runs photo-to-model jobs.
//   npm start                      real Claude (needs BRICKHOUSE_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY)
//   BRICKHOUSE_FAKE=1 npm start    scripted Claude, no key needed
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { designHouse, surveyHouse, checkPhotos } = require('./designer');
const { scaleFor } = require('./scale');
const { lookupAddress, fetchMapillaryImage } = require('./lookup');
const { lookupTerrain } = require('./terrain');
const { prepareDesign } = require('./pipeline');
const { createJobs } = require('./jobs');
const { makeStripe } = require('./payments');
const { anthropicKey, makeAnthropicClient } = require('./client');
const { makeQuoter, cleanLots } = require('./gobricks');

const ROOT = path.resolve(__dirname, '../..');
loadDotEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 5173);
const MODEL = process.env.BRICKHOUSE_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.BRICKHOUSE_EFFORT || null; // low | medium | high | xhigh | max
// The survey (first look and questions for the owner) is meant to be cheap: low effort by default,
// optionally a cheaper model.
const SURVEY_MODEL = process.env.BRICKHOUSE_SURVEY_MODEL || MODEL;
const SURVEY_EFFORT = process.env.BRICKHOUSE_SURVEY_EFFORT || 'low';
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

const STATIC = {
  '/': ['src/viewer/landing.html', 'text/html; charset=utf-8'],
  '/app': ['src/viewer/index.html', 'text/html; charset=utf-8'],
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
const cleanAddress = (a) => (typeof a === 'string' && a.trim() ? a.trim().slice(0, 200) : null);
const cleanPhotos = (list) => (list || []).slice(0, MAX_PHOTOS).filter((p) => p && /^image\/(jpeg|png|webp|gif)$/.test(p.mediaType) && typeof p.data === 'string');

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
    const prep = await prepareDesign({ address: cleanAddress(body.address), notes: String(body.notes || '').slice(0, 1500), plate: scaleFor(body.plate).plate, lockToOutline: false });
    const out = await surveyHouse({ client, model: SURVEY_MODEL, effort: SURVEY_EFFORT, photos, plan: cleanPhotos([body.plan])[0] || null, notes: prep.notes });
    send(res, 200, { summary: out.summary, seen: out.seen, questions: out.questions, model: FAKE ? 'fake' : SURVEY_MODEL });
  } catch (e) { send(res, 502, { error: e && e.message ? e.message : String(e) }); }
}

// A design request's parameters, cleaned: photos, notes, target, choices, credits, plan, address, plate.
function parseDesignRequest(body) {
  const sc = scaleFor(body.plate);
  return {
    photos: cleanPhotos(body.photos), plate: sc.plate,
    target: Math.max(300, Math.min(3000, Number(body.target) || sc.target)),
    notes: String(body.notes || '').slice(0, 1500),
    // The owner's answers to the survey, as {question, answer, detail}; the design follows them.
    choices: (Array.isArray(body.choices) ? body.choices : []).slice(0, 8)
      .map((c) => c && ({ question: String(c.question || '').slice(0, 200), answer: String(c.answer || '').slice(0, 300), detail: String(c.detail || '').slice(0, 300) }))
      .filter((c) => c && c.question && c.answer),
    // Credits for looked-up photos (source, author, license) travel with the saved design.
    credits: (Array.isArray(body.credits) ? body.credits : []).slice(0, MAX_PHOTOS)
      .map((c) => c && ({ credit: String(c.credit || '').slice(0, 200), license: String(c.license || '').slice(0, 60), page: String(c.page || '').slice(0, 300) }))
      .filter((c) => c && c.credit),
    plan: cleanPhotos([body.plan])[0] || null, address: cleanAddress(body.address),
    frontStreet: body.frontStreet ? String(body.frontStreet).slice(0, 100) : null,
  };
}

// Save a finished design and report it.
function finishDesign(out, p, emit, t0) {
  if (p.credits.length) out.design.photoCredits = p.credits;
  const name = `${slug(out.design.name)}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  fs.writeFileSync(path.join(ROOT, 'designs/generated', name + '.json'), JSON.stringify(out.design, null, 2));
  emit({ type: 'done', design: out.design, stats: out.result.stats, errors: out.result.errors.length + (out.planProblems || []).length, planProblems: out.planProblems || [],
    warnings: out.result.warnings.length, compiles: out.compiles, seconds: Math.round((Date.now() - t0) / 1000),
    saved: `generated/${name}`, note: out.note || null, model: FAKE ? 'fake' : MODEL });
}

// The same steps as scripts/design.js: address facts, walls locked to the plan or the building
// outline, then the house built in parts with renders of each draft (src/server/pipeline.js).
async function runDesign(p, emit) {
  const client = makeClient(), t0 = Date.now();
  if (!client) throw new Error(NO_KEY);
  if (p.address) emit({ type: 'status', message: 'Looking up the building, streets and slope…' });
  const prep = await prepareDesign({ address: p.address, notes: p.notes, plan: p.plan, plate: p.plate, frontStreet: p.frontStreet });
  prep.log.forEach((m) => emit({ type: 'status', message: m }));
  const renderer = await getRenderer();
  const out = await designHouse({ client, model: MODEL, effort: EFFORT, photos: p.photos, plan: p.plan, notes: prep.notes, target: p.target, choices: p.choices,
    plate: p.plate, mode: 'parts', locked: prep.locked, render: renderer && renderer.render, planTools: renderer, onEvent: emit });
  finishDesign(out, p, emit, t0);
}

// One more round on a finished design ("ask Claude to fix these").
async function runFix(p, emit) {
  const client = makeClient(), t0 = Date.now();
  if (!client) throw new Error(NO_KEY);
  const out = await designHouse({ client, model: MODEL, effort: EFFORT, photos: p.photos, notes: p.notes, target: p.target, plate: p.plate, mode: 'fix', design: p.design, onEvent: emit });
  finishDesign(out, p, emit, t0);
}

// Design jobs, paid for through Stripe Checkout when STRIPE_SECRET_KEY is set (see jobs.js).
const JOBS = createJobs({
  dir: path.join(ROOT, 'designs/generated/jobs'),
  stripe: makeStripe({ secretKey: process.env.STRIPE_SECRET_KEY, ...(process.env.BRICKHOUSE_STRIPE_API ? { apiBase: process.env.BRICKHOUSE_STRIPE_API } : {}) }), // the override is for local tests
  feeCents: Number(process.env.BRICKHOUSE_DESIGN_FEE_CENTS || 1500), currency: process.env.BRICKHOUSE_CURRENCY || 'usd',
  run: runDesign, fixRun: runFix,
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
  const m = /^\/api\/jobs(?:\/([a-f0-9-]{36})(?:\/(start|fix))?)?$/.exec(url.pathname);
  if (!m) return send(res, 404, { error: 'Not found' });
  const [, id, action] = m;
  try {
    if (req.method === 'POST' && !id) {
      if (!FAKE && !anthropicKey()) return send(res, 503, { error: NO_KEY });
      if (limited(req, 'job', 20)) return send(res, 429, { error: 'Too many designs started from here; try again in an hour.' });
      const p = parseDesignRequest(JSON.parse(await readBody(req)));
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
    if (req.method === 'POST' && action === 'fix') { const r = JOBS.fix(id); return send(res, r.code, r); }
    if (req.method === 'GET' && !action) {
      const r = JOBS.get(id, { after: Number(url.searchParams.get('after')) || 0, have: Number(url.searchParams.get('have')) || 0 });
      return r ? send(res, 200, r) : send(res, 404, { error: 'No such job' });
    }
    send(res, 405, { error: 'Method not allowed' });
  } catch (e) { send(res, 502, { error: e && e.message ? e.message : String(e) }); }
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
      return send(res, 200, fs.readFileSync(path.join(ROOT, file)), type);
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, model: FAKE ? 'fake' : MODEL, effort: EFFORT, ready: FAKE || !!anthropicKey(), fee: JOBS.fee, maxPhotos: MAX_PHOTOS, streetPhotos: !!process.env.MAPILLARY_TOKEN, quote: !!QUOTER, cnyPerUsd: CNY_PER_USD });
    }
    if (req.method === 'GET' && url.pathname === '/api/designs') return send(res, 200, listDesigns(onThisMachine(req)));
    const m = /^\/designs\/((?:generated\/)?[a-z0-9._-]+)\.json$/i.exec(url.pathname);
    if (req.method === 'GET' && m) {
      if (m[1].startsWith('generated/') && !onThisMachine(req)) return send(res, 404, { error: 'No such design' });
      const file = path.join(ROOT, 'designs', m[1] + '.json');
      if (!fs.existsSync(file)) return send(res, 404, { error: 'No such design' });
      return send(res, 200, fs.readFileSync(file));
    }
    if (url.pathname.startsWith('/api/jobs')) return handleJobs(req, res, url);
    if (req.method === 'POST' && url.pathname === '/api/survey') {
      if (limited(req, 'survey', 30)) return send(res, 429, { error: 'Too many checks from here; try again in an hour.' });
      return handleSurvey(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/api/lookup') return handleLookup(req, res);
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
    console.log(`Brickhouse on http://localhost:${PORT}  (model: ${FAKE ? 'fake' : MODEL}${EFFORT ? ', effort ' + EFFORT : ''})`);
    if (!FAKE && !anthropicKey()) console.log('No Anthropic API key: the viewer works, photo design is off. Add a key to .env or use BRICKHOUSE_FAKE=1.');
  });
}

module.exports = { server };
