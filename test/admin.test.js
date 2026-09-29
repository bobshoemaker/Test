// The admin page's API: nothing without the password's cookie; signing in sets it; wrong passwords don't.
process.env.BRICKHOUSE_ADMIN_PASSWORD = 'correct horse battery';
const test = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../src/server/server');

test('the admin API needs the sign-in cookie, and the cookie is HttpOnly and SameSite=Strict', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/admin/api/jobs')).status, 401);
    assert.equal((await fetch(base + '/admin/api/jobs', { headers: { cookie: 'bh_admin=' + 'a'.repeat(64) } })).status, 401);
    const bad = await fetch(base + '/admin/login', { method: 'POST', body: JSON.stringify({ password: 'nope' }) });
    assert.equal(bad.status, 401);
    const ok = await fetch(base + '/admin/login', { method: 'POST', body: JSON.stringify({ password: 'correct horse battery' }) });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /^bh_admin=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000$/);
    const list = await fetch(base + '/admin/api/jobs', { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray((await list.json()).jobs));
    const stockPath = '/admin/api/jobs/00000000-0000-0000-0000-000000000000/stock';
    assert.equal((await fetch(base + stockPath, { method: 'POST' })).status, 401, 'the stock check needs the cookie too');
    assert.equal((await fetch(base + stockPath, { method: 'POST', headers: { cookie: cookie.split(';')[0] } })).status, 404, 'and a finished design');
    assert.equal((await fetch(base + '/admin')).status, 200, 'the page itself loads and asks to sign in');
    const out = await fetch(base + '/admin/logout', { method: 'POST' });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  } finally { server.close(); }
});
