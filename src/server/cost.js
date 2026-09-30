// What a design costs in Claude API usage, from the token counts the loop keeps ({input, cacheRead,
// cacheWrite, output}). Prices are dollars per million tokens (Anthropic first-party rates, checked
// 2026-09-30; cache writes at the 5-minute rate, 1.25 times input). A model not listed is priced as the
// default design model.
const PRICES = {
  'claude-opus-5-5': { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'claude-fable-5-1': { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 },
  'claude-sonnet-5-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  'claude-haiku-4-5': { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
};
const priceOf = (model) => PRICES[model] || PRICES['claude-opus-5-5'];
function costOf(usage, model) {
  const p = priceOf(model), u = usage || {};
  return ((u.input || 0) * p.input + (u.cacheWrite || 0) * p.cacheWrite + (u.cacheRead || 0) * p.cacheRead + (u.output || 0) * p.output) / 1e6;
}
const emptyUsage = () => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
module.exports = { PRICES, costOf, emptyUsage };
