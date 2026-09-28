#!/usr/bin/env node
// Builds src/viewer/ldraw-parts.js: real part geometry from the LDraw parts library
// (library.ldraw.org, CC BY 4.0) for the parts the viewer draws in detail.
//   node scripts/ldraw.js [part numbers...] [--lowres]   (default: the list below; --lowres: 8-sided round primitives)
// Each part's .dat file and everything it references (subparts, primitives) is fetched once
// into .ldraw-cache/, flattened into triangles, and stored quantized, with its authors for credit.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, '.ldraw-cache');
const BASE = 'https://library.ldraw.org/library/official/';
const OUT = path.join(ROOT, 'src/viewer/ldraw-parts.js');
// part number -> the engine part it draws
const PARTS = { 2417: 'leaves65', 2423: 'leaves43', 32607: 'sprig1', 33291: 'flower1', 2566: 'palmtop', 30239: 'swordleaf', 6064: 'bush224' };
const Q = 16; // quantization: 1/16 LDU

// Round primitives also come in 8-segment versions (p/8/); --lowres uses those, a fraction of the triangles.
const LOWRES = process.argv.includes('--lowres');
async function fetchDat(name) {
  if (LOWRES && !/[\\/]/.test(name)) { try { return await fetchRaw('8/' + name, ['p/']); } catch { /* no low-res version */ } }
  return fetchRaw(name, ['parts/', 'p/']);
}
async function fetchRaw(name, dirs) {
  const n = name.toLowerCase().replace(/\\/g, '/');
  const file = path.join(CACHE, n.replace(/\//g, '__'));
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  for (const dir of dirs) {
    const res = await fetch(BASE + dir + n);
    if (res.ok) { const t = await res.text(); fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file, t); return t; }
  }
  throw new Error(`LDraw file not found: ${name}`);
}

// 3x4 affine transforms as [a,b,c,x, d,e,f,y, g,h,i,z]
const mul = (A, B) => [
  A[0] * B[0] + A[1] * B[4] + A[2] * B[8], A[0] * B[1] + A[1] * B[5] + A[2] * B[9], A[0] * B[2] + A[1] * B[6] + A[2] * B[10], A[0] * B[3] + A[1] * B[7] + A[2] * B[11] + A[3],
  A[4] * B[0] + A[5] * B[4] + A[6] * B[8], A[4] * B[1] + A[5] * B[5] + A[6] * B[9], A[4] * B[2] + A[5] * B[6] + A[6] * B[10], A[4] * B[3] + A[5] * B[7] + A[6] * B[11] + A[7],
  A[8] * B[0] + A[9] * B[4] + A[10] * B[8], A[8] * B[1] + A[9] * B[5] + A[10] * B[9], A[8] * B[2] + A[9] * B[6] + A[10] * B[10], A[8] * B[3] + A[9] * B[7] + A[10] * B[11] + A[11]];
const apply = (M, x, y, z) => [M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]];
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

// Triangles of a file under transform M; studs (top-level stud primitives) are noted with their position.
async function flatten(name, M, out, depth = 0) {
  const text = await fetchDat(name);
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim().split(/\s+/);
    if (t[0] === '1') {
      const [x, y, z, a, b, c, d, e, f, g, h, i] = t.slice(2, 14).map(Number), sub = t.slice(14).join(' ');
      const S = mul(M, [a, b, c, x, d, e, f, y, g, h, i, z]);
      if (/^stud\d*a?\.dat$/i.test(sub)) out.studs.push(apply(S, 0, 0, 0));
      await flatten(sub, S, out, depth + 1);
    } else if (t[0] === '3' || t[0] === '4') {
      const v = t.slice(2).map(Number), pts = [];
      for (let k = 0; k < (t[0] === '3' ? 3 : 4); k++) pts.push(apply(M, v[k * 3], v[k * 3 + 1], v[k * 3 + 2]));
      out.tris.push(pts[0], pts[1], pts[2]); if (pts.length === 4) out.tris.push(pts[0], pts[2], pts[3]);
    } else if (t[0] === '0' && depth === 0) {
      const m = raw.match(/^0\s+Author:\s*(.+)$/i); if (m) out.authors.add(m[1].trim());
      const n = raw.match(/^0\s+(?!Name:|Author:|!|BFC|\/\/)(.+)$/); if (n && !out.title) out.title = n[1].replace(/\s+/g, ' ').trim();
    } else if (t[0] === '0') { const m = raw.match(/^0\s+Author:\s*(.+)$/i); if (m) out.authors.add(m[1].trim()); }
  }
}

(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const want = args.length ? Object.fromEntries(args.map((n) => [n, PARTS[n] || null])) : PARTS;
  const lib = {};
  for (const [no, engineKey] of Object.entries(want)) {
    const out = { tris: [], studs: [], authors: new Set(), title: '' };
    await flatten(`${no}.dat`, I, out);
    const q = new Int16Array(out.tris.length * 3);
    out.tris.forEach((p, k) => { for (let c = 0; c < 3; c++) q[k * 3 + c] = Math.round(p[c] * Q); });
    const xs = out.tris.map((p) => p[0]), ys = out.tris.map((p) => p[1]), zs = out.tris.map((p) => p[2]);
    lib[no] = { part: engineKey, title: out.title, authors: [...out.authors], bbox: [Math.min(...xs), Math.min(...ys), Math.min(...zs), Math.max(...xs), Math.max(...ys), Math.max(...zs)],
      studs: out.studs.map((s) => s.map((v) => +v.toFixed(2))), tris: Buffer.from(q.buffer).toString('base64') };
    console.log(`${no} ${out.title}: ${out.tris.length / 3} triangles, ${out.studs.length} studs, bbox ${lib[no].bbox.map((v) => +v.toFixed(1)).join(' ')}`);
  }
  const credit = Object.entries(lib).map(([no, p]) => `//   ${no} ${p.title}: ${p.authors.join(', ')}`).join('\n');
  fs.writeFileSync(OUT, `// Part geometry from the LDraw Parts Library (https://library.ldraw.org), licensed under
// CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Generated by scripts/ldraw.js; don't edit.
// Units are LDraw units (1 stud = 20, 1 plate = 8, y points down), quantized to 1/${Q}. Authors:
${credit}
const LDRAW_PARTS = ${JSON.stringify({ q: Q, parts: lib })};
if (typeof module !== 'undefined') module.exports = { LDRAW_PARTS };
`);
  console.log(`Wrote ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
})().catch((e) => { console.error(e.message); process.exit(1); });
