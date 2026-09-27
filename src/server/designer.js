// Photos in, checked design out. Claude writes a design, calls compile_design (which runs
// the engine right here), reads the errors, fixes them, and returns the final JSON.
const { compile } = require('../engine/engine.js');
const { SPEC, designTask, fixTask, partsTask, PARTS } = require('./prompt');

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

// Streaming avoids HTTP timeouts on long thinking turns; test doubles only have create().
// While a turn runs, onEvent gets 'progress' every 20 s (elapsed time and what Claude is
// writing) and a 'thought' for each summarized thinking block as it finishes.
async function callClaude(client, params, onEvent = () => {}) {
  if (typeof client.messages.stream !== 'function') return client.messages.create(params);
  const t0 = Date.now(), secs = () => Math.round((Date.now() - t0) / 1000);
  let block = 'waiting', chars = 0, thought = '';
  const stream = client.messages.stream(params);
  stream.on('streamEvent', (ev) => {
    if (ev.type === 'content_block_start') {
      block = ev.content_block.type; thought = '';
      onEvent({ type: 'progress', secs: secs(), block, chars });
    } else if (ev.type === 'content_block_delta') {
      const d = ev.delta;
      if (d.type === 'thinking_delta') thought += d.thinking;
      chars += (d.thinking || d.text || d.partial_json || '').length;
    } else if (ev.type === 'content_block_stop' && block === 'thinking' && thought.trim()) {
      onEvent({ type: 'thought', secs: secs(), text: thought.trim() });
    }
  });
  const timer = setInterval(() => onEvent({ type: 'progress', secs: secs(), block, chars }), 20000);
  try { return await stream.finalMessage(); } finally { clearInterval(timer); }
}

/**
 * @param {object} o
 * @param {object} o.client     Anthropic client (or a test double with messages.create)
 * @param {string} o.model      e.g. 'claude-opus-5-5'
 * @param {Array<{mediaType:string,data:string}>} [o.photos] base64 images
 * @param {{mediaType:string,data:string}} [o.plan] base64 floor plan image, sent after the photos
 * @param {'design'|'parts'|'fix'} [o.mode]  'parts' builds walls, roofs, site and planting in separate turns
 * @param {object} [o.design]   required for mode 'fix'
 * @param {function} [o.onEvent] receives {type:'status'|'part'|'progress'|'thought'|'draft'|'partDone', ...}
 * @param {function} [o.render] async design -> [{label, data}] base64 PNGs; each compile result then
 *                   carries renders of the draft so Claude can compare it with the photos
 * @param {number} [o.partsLimit] parts mode: stop after this many parts (for trying out one part)
 */
