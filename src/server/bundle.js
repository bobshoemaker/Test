// Builds the single-file viewer page for one design: the viewer HTML with the design, the
// engine and the app inlined. Used by scripts/bundle.js and by the draft renderer.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');

function bundleHtml(designText) {
  const html = fs.readFileSync(path.join(ROOT, 'src/viewer/index.html'), 'utf8');
  const engine = fs.readFileSync(path.join(ROOT, 'src/engine/parts-availability.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'src/engine/engine.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'src/viewer/app.js'), 'utf8');
  const ldraw = fs.readFileSync(path.join(ROOT, 'src/viewer/ldraw-parts.js'), 'utf8');
  const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
  // Function replacement: the code contains "$'" sequences that a string replacement would expand.
  return html.replace('<script src="/parts-availability.js"></script>\n<script src="/engine.js"></script>\n<script src="/viewer/ldraw-parts.js"></script>\n<script src="/viewer/app.js"></script>',
    () => `<script type="application/json" id="designJson">\n${safe(designText)}\n</script>\n<script>\n${safe(engine)}\n</script>\n<script>\n${safe(ldraw)}\n</script>\n<script>\n${safe(app)}\n</script>`);
}

module.exports = { bundleHtml };
