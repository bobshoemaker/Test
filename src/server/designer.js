// Photos in, checked design out. Claude writes a design, calls compile_design (which runs
// the engine right here), reads the errors, fixes them, and returns the final JSON.
// With a floor plan, parts mode first has Claude read the footprint off the plan; code lays it
// out in studs (footprint.js) and every compile checks the design's walls against it.
const { compile } = require('../engine/engine.js');
const { SPEC, designTask, fixTask, partsTask, PARTS, FOOTPRINT_SPEC, FOOTPRINT_TOOL, footprintTask,
  SURVEY_SPEC, SURVEY_TOOL, surveyTask, PHOTO_CHECK_SPEC, PHOTO_CHECK_TOOL, photoCheckTask, LANDSCAPE_STYLES } = require('./prompt');
const { layoutFootprint, skeletonOps, checkFootprint, describeLayout } = require('./footprint');
const { scaleFor } = require('./scale');

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

// planProblems: walls that left the locked floor-plan footprint; they count as errors.
function summarize(result, planProblems = []) {
  return {
    pieces: result.stats.pieces,
    steps: result.stats.steps,
    errors: result.errors.length + planProblems.length,
    warnings: result.warnings.length,
    problems: [...planProblems.map((p) => `error: ${p}`), ...problemList(result, 22)].slice(0, 22),
    // suggestions, not problems: they never block a design
    ...((result.hints || []).length ? { hints: result.hints.slice(0, 3).map((h) => h.msg) } : {}),
  };
}

const IMAGE_LIMIT = 90;
function countImages(messages) {
  let n = 0;
  const walk = (c) => { if (!Array.isArray(c)) return; for (const b of c) { if (b.type === 'image') n++; else if (b.type === 'tool_result') walk(b.content); } };
  for (const m of messages) walk(m.content);
  return n;
}

function addUsage(usage, msg) {
  const u = msg.usage || {};
  usage.input += u.input_tokens || 0; usage.cacheRead += u.cache_read_input_tokens || 0;
  usage.cacheWrite += u.cache_creation_input_tokens || 0; usage.output += u.output_tokens || 0;
}

const imageBlock = (p) => ({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } });

// A first look before any design work, meant for a low effort (or a cheaper model): what the
// photos show, and up to five questions about what they leave open, each with buildable options
// and a recommended one. A landscaping-style question is always added. Returns
// {summary, seen, questions:[{id, topic, question, why, options:[{id,label,detail}], recommended}], usage}.
async function surveyHouse({ client, model, photos = [], plan = null, notes = '', effort = 'low', maxTokens = 32000, onEvent = () => {} }) {
  if (!photos.length) throw new Error('The survey needs at least one photo.');
  const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const messages = [{ role: 'user', content: [...photos.map(imageBlock), ...(plan ? [imageBlock(plan)] : []),
    { type: 'text', text: surveyTask({ photoCount: photos.length, notes, hasPlan: !!plan }) }] }];
  const params = { model, max_tokens: maxTokens, system: SURVEY_SPEC, tools: [SURVEY_TOOL], cache_control: { type: 'ephemeral' },
    thinking: { type: 'adaptive', display: 'summarized' }, messages };
  if (effort) params.output_config = { effort };
  onEvent({ type: 'status', message: 'Claude is taking a first look at the photos…' });
  const msg = await callClaude(client, params, onEvent);
  addUsage(usage, msg);
  const use = msg.content.find((b) => b.type === 'tool_use' && b.name === SURVEY_TOOL.name);
  if (!use) throw new Error('Claude did not return a survey.');
  const input = use.input || {};
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const questions = (Array.isArray(input.questions) ? input.questions : []).slice(0, 5).map((q, i) => {
    const options = (Array.isArray(q.options) ? q.options : []).slice(0, 4)
      .map((o, j) => ({ id: str(o.id || `o${j + 1}`, 40), label: str(o.label, 80), detail: str(o.detail, 240) })).filter((o) => o.label);
    return { id: str(q.id || `q${i + 1}`, 40), topic: str(q.topic || 'other', 20), question: str(q.question, 200), why: str(q.why, 400), options,
      recommended: options.some((o) => o.id === q.recommended) ? q.recommended : (options[0] || {}).id };
  }).filter((q) => q.question && q.options.length >= 2);
  const seenPlanting = str(input.landscapeSeen, 200);
  questions.push({
    id: 'landscape', topic: 'landscape', question: 'Which landscaping style should the model use?',
    why: seenPlanting ? `The photos show ${seenPlanting.replace(/\.$/, '')}.` : '',
    options: LANDSCAPE_STYLES.map((o) => (o.id === 'photos' ? { ...o, detail: seenPlanting ? `As in the photos: ${seenPlanting}` : 'As in the photos.' } : { ...o })),
    recommended: 'photos',
  });
  return { summary: str(input.summary, 600), seen: (Array.isArray(input.seen) ? input.seen : []).slice(0, 20).map((x) => str(x, 200)), questions, usage };
}

