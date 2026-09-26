// Photos in, checked design out. Claude writes a design, calls compile_design (which runs
// the engine right here), reads the errors, fixes them, and returns the final JSON.
const { compile } = require('../engine/engine.js');
const { SPEC, designTask, fixTask } = require('./prompt');

const COMPILE_TOOL = {
  name: 'compile_design',
  description:
    'Compiles a draft house design with the brick engine. Returns the piece count, step count, and every error and warning, ' +
    'each tagged with the index of the op that caused it. Call it on every draft and fix everything it reports before answering. ' +
    'Pass the complete design object, not a diff.',
  input_schema: {
    type: 'object',
    properties: {
      design: {
        type: 'object',
        description: 'The complete design JSON object with name, place, scale, facts, assumed, phases and ops.',
      },
    },
    required: ['design'],
  },
};

function problemList(result, limit = 30) {
  const tag = (x) => (x.op != null ? ` (op ${x.op})` : '');
  return [
    ...result.errors.map((x) => `error${tag(x)}: ${x.msg}`),
    ...result.warnings.map((x) => `warning${tag(x)}: ${x.msg}`),
  ].slice(0, limit);
}

function summarize(result) {
  return {
    pieces: result.stats.pieces,
    steps: result.stats.steps,
    errors: result.errors.length,
    warnings: result.warnings.length,
    problems: problemList(result, 22),
  };
}

// Tolerant JSON extraction: whole reply, a fenced block, or first "{" to last "}".
function extractJson(text) {
  const tries = [text];
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) tries.push(fence[1]);
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) {
    try { const v = JSON.parse(t); if (v && typeof v === 'object') return v; } catch { /* try next */ }
  }
  return null;
}

function isDesign(d) {
  return d && typeof d === 'object' && Array.isArray(d.ops) && Array.isArray(d.phases);
}

async function callClaude(client, params) {
  // Streaming avoids HTTP timeouts on long thinking turns; fall back for test doubles.
  if (typeof client.messages.stream === 'function') return client.messages.stream(params).finalMessage();
  return client.messages.create(params);
}

/**
 * @param {object} o
 * @param {object} o.client     Anthropic client (or a test double with messages.create)
 * @param {string} o.model      e.g. 'claude-opus-5-5'
 * @param {Array<{mediaType:string,data:string}>} [o.photos] base64 images
 * @param {'design'|'fix'} [o.mode]
 * @param {object} [o.design]   required for mode 'fix'
 * @param {function} [o.onEvent] receives {type:'status'|'draft', ...}
 */
async function designHouse({
  client, model, photos = [], notes = '', target = 1200, mode = 'design', design = null,
  effort = null, maxRounds = 7, maxTokens = 64000, onEvent = () => {},
}) {
  const content = photos.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } }));
  if (mode === 'fix') {
    if (!isDesign(design)) throw new Error('Fix mode needs a design with phases and ops.');
    content.push({ type: 'text', text: fixTask({ design, problems: problemList(compile(design)) }) });
  } else {
    if (!photos.length && !notes) throw new Error('Add at least one photo or a description.');
    content.push({ type: 'text', text: designTask({ photoCount: photos.length, notes, target }) });
  }
  const messages = [{ role: 'user', content }];
  let lastDraft = null, compiles = 0;
  const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

  for (let round = 0; round < maxRounds; round++) {
    onEvent({ type: 'status', message: round === 0
      ? (mode === 'fix' ? 'Claude is fixing the design…' : 'Claude is studying the photos…')
      : `Claude is revising the design (round ${round + 1})…` });
    // max_tokens includes thinking, which runs long at xhigh and max. Automatic caching moves the
    // breakpoint to the end of each request, so every round reads the photos and earlier drafts from cache.
    const params = { model, max_tokens: maxTokens, system: SPEC, tools: [COMPILE_TOOL], messages, cache_control: { type: 'ephemeral' } };
    if (effort) params.output_config = { effort };
    const msg = await callClaude(client, params);
    const u = msg.usage || {};
    usage.input += u.input_tokens || 0; usage.cacheRead += u.cache_read_input_tokens || 0;
    usage.cacheWrite += u.cache_creation_input_tokens || 0; usage.output += u.output_tokens || 0;
    // Keep the whole assistant turn, thinking blocks included; the API requires them in tool loops.
    messages.push({ role: 'assistant', content: msg.content });

    const uses = msg.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) {
      if (msg.stop_reason === 'max_tokens' && !lastDraft) throw new Error('Claude ran out of output tokens. Lower the piece target or raise maxTokens.');
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      let final = extractJson(text);
      if (!isDesign(final)) final = lastDraft;
      if (!isDesign(final)) throw new Error('Claude did not return a design.');
      final.source = 'photos';
      return { design: final, result: compile(final), compiles, rounds: round + 1, usage };
    }

    const results = [];
    for (const u of uses) {
      if (u.name !== COMPILE_TOOL.name) {
        results.push({ type: 'tool_result', tool_use_id: u.id, content: `Unknown tool ${u.name}`, is_error: true });
        continue;
      }
      let d = u.input && u.input.design;
      if (typeof d === 'string') {
        try { d = JSON.parse(d); } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: `design is not valid JSON: ${e.message}`, is_error: true });
          continue;
        }
      }
      if (!isDesign(d)) {
        results.push({ type: 'tool_result', tool_use_id: u.id, content: 'design needs phases and ops arrays', is_error: true });
        continue;
      }
      compiles++;
      const r = compile(d);
      d.source = 'photos';
      lastDraft = d;
      onEvent({ type: 'draft', n: compiles, design: d, stats: r.stats, errors: r.errors.length, warnings: r.warnings.length });
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(summarize(r)) });
    }
    messages.push({ role: 'user', content: results });
  }

  if (lastDraft) {
    return { design: lastDraft, result: compile(lastDraft), compiles, rounds: maxRounds, usage,
      note: 'Stopped at the round limit; this is the last compiled draft.' };
  }
  throw new Error('Claude did not produce a design within the round limit.');
}

module.exports = { designHouse, extractJson, summarize, problemList, COMPILE_TOOL };