async function designHouse({
  client, model, photos = [], plan = null, notes = '', target = 1200, mode = 'design', design = null,
  effort = null, maxRounds = 7, maxTokens = 64000, onEvent = () => {}, render = null, partsLimit = PARTS.length,
}) {
  const content = [...photos, ...(plan ? [plan] : [])].map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } }));
  if (mode === 'fix') {
    if (!isDesign(design)) throw new Error('Fix mode needs a design with phases and ops.');
    content.push({ type: 'text', text: fixTask({ design, problems: problemList(compile(design)) }) });
  } else {
    if (!photos.length && !notes) throw new Error('Add at least one photo or a description.');
    content.push({ type: 'text', text: (mode === 'parts' ? partsTask : designTask)({ photoCount: photos.length, notes, target, hasPlan: !!plan }) });
  }
  const messages = [{ role: 'user', content }];
  const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const st = { lastDraft: null, compiles: 0, rounds: 0 };
  // max_tokens includes thinking, which runs long at xhigh and max. Automatic caching moves the
  // breakpoint to the end of each request, so every round reads the photos and earlier drafts from cache.
  // Summarized thinking lets the progress events show what Claude is working on.
  const params = { model, max_tokens: maxTokens, system: SPEC, tools: [COMPILE_TOOL], cache_control: { type: 'ephemeral' },
    thinking: { type: 'adaptive', display: 'summarized' } };
  if (effort) params.output_config = { effort };

  // Runs turns until Claude answers without a tool call (returns that message) or the round limit (returns null).
  async function turns(limit, part) {
    for (let r = 0; r < limit; r++) {
      st.rounds++;
      onEvent({ type: 'status', message: st.rounds === 1
        ? (mode === 'fix' ? 'Claude is fixing the design…' : 'Claude is studying the photos…')
        : `Claude is ${r === 0 ? 'starting' : 'revising'} ${part ? part.toLowerCase() : 'the design'} (round ${st.rounds})…` });
      const msg = await callClaude(client, { ...params, messages }, onEvent);
      const u = msg.usage || {};
      usage.input += u.input_tokens || 0; usage.cacheRead += u.cache_read_input_tokens || 0;
      usage.cacheWrite += u.cache_creation_input_tokens || 0; usage.output += u.output_tokens || 0;
      // Keep the whole assistant turn, thinking blocks included; the API requires them in tool loops.
      messages.push({ role: 'assistant', content: msg.content });

      const uses = msg.content.filter((b) => b.type === 'tool_use');
      if (!uses.length) {
        if (msg.stop_reason === 'max_tokens' && !st.lastDraft) throw new Error(`Claude ran out of output tokens (${usage.output} used). Lower the piece target or effort, or raise maxTokens.`);
        return msg;
      }
      const results = [];
      for (const tu of uses) {
        if (tu.name !== COMPILE_TOOL.name) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Unknown tool ${tu.name}`, is_error: true });
          continue;
        }
        let d = tu.input && tu.input.design;
        if (typeof d === 'string') {
          try { d = JSON.parse(d); } catch (e) {
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: `design is not valid JSON: ${e.message}`, is_error: true });
            continue;
          }
        }
        if (!isDesign(d)) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'design needs phases and ops arrays', is_error: true });
          continue;
        }
        st.compiles++;
        const res = compile(d);
        d.source = 'photos';
        st.lastDraft = d;
        let renders = [];
        if (render) {
          try { renders = await render(d); } catch (e) { onEvent({ type: 'status', message: `Rendering failed: ${e.message}` }); }
        }
        onEvent({ type: 'draft', n: st.compiles, part, design: d, stats: res.stats, errors: res.errors.length, warnings: res.warnings.length, problems: problemList(res, 8), renders });
        const body = [{ type: 'text', text: JSON.stringify(summarize(res)) }];
        if (renders.length) {
          body.push({ type: 'text', text: `Renders of this draft (${renders.map((r) => r.label).join('; ')}). Compare them with the photos.` });
          for (const r of renders) body.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: r.data } });
        }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: renders.length ? body : body[0].text });
      }
      messages.push({ role: 'user', content: results });
    }
    return null;
  }

  function finish(msg, note) {
    const text = msg ? msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
    let final = extractJson(text);
    if (!isDesign(final)) final = st.lastDraft;
    if (!isDesign(final)) throw new Error('Claude did not return a design.');
    final.source = 'photos';
    return { design: final, result: compile(final), compiles: st.compiles, rounds: st.rounds, usage, ...(note ? { note } : {}) };
  }

  if (mode !== 'parts') {
    const msg = await turns(maxRounds);
    if (msg) return finish(msg);
    if (st.lastDraft) return finish(null, 'Stopped at the round limit; this is the last compiled draft.');
    throw new Error('Claude did not produce a design within the round limit.');
  }

  let msg = null;
  const count = Math.min(partsLimit, PARTS.length);
  for (let i = 0; i < count; i++) {
    const part = PARTS[i];
    // Each later part is a new user turn appended to the same conversation (append-only).
    if (i > 0) messages.push({ role: 'user', content: [{ type: 'text', text: part.task }] });
    onEvent({ type: 'part', n: i + 1, of: PARTS.length, name: part.name });
    msg = await turns(i === PARTS.length - 1 ? 5 : 4, part.name);
    const said = msg ? msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim() : '';
    onEvent({ type: 'partDone', n: i + 1, of: PARTS.length, name: part.name,
      summary: i === PARTS.length - 1 || said.startsWith('{') ? '' : said.slice(0, 300),
      stats: st.lastDraft ? compile(st.lastDraft).stats : null, usage: { ...usage } });
  }
  return finish(msg, msg ? null : 'Stopped at the round limit; this is the last compiled draft.');
}

module.exports = { designHouse, extractJson, summarize, problemList, COMPILE_TOOL };