// The screen every design request passes: the photos must show one home (not another building, not
// something else, not two different houses). The rules are here, in code; Claude only says what each
// photo shows. Returns {ok, problems: [{photo, shows, note}], message} with a message for the owner.
const REFUSED = { different_home: 'looks like a different house from the others', not_home: "doesn't look like a home",
  not_building: "doesn't show a building" };
function photoVerdict(input, photoCount, hasPlan) {
  const seen = new Map();
  for (const p of Array.isArray(input && input.photos) ? input.photos : []) {
    const n = Math.round(Number(p && p.photo));
    if (n >= 1 && n <= photoCount && !seen.has(n)) seen.set(n, { photo: n, shows: String(p.shows), note: String(p.note || '').slice(0, 200) });
  }
  const all = Array.from({ length: photoCount }, (_, i) => seen.get(i + 1) || { photo: i + 1, shows: 'unclear', note: '' });
  const problems = all.filter((p) => REFUSED[p.shows]);
  const lines = problems.map((p) => `Photo ${p.photo} ${REFUSED[p.shows]}${p.note ? ` (${p.note.replace(/\.$/, '')})` : ''}.`);
  if (!problems.length && photoCount && !all.some((p) => p.shows === 'home'))
    lines.push("We couldn't see the outside of the house clearly. Please add a clear photo of the front.");
  if (hasPlan && input && input.planIsFloorPlan === false) lines.push("The floor plan doesn't look like a floor plan of a home.");
  if (!lines.length) return { ok: true, problems: [], message: '' };
  const fix = problems.some((p) => p.shows === 'different_home') ? ' Please use photos of just one house.' : problems.length ? ' Please remove it and try again.' : '';
  return { ok: false, problems, message: lines.join(' ') + fix };
}

async function checkPhotos({ client, model, photos = [], plan = null, effort = 'low', maxTokens = 16000, onEvent = () => {} }) {
  if (!photos.length && !plan) return { ok: true, problems: [], message: '' };
  const params = { model, max_tokens: maxTokens, system: PHOTO_CHECK_SPEC, tools: [PHOTO_CHECK_TOOL],
    messages: [{ role: 'user', content: [...photos.map(imageBlock), ...(plan ? [imageBlock(plan)] : []),
      { type: 'text', text: photoCheckTask({ photoCount: photos.length, hasPlan: !!plan }) }] }] };
  if (effort) params.output_config = { effort };
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await callClaude(client, params, onEvent);
    if (msg.stop_reason === 'refusal') return { ok: false, problems: [], message: "These photos can't be used for a model. Please send photos of the outside of your home." };
    const use = (msg.content || []).find((b) => b.type === 'tool_use' && b.name === PHOTO_CHECK_TOOL.name);
    if (use) return photoVerdict(use.input, photos.length, !!plan);
  }
  throw new Error("We couldn't check the photos just now. Please try again in a moment.");
}

