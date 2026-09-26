// Which API key and URL the design loop uses. No network: the SDK client is only constructed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { anthropicKey, makeAnthropicClient } = require('../src/server/client');

function withEnv(vars, fn) {
  const keys = ['BRICKHOUSE_ANTHROPIC_API_KEY', 'BRICKHOUSE_ANTHROPIC_BASE_URL', 'BRICKHOUSE_ANTHROPIC_WORKSPACE_ID', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); } finally { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

test('no key means no client', () => withEnv({}, () => {
  assert.equal(anthropicKey(), '');
  assert.equal(makeAnthropicClient(), null);
}));

test('the Brickhouse key wins and ignores an inherited ANTHROPIC_BASE_URL', () => withEnv({
  BRICKHOUSE_ANTHROPIC_API_KEY: 'sk-brick', ANTHROPIC_API_KEY: 'sk-other', ANTHROPIC_BASE_URL: 'http://proxy.invalid',
}, () => {
  const c = makeAnthropicClient();
  assert.equal(c.apiKey, 'sk-brick');
  assert.match(c.baseURL, /^https:\/\/api\.anthropic\.com/);
}));

test('plain ANTHROPIC_API_KEY still works', () => withEnv({ ANTHROPIC_API_KEY: 'sk-plain' }, () => {
  assert.equal(makeAnthropicClient().apiKey, 'sk-plain');
}));

test('a workspace id is sent as the anthropic-workspace-id header', () => {
  withEnv({ BRICKHOUSE_ANTHROPIC_API_KEY: 'sk-org', BRICKHOUSE_ANTHROPIC_WORKSPACE_ID: 'wrkspc_test' }, () => {
    assert.equal(makeAnthropicClient()._options.defaultHeaders['anthropic-workspace-id'], 'wrkspc_test');
  });
  withEnv({ BRICKHOUSE_ANTHROPIC_API_KEY: 'sk-ws' }, () => {
    assert.equal(makeAnthropicClient()._options.defaultHeaders, undefined);
  });
});
