#!/usr/bin/env node
// Checks that no two parts of a design cut through each other as the viewer draws them: every part drawn from LDraw
// geometry (leaves, sprigs, fronds, round parts, windows, ...) is tested triangle against triangle with the parts
// around it (plain bricks, plates and tiles as their boxes). The engine keeps parts in their cells and checks each
// part's measured overhang ("reach" in engine.js); this measures the drawing itself, so rerun it after changing a
// part's geometry, pose or reach. Where stacked parts meet (a stud in the part above), two round parts just touching,
// a part and what it hangs on, and a palm top's peg in the hollow studs under it don't count. Needs Playwright.
//   node scripts/clips.js designs/griffith-park.json [more designs]    (exits 1 when anything cuts through)
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { bundleHtml } = require('../src/server/bundle');

function playwright() {
  try { return require('playwright'); } catch { /* the global install */ }
  return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
}

// Runs in the viewer page: the crossings between drawn parts.
function crossings() {
  /* global R, recOf, ldrawGeo, OFF, PH, THREE */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const side = (n, d, v) => { const s = (dot(n, v) + d) / Math.hypot(...n); return Math.abs(s) < 1e-5 ? 0 : s; };
  const apart = (d) => (d[0] > 0 && d[1] > 0 && d[2] > 0) || (d[0] < 0 && d[1] < 0 && d[2] < 0);
  // Moller's triangle-triangle test: a point where the two cross, or null (faces that only touch don't count)
  function triTri(A, B) {
    const nB = cross(sub(B[1], B[0]), sub(B[2], B[0])), nA = cross(sub(A[1], A[0]), sub(A[2], A[0]));
    if (Math.hypot(...nB) < 1e-12 || Math.hypot(...nA) < 1e-12) return null;
    const da = A.map((v) => side(nB, -dot(nB, B[0]), v)); if (apart(da) || da.every((d) => d === 0)) return null;
    const db = B.map((v) => side(nA, -dot(nA, A[0]), v)); if (apart(db)) return null;
    const seg = (T, d) => { const pts = []; for (let i = 0; i < 3; i++) { const j = (i + 1) % 3; if (d[i] === 0) pts.push(T[i]);
      if ((d[i] > 0 && d[j] < 0) || (d[i] < 0 && d[j] > 0)) { const t = d[i] / (d[i] - d[j]); pts.push(T[i].map((c, k) => c + t * (T[j][k] - c))); } } return pts; };
    const sa = seg(A, da), sb = seg(B, db); if (sa.length < 2 || sb.length < 2) return null;
    const D = cross(nA, nB), pa = sa.map((q) => dot(D, q)), pb = sb.map((q) => dot(D, q));
    const a0 = Math.min(...pa), a1 = Math.max(...pa), lo = Math.max(a0, Math.min(...pb)), hi = Math.min(a1, Math.max(...pb));
    if (hi - lo <= 1e-4 * Math.hypot(...D)) return null;
    const q0 = sa[pa.indexOf(a0)], q1 = sa[pa.indexOf(a1)], f = a1 > a0 ? ((lo + hi) / 2 - a0) / (a1 - a0) : 0;
    return q0.map((c, k) => c + f * (q1[k] - c));
  }
  const box = (t) => [0, 1, 2].map((k) => [Math.min(t[0][k], t[1][k], t[2][k]), Math.max(t[0][k], t[1][k], t[2][k])]);
  const over = (a, b) => a.every(([lo, hi], k) => lo <= b[k][1] && b[k][0] <= hi);
  // each part's drawn triangles, in studs across and plates up
  const v = new THREE.Vector3(), info = [];
  for (const q of R.parts) {
    const rec = recOf.get(q.id), geo = rec && rec.m && ldrawGeo(q.no); let pts = null;
    if (geo) { const pos = geo.attributes.position; pts = []; for (let t = 0; t < pos.count; t++) { v.fromBufferAttribute(pos, t).applyMatrix4(rec.m); pts.push([v.x + OFF, v.y / PH, v.z + OFF]); } }
    else if (q.shape === 'box') { const e = 0.02, x0 = q.x + e, x1 = q.x + q.w - e, z0 = q.z + e, z1 = q.z + q.d - e, y0 = q.y + e, y1 = q.y + q.h - e;
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      pts = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]].flatMap((f) => f.map((k) => c[k])); }
    if (!pts) continue;
    const T = []; for (let t = 0; t < pts.length; t += 3) { const A = [pts[t], pts[t + 1], pts[t + 2]]; T.push({ A, bb: box(A) }); }
    info.push({ q, T, ld: !!geo, bb: [0, 1, 2].map((k) => [Math.min(...T.map((t) => t.bb[k][0])), Math.max(...T.map((t) => t.bb[k][1]))]) });
  }
  // what doesn't count: where stacked parts meet, two bodies touching between their cells, a palm top's peg
  const joint = (P, Q, pt) => P.y + P.h === Q.y && Math.abs(pt[1] - Q.y) < 0.6 && pt[0] > Math.max(P.x, Q.x) - 0.05 && pt[0] < Math.min(P.x + P.w, Q.x + Q.w) + 0.05
    && pt[2] > Math.max(P.z, Q.z) - 0.05 && pt[2] < Math.min(P.z + P.d, Q.z + Q.d) + 0.05;
  const near = (P, pt) => pt[0] > P.x - 0.03 && pt[0] < P.x + P.w + 0.03 && pt[2] > P.z - 0.03 && pt[2] < P.z + P.d + 0.03 && pt[1] > P.y - 0.03 && pt[1] < P.y + P.h + 0.6;
  const peg = (P, pt) => P.key === 'palmtop' && pt[1] < P.y && Math.hypot(pt[0] - P.x - 0.5, pt[2] - P.z - 0.5) < 0.25;
  const grid = new Map(), seen = new Set(), out = [];
  info.forEach((o, i) => { for (let x = Math.floor(o.bb[0][0]); x <= Math.floor(o.bb[0][1]); x++) for (let z = Math.floor(o.bb[2][0]); z <= Math.floor(o.bb[2][1]); z++) {
    const k = x + ',' + z; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); } });
  for (const list of grid.values()) for (let a = 0; a < list.length; a++) for (let c = a + 1; c < list.length; c++) {
    const i = Math.min(list[a], list[c]), j = Math.max(list[a], list[c]), k = i + '|' + j; if (seen.has(k)) continue; seen.add(k);
    const A = info[i], B = info[j]; if ((!A.ld && !B.ld) || !over(A.bb, B.bb)) continue;
    if ((A.q.mount || []).includes(B.q.id) || (B.q.mount || []).includes(A.q.id)) continue;
    const ta = A.T.filter((t) => over(t.bb, B.bb)), tb = B.T.filter((t) => over(t.bb, A.bb));
    let n = 0, at = null;
    for (const t1 of ta) for (const t2 of tb) { if (!over(t1.bb, t2.bb)) continue; const pt = triTri(t1.A, t2.A); if (!pt) continue;
      if (joint(A.q, B.q, pt) || joint(B.q, A.q, pt) || (near(A.q, pt) && near(B.q, pt)) || peg(A.q, pt) || peg(B.q, pt)) continue;
      n++; if (!at) at = pt.map((c) => +c.toFixed(2)); }
    const name = (q) => `${q.name.toLowerCase()} #${q.id} at (${q.x}, ${q.y}, ${q.z})`;
    if (n) out.push({ n, a: name(A.q), b: name(B.q), at });
  }
  return out.sort((a, b) => b.n - a.n);
}

(async () => {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node scripts/clips.js design.json [...]'); process.exit(2); }
  const three = await (await fetch('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js')).text();
  const opts = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
  if (process.env.BRICKHOUSE_CHROMIUM) opts.executablePath = process.env.BRICKHOUSE_CHROMIUM;
  const browser = await playwright().chromium.launch(opts);
  let bad = 0;
  for (const file of files) {
    const page = await browser.newPage();
    await page.route('**/three.min.js', (r) => r.fulfill({ body: three, contentType: 'text/javascript' }));
    await page.setContent(bundleHtml(fs.readFileSync(file, 'utf8')), { waitUntil: 'load' });
    await page.waitForFunction(() => typeof R !== 'undefined' && R && R.parts && recOf.size > 0, null, { timeout: 60000 }); // eslint-disable-line no-undef
    const found = await page.evaluate(crossings);
    console.log(`${path.basename(file)}: ${found.length ? `${found.length} pairs of parts cut through each other` : 'nothing cuts through anything'}`);
    for (const f of found.slice(0, 20)) console.log(`  ${f.a} and ${f.b}, at (${f.at.join(', ')})`);
    bad += found.length; await page.close();
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
