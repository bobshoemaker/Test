// The site step's record as a page (site.js report.stages): for each stage, what it found and why, its pictures, the
// reasoning Claude summarized while working, and what it cost. The admin page opens it for any design that was mapped
// from above; everything in it is escaped, and the pictures are inline JPEGs the server drew.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (x) => (Number.isFinite(x) ? `$${x.toFixed(2)}` : '');

function stageHtml(st, n) {
  const pics = (st.images || []).filter((im) => im.data || im.src).map((im) => `<figure><img src="${im.src ? esc(im.src) : `data:${esc(im.mediaType || 'image/jpeg')};base64,${im.data}`}" alt="${esc(im.label)}" loading="lazy"><figcaption>${esc(im.label)}</figcaption></figure>`).join('');
  const thoughts = (st.thoughts || []).filter(Boolean);
  return `<section class="stage"><h2><span class="n">${n}</span>${esc(st.title)}</h2>
  <p class="meta">${[st.secs != null ? `at ${Math.floor(st.secs / 60)}:${String(st.secs % 60).padStart(2, '0')}` : '', st.usd != null ? money(st.usd) : ''].filter(Boolean).join(' · ')}</p>
  <p>${esc(st.summary)}</p>
  ${(st.details || []).length ? `<ul>${st.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
  ${pics ? `<div class="pics">${pics}</div>` : ''}
  ${thoughts.length ? `<details><summary>Reasoning while working (${thoughts.length} note${thoughts.length > 1 ? 's' : ''})</summary>${thoughts.map((t) => `<p class="thought">${esc(t)}</p>`).join('')}</details>` : ''}
</section>`;
}

function siteReportHtml(report, { costUsd = null } = {}) {
  const stages = (report && report.stages) || [];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Site map: ${esc(report && report.address)}</title>
<style>
:root{--bg:#faf7f2;--ink:#2b2622;--muted:#7a7068;--card:#fff;--line:#e8e0d6}
@media (prefers-color-scheme:dark){:root{--bg:#1d1a17;--ink:#f1ebe4;--muted:#a79d93;--card:#27231f;--line:#3a342e}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:24px;margin:0 0 4px} .sub{color:var(--muted);margin:0 0 18px}
.stage{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:14px 0}
h2{font-size:18px;margin:0;display:flex;gap:10px;align-items:center} .n{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--ink);color:var(--bg);font-size:14px}
.meta{color:var(--muted);font-size:13px;margin:2px 0 8px} ul{padding-left:20px} li{margin:2px 0}
.pics{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-top:10px}
figure{margin:0} img{width:100%;border-radius:8px;display:block} figcaption{font-size:13px;color:var(--muted);margin-top:4px}
details{margin-top:10px} summary{cursor:pointer;color:var(--muted)} .thought{font-size:14px;border-left:3px solid var(--line);padding-left:10px;white-space:pre-wrap}
</style></head><body><main>
<h1>How the house was found and mapped</h1>
<p class="sub">${esc(report && report.address)}${report && report.seconds ? ` · ${Math.round(report.seconds / 60)} min` : ''}${costUsd != null ? ` · ${money(costUsd)} of API time` : ''}</p>
${stages.map((st, i) => stageHtml(st, i + 1)).join('\n')}
</main></body></html>`;
}

module.exports = { siteReportHtml, stageHtml, esc };
