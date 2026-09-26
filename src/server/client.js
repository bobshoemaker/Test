// Builds the Anthropic client for the design loop.
// BRICKHOUSE_ANTHROPIC_API_KEY wins over ANTHROPIC_API_KEY. Use it where the ANTHROPIC_*
// names already belong to another tool (Claude Code sets its own). With that key the API
// URL is BRICKHOUSE_ANTHROPIC_BASE_URL or api.anthropic.com, never an inherited ANTHROPIC_BASE_URL.
function anthropicKey() {
  return process.env.BRICKHOUSE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
}

function makeAnthropicClient() {
  const apiKey = anthropicKey();
  if (!apiKey) return null;
  const A = require('@anthropic-ai/sdk');
  const opts = { apiKey };
  if (process.env.BRICKHOUSE_ANTHROPIC_API_KEY) opts.baseURL = process.env.BRICKHOUSE_ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  return new (A.default || A)(opts);
}

module.exports = { anthropicKey, makeAnthropicClient };