// Survey answers ({questionId: optionId, or free text}) to the choices the design follows.
// Unanswered questions take the recommended option.
function resolveChoices(questions, answers = {}) {
  return (questions || []).map((q) => {
    const a = answers[q.id];
    const opt = q.options.find((o) => o.id === a) || (a == null || a === '' ? q.options.find((o) => o.id === q.recommended) : null);
    return opt ? { id: q.id, question: q.question, answer: opt.label, detail: opt.detail || '' } : { id: q.id, question: q.question, answer: String(a).slice(0, 300), detail: '' };
  });
}

// Claude reads the footprint off the plan (and a gridded copy); each submission is laid out in
// studs and comes back with an overlay on the plan until Claude is satisfied. Returns the layout.
async function planFootprint({ client, model, photos = [], plan, notes = '', effort = null, maxTokens = 64000,
  planTools = null, onEvent = () => {}, usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, maxRounds = 5, plate = 32 }) {
  const sc = scaleFor(plate);
  let grid = null;
  if (planTools && planTools.gridPlan) {
    try { grid = await planTools.gridPlan(plan); } catch (e) { onEvent({ type: 'status', message: `Plan grid failed: ${e.message}` }); }
  }
  const messages = [{ role: 'user', content: [...photos.map(imageBlock), imageBlock(plan), ...(grid ? [imageBlock(grid)] : []),
    { type: 'text', text: footprintTask({ photoCount: photos.length, notes, gridded: !!grid }) }] }];
  const params = { model, max_tokens: maxTokens, system: FOOTPRINT_SPEC, tools: [FOOTPRINT_TOOL], cache_control: { type: 'ephemeral' },
    thinking: { type: 'adaptive', display: 'summarized' } };
  if (effort) params.output_config = { effort };
  let best = null, n = 0;
  for (let r = 0; r < maxRounds; r++) {
    onEvent({ type: 'status', message: r === 0 ? 'Claude is reading the floor plan…' : `Claude is checking the footprint (round ${r + 1})…` });
    const msg = await callClaude(client, { ...params, messages }, onEvent);
    addUsage(usage, msg);
    messages.push({ role: 'assistant', content: msg.content });
    const uses = msg.content.filter((b) => b.type === 'tool_use');
    if (!uses.length) break;
    const results = [];
    for (const tu of uses) {
      if (tu.name !== FOOTPRINT_TOOL.name) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Unknown tool ${tu.name}`, is_error: true });
        continue;
      }
      n++;
      let locked;
      try { locked = layoutFootprint(tu.input || {}, { size: sc.size, ftPerStud: sc.ftPerStud, frontYard: sc.frontYard }); } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Could not lay out the footprint: ${e.message}`, is_error: true });
        continue;
      }
      locked.input = tu.input;
      // Coordinates beyond the plan's size were read off the enlarged grid copy, not its labels.
      if (grid && grid.width) {
        const xs = [], ys = [];
        for (const r of [...(tu.input.rooms || []).map((q) => q.rectPx), ...(tu.input.blocks || []).flatMap((b) => b.rectsPx || [])]) if (Array.isArray(r)) { xs.push(r[0], r[2]); ys.push(r[1], r[3]); }
        if (Math.max(...xs) > grid.width * 1.05 || Math.max(...ys) > grid.height * 1.05) {
          locked.problems.push(`Some coordinates are beyond the plan's ${grid.width} x ${grid.height} pixels: read positions from the grid labels, which are in original plan pixels (the gridded copy is drawn twice as large).`);
        }
      }
      let overlay = null;
      if (planTools && planTools.footprintOverlay && locked.map) {
        try { overlay = await planTools.footprintOverlay(plan, locked, { size: sc.size, px: sc.size > 32 ? 14 : 20 }); } catch (e) { onEvent({ type: 'status', message: `Overlay failed: ${e.message}` }); }
      }
      if (locked.blocks.length) best = locked;
      onEvent({ type: 'footprint', n, locked, problems: locked.problems, overlay });
      const body = [{ type: 'text', text: describeLayout(locked) }];
      if (overlay) {
        body.push({ type: 'text', text: 'Overlay of these walls on the plan, as they will sit on the baseplate: walls colored by block, red squares are doors, black squares garage doors, orange outlines stairs, street along the bottom.' });
        body.push(imageBlock({ mediaType: 'image/png', data: overlay }));
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: body });
    }
    messages.push({ role: 'user', content: results });
  }
  if (!best) throw new Error('Claude did not submit a footprint from the floor plan.');
  const fatal = best.problems.filter((p) => /too deep|too wide/.test(p));
  if (fatal.length) throw new Error(`The floor plan doesn't fit the baseplate: ${fatal.join(' ')}`);
  onEvent({ type: 'footprintDone', locked: best, usage: { ...usage } });
  return best;
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
 * @param {boolean} [o.lockFootprint] parts mode with a plan: read the footprint first and lock the walls to it (default true)
 * @param {object} [o.locked]   a footprint already laid out (from an earlier run's 'footprintDone'); skips reading the plan
 * @param {object} [o.planTools] {gridPlan, footprintOverlay} from render.js, for the plan-reading step
 * @param {object} [o.seed]     parts mode: a design from earlier parts to continue from (with fromPart)
 * @param {number} [o.fromPart] parts mode: the part to start at, 1-based (needs seed when above 1)
 * @param {Array<{question,answer,detail}>} [o.choices] the owner's answers to the survey (resolveChoices), binding for the design
 * @param {32|48} [o.plate]     baseplate size; 48 is the larger model at 1.5 ft per stud (scale.js)
 */
async function designHouse({
  client, model, photos = [], plan = null, notes = '', target = 1200, mode = 'design', design = null,
  effort = null, maxRounds = 7, maxTokens = 64000, onEvent = () => {}, render = null, partsLimit = PARTS.length,
  lockFootprint = true, locked = null, planTools = null, seed = null, fromPart = 1, choices = null, plate = 32, supplier = null,
}) {
  plate = scaleFor(plate).plate;
  if (mode === 'parts' && fromPart > 1 && !isDesign(seed)) throw new Error('Starting at a later part needs the design from the earlier parts (seed).');
  const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  if (mode === 'parts' && plan && lockFootprint && !locked) {
    locked = await planFootprint({ client, model, photos, plan, notes, effort, maxTokens, planTools, onEvent, usage, plate });
  }
  if (mode !== 'parts') locked = null;
  const lockedOps = locked ? skeletonOps(locked) : null;
  const content = [...photos, ...(plan ? [plan] : [])].map(imageBlock);
  if (mode === 'fix') {
    if (!isDesign(design)) throw new Error('Fix mode needs a design with phases and ops.');
    content.push({ type: 'text', text: fixTask({ design, problems: problemList(compile(design)) }) });
  } else {
    if (!photos.length && !notes) throw new Error('Add at least one photo or a description.');
    content.push({ type: 'text', text: (mode === 'parts' ? partsTask : designTask)({ photoCount: photos.length, notes, target, hasPlan: !!plan, locked, lockedOps, seed: fromPart > 1 ? seed : null, fromPart, choices, plate })
      + (supplier ? `\n\nSUPPLIER. The kit is made from ${supplier === 'gobricks' ? 'GoBricks' : supplier} bricks: every draft is compiled with "supplier": "${supplier}" (see Compatible bricks), so use only parts and colors the compiler says it makes.` : '') });
  }
  const messages = [{ role: 'user', content }];
  const st = { lastDraft: mode === 'parts' && fromPart > 1 ? seed : null, compiles: 0, rounds: 0 };
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
      addUsage(usage, msg);
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
        if (isDesign(d) && supplier) d.supplier = supplier; // held to what the kit's supplier makes, whatever the draft says
        if (!isDesign(d)) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'design needs phases and ops arrays', is_error: true });
          continue;
        }
        st.compiles++;
        if (plate !== 32 && d.plate == null) d.plate = plate; // the larger plate is the task's choice, not a guess
        if (d.variation == null) d.variation = 'subtle'; // a few pieces of each material in a close color
        const res = compile(d), planProblems = checkFootprint(d, locked);
        d.source = 'photos';
        st.lastDraft = d;
        let renders = [];
        if (render) {
          try { renders = await render(d); } catch (e) { onEvent({ type: 'status', message: `Rendering failed: ${e.message}` }); }
        }
        // The API takes a limited number of images per request; drop the back views, then all views, near it.
        const room = IMAGE_LIMIT - countImages(messages) - countImages([{ content: results }]);
        if (renders.length > room) renders = renders.slice(0, Math.max(0, room));
        const sum = summarize(res, planProblems);
        onEvent({ type: 'draft', n: st.compiles, part, design: d, stats: res.stats, errors: sum.errors, warnings: sum.warnings, problems: sum.problems.slice(0, 8), renders });
        const body = [{ type: 'text', text: JSON.stringify(sum) }];
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
    if (supplier) final.supplier = supplier;
    return { design: final, result: compile(final), planProblems: checkFootprint(final, locked), locked, compiles: st.compiles, rounds: st.rounds, usage, ...(note ? { note } : {}) };
  }

  if (mode !== 'parts') {
    const msg = await turns(maxRounds);
    if (msg) return finish(msg);
    if (st.lastDraft) return finish(null, 'Stopped at the round limit; this is the last compiled draft.');
    throw new Error('Claude did not produce a design within the round limit.');
  }

  let msg = null;
  const count = Math.min(partsLimit, PARTS.length);
  for (let i = Math.max(0, fromPart - 1); i < count; i++) {
    const part = PARTS[i];
    // Each later part is a new user turn appended to the same conversation (append-only).
    if (i > fromPart - 1) messages.push({ role: 'user', content: [{ type: 'text', text: part.task }] });
    onEvent({ type: 'part', n: i + 1, of: PARTS.length, name: part.name });
    msg = await turns(i === PARTS.length - 1 ? 5 : 4, part.name);
    const said = msg ? msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim() : '';
    onEvent({ type: 'partDone', n: i + 1, of: PARTS.length, name: part.name,
      summary: i === PARTS.length - 1 || said.startsWith('{') ? '' : said.slice(0, 300),
      stats: st.lastDraft ? compile(st.lastDraft).stats : null, usage: { ...usage } });
  }
  // Repair: when the last part ends with problems left, a few more rounds on just those, so a design
  // converges to 0 errors and 0 warnings instead of stopping short.
  // the design finish() would return: one in the reply's text, or else the last compiled draft
  const current = () => { const d = msg ? extractJson(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')) : null; const c = isDesign(d) ? d : st.lastDraft; if (c && supplier) c.supplier = supplier; return c; };
  if (count === PARTS.length && current()) {
    for (let k = 0; k < REPAIR_TURNS; k++) {
      const d = current(), res = compile(d), plan = checkFootprint(d, locked);
      if (!res.errors.length && !res.warnings.length && !plan.length) break;
      const sum = summarize(res, plan);
      const text = `REPAIR ${k + 1} OF ${REPAIR_TURNS}. The design still has ${sum.errors} error${sum.errors === 1 ? '' : 's'} and ${sum.warnings} warning${sum.warnings === 1 ? '' : 's'}:\n${sum.problems.join('\n')}\nFix only these and change nothing else, then compile. When it compiles with 0 errors and 0 warnings, reply with one sentence.`;
      const last = messages[messages.length - 1];
      if (last.role === 'user') last.content.push({ type: 'text', text }); else messages.push({ role: 'user', content: [{ type: 'text', text }] });
      onEvent({ type: 'part', n: PARTS.length, of: PARTS.length, name: `Repair ${k + 1}` });
      msg = await turns(3, 'the repair');
    }
  }
  return finish(msg, msg ? null : 'Stopped at the round limit; this is the last compiled draft.');
}

const REPAIR_TURNS = 3;

module.exports = { designHouse, surveyHouse, checkPhotos, photoVerdict, resolveChoices, planFootprint, extractJson, summarize, problemList, COMPILE_TOOL };
