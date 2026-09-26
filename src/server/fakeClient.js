// A scripted stand-in for the Anthropic client, so the UI and the tool loop can be tested
// without an API key. Round 1: compiles a draft with a deliberate collision.
// Round 2: returns the corrected design as JSON text. Enable with BRICKHOUSE_FAKE=1.
const { example } = require('./prompt');

function makeFakeClient({ delayMs = 600 } = {}) {
  let call = 0;
  const wait = () => new Promise((r) => setTimeout(r, delayMs));
  return {
    calls: [],
    messages: {
      create: async function (params) {
        this.calls = this.calls || [];
        call++;
        await wait();
        const good = JSON.parse(example());
        if (call === 1) {
          const draft = JSON.parse(JSON.stringify(good));
          const cactus = draft.ops.find((o) => o.op === 'sub' && o.name === 'Cactus');
          if (cactus) cactus.copies = [[20, 0, 26]]; // lands on the driveway: collision
          return {
            role: 'assistant', stop_reason: 'tool_use',
            content: [
              { type: 'thinking', thinking: 'Draft from photos.', signature: 'fake' },
              { type: 'tool_use', id: 'toolu_fake_1', name: 'compile_design', input: { design: draft } },
            ],
          };
        }
        return {
          role: 'assistant', stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(good) }],
        };
      },
    },
  };
}

module.exports = { makeFakeClient };
