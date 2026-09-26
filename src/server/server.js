// Brickhouse server. Serves the viewer and designs, and runs photo-to-model jobs.
//   npm start                      real Claude (needs ANTHROPIC_API_KEY)
//   BRICKHOUSE_FAKE=1 npm start    scripted Claude, no key needed
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { designHouse } = require('./designer');

const ROOT = path.resolve(__dirname, '../..');
loadDotEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 5173);
const MODEL = process.env.BRICKHOUSE_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.BRICKHOUSE_EFFORT || null; // low | medium | high | xhigh | max
const FAKE = process.env.BRICKHOUSE_FAKE === '1';
const MAX_BODY = 40 * 1024 * 1024;
const MAX_PHOTOS = 6;

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

function makeClient() {
  if (FAKE) return require('./fakeClient').makeFakeClient();
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  const C = Anthropic.default || Anthropic;
  return new C({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const STATIC = {
  '/': ['src/viewer/index.html', 'text/html; charset=utf-8'],
  '/index.html': ['src/viewer/index.html', 'text/html; charset=utf-8'],
  '/viewer/app.js': ['src/viewer/app.js', 'text/javascript; charset=utf-8'],
  '/engine.js': ['src/engine/engine.js', 'text/javascript; charset=utf-8'],
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function listDesigns() {
  const out = [];
  for (const dir of ['designs', 'designs/generated']) {
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

async function handleDesign(req, res) {
  const client = makeClient();
  if (!client) return send(res, 503, { error: 'Set ANTHROPIC_API_KEY in .env, or run with BRICKHOUSE_FAKE=1 to try the flow.' });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: e.message }); }
  const photos = (body.photos || []).slice(0, MAX_PHOTOS).filter((p) => p && /^image\/(jpeg|png|webp|gif)$/.test(p.mediaType) && typeof p.data === 'string');
  const target = Math.max(300, Math.min(2500, Number(body.target) || 1200));
  const notes = String(body.notes || '').slice(0, 1500);

  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
  const emit = (ev) => res.write(JSON.stringify(ev) + '\n');
  const t0 = Date.now();
  try {
    const out = await designHouse({
      client, model: MODEL, effort: EFFORT, photos, notes, target,
      mode: body.mode === 'fix' ? 'fix' : 'design', design: body.design || null, onEvent: emit,
    });
    const name = `${slug(out.design.name)}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    fs.writeFileSync(path.join(ROOT, 'designs/generated', name + '.json'), JSON.stringify(out.design, null, 2));
    emit({ type: 'done', design: out.design, stats: out.result.stats, errors: out.result.errors.length,
      warnings: out.result.warnings.length, compiles: out.compiles, seconds: Math.round((Date.now() - t0) / 1000),
      saved: `generated/${name}`, note: out.note || null, model: FAKE ? 'fake' : MODEL });
  } catch (e) {
    emit({ type: 'error', message: e && e.message ? e.message : String(e), status: e && e.status });
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      return send(res, 200, fs.readFileSync(path.join(ROOT, file)), type);
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, model: FAKE ? 'fake' : MODEL, effort: EFFORT, ready: FAKE || !!process.env.ANTHROPIC_API_KEY, maxPhotos: MAX_PHOTOS });
    }
    if (req.method === 'GET' && url.pathname === '/api/designs') return send(res, 200, listDesigns());
    const m = /^\/designs\/((?:generated\/)?[a-z0-9._-]+)\.json$/i.exec(url.pathname);
    if (req.method === 'GET' && m) {
      const file = path.join(ROOT, 'designs', m[1] + '.json');
      if (!fs.existsSync(file)) return send(res, 404, { error: 'No such design' });
      return send(res, 200, fs.readFileSync(file));
    }
    if (req.method === 'POST' && url.pathname === '/api/design') return handleDesign(req, res);
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Brickhouse on http://localhost:${PORT}  (model: ${FAKE ? 'fake' : MODEL}${EFFORT ? ', effort ' + EFFORT : ''})`);
    if (!FAKE && !process.env.ANTHROPIC_API_KEY) console.log('No ANTHROPIC_API_KEY: the viewer works, photo design is off. Add a key to .env or use BRICKHOUSE_FAKE=1.');
  });
}

module.exports = { server };
