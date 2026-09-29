// Builds the single-file viewer page for one design: the viewer HTML with the design, the
// engine and the app inlined. Used by scripts/bundle.js and by the draft renderer.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');

// The top bar (src/viewer/topbar.html) in place of a page's placeholder: one component for both pages.
function withTopbar(html) {
  const bar = fs.readFileSync(path.join(ROOT, 'src/viewer/topbar.html'), 'utf8');
  return html.replace('<!-- topbar -->', () => bar);
}

function bundleHtml(designText) {
  const html = withTopbar(fs.readFileSync(path.join(ROOT, 'src/viewer/index.html'), 'utf8'));
  const engine = ['parts-availability.js', 'suppliers.js', 'engine.js'].map((f) => fs.readFileSync(path.join(ROOT, 'src/engine', f), 'utf8')).join('\n');
  const app = fs.readFileSync(path.join(ROOT, 'src/viewer/app.js'), 'utf8');
  const ldraw = fs.readFileSync(path.join(ROOT, 'src/viewer/ldraw-parts.js'), 'utf8');
  const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
  // Function replacement: the code contains "$'" sequences that a string replacement would expand.
  return html.replace('<script src="/parts-availability.js"></script>\n<script src="/suppliers.js"></script>\n<script src="/engine.js"></script>\n<script src="/viewer/ldraw-parts.js"></script>\n<script src="/viewer/app.js"></script>',
    () => `<script type="application/json" id="designJson">\n${safe(designText)}\n</script>\n<script>\n${safe(engine)}\n</script>\n<script>\n${safe(ldraw)}\n</script>\n<script>\n${safe(app)}\n</script>`);
}

module.exports = { withTopbar, bundleHtml };
