#!/usr/bin/env node
// Compile a design and print what the engine found.
//   node scripts/compile.js designs/634-unit-a.json [--steps]
const fs = require('node:fs');
const { compile } = require('../src/engine/engine.js');

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/compile.js <design.json> [--steps]'); process.exit(2); }
const r = compile(JSON.parse(fs.readFileSync(file, 'utf8')));
const s = r.stats;
console.log(`${file}\n  ${s.pieces} pieces, ${s.steps} steps, ${s.pages} pages, ${s.subBuilds} sub-builds, ${s.lots} lots, ~$${s.cost.toFixed(2)} parts, ${s.joints} stud joints, ${s.ms.toFixed(0)} ms`);
for (const e of r.errors) console.log(`  error${e.op != null ? ` (op ${e.op})` : ''}: ${e.msg}`);
for (const w of r.warnings) console.log(`  warning${w.op != null ? ` (op ${w.op})` : ''}: ${w.msg}`);
if (process.argv.includes('--steps')) {
  r.steps.forEach((st, i) => console.log(`  ${String(i + 1).padStart(3)}  ${st.kind.padEnd(6)} ${st.title}${st.of > 1 ? ` ${st.n}/${st.of}` : ''}  (${st.parts.length} parts)`));
}
console.log(r.errors.length ? '  FAIL' : '  OK');
process.exit(r.errors.length ? 1 : 0);
