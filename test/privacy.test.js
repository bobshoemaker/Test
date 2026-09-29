// Customers' houses (designs/generated) stay private: only the samples are listed or served to anyone
// reaching the server through a proxy (a public host); the server's own machine still sees them all.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { server } = require('../src/server/server');

test('customer designs are not listed or served to outside requests', async () => {
  const dir = path.join(__dirname, '..', 'designs/generated'), name = 'privacy-test-house';
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name + '.json'), '{"name":"12 Private Lane"}');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`, outside = { headers: { 'x-forwarded-for': '203.0.113.9' } };
  try {
    const listed = await (await fetch(base + '/api/designs', outside)).json();
    assert.ok(listed.includes('634-unit-a'));
    assert.ok(!listed.some((n) => n.startsWith('generated/')));
    assert.equal((await fetch(`${base}/designs/generated/${name}.json`, outside)).status, 404);
    assert.equal((await fetch(`${base}/designs/634-unit-a.json`, outside)).status, 200);
    // on this machine (local development) they're all there
    assert.ok((await (await fetch(base + '/api/designs')).json()).includes('generated/' + name));
    assert.equal((await fetch(`${base}/designs/generated/${name}.json`)).status, 200);
  } finally { server.close(); fs.unlinkSync(path.join(dir, name + '.json')); }
});
