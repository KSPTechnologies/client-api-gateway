// Regenerate docs/KSP-API-Integration-Guide.pdf from client-integration-guide.md.
// Run AFTER any guide edit, from docs/ (needs `npm i marked` once, anywhere on NODE_PATH,
// or run with `npm exec` from a folder that has it):
//   node generate-pdf.js
//   "<path to msedge.exe>" --headless --disable-gpu --no-pdf-header-footer \
//     --print-to-pdf="<repo>\docs\KSP-API-Integration-Guide.pdf" "file:///<repo>/docs/guide.html"
// Then delete guide.html and commit the PDF.
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const SRC = path.join(__dirname, 'client-integration-guide.md');
const OUT = path.join(__dirname, 'guide.html');

let md = fs.readFileSync(SRC, 'utf8');
const body = marked.parse(md, { mangle: false, headerIds: false });

const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<title>KSP API Integration Guide</title>
<style>
  :root {
    --navy: #262262; --royal: #2c388d; --blue: #005881; --lblue: #4887c7;
    --mint: #e5f4f3; --gold: #e6b222; --ink: #1a1a1a;
  }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: var(--ink); font-size: 10.5pt; line-height: 1.5; margin: 0; }
  .cover { padding: 24pt 0 18pt 0; border-bottom: 4pt solid var(--gold); margin-bottom: 18pt; }
  .cover .brand { font-size: 22pt; font-weight: 800; font-style: italic; color: var(--navy); letter-spacing: -0.5pt; }
  .cover .entity { font-size: 10pt; font-weight: 600; letter-spacing: 3pt; color: var(--lblue); text-transform: uppercase; margin-top: 2pt; }
  .cover .subtitle { font-size: 13pt; color: var(--blue); margin-top: 10pt; }
  .cover .meta { font-size: 9pt; color: #666; margin-top: 4pt; }
  h1 { font-size: 17pt; color: var(--navy); border-bottom: 2pt solid var(--lblue); padding-bottom: 4pt; }
  h2 { font-size: 13.5pt; color: var(--navy); margin-top: 20pt; page-break-after: avoid; border-bottom: 1pt solid var(--mint); padding-bottom: 3pt; }
  h3 { font-size: 11.5pt; color: var(--royal); margin-top: 14pt; page-break-after: avoid; }
  code { font-family: Consolas, 'Courier New', monospace; font-size: 9.5pt; background: var(--mint); padding: 0.5pt 3pt; border-radius: 2pt; }
  pre { background: #f4f7f8; border: 1pt solid #d8e4e3; border-left: 3pt solid var(--lblue); padding: 8pt 10pt; border-radius: 3pt; overflow-x: hidden; white-space: pre-wrap; word-wrap: break-word; page-break-inside: avoid; }
  pre code { background: none; padding: 0; font-size: 9pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; page-break-inside: avoid; font-size: 9.5pt; }
  th { background: var(--navy); color: #fff; text-align: left; padding: 4pt 7pt; font-weight: 600; }
  td { border: 1pt solid #d5dbe5; padding: 3.5pt 7pt; vertical-align: top; }
  tr:nth-child(even) td { background: #f6f8fb; }
  hr { border: none; border-top: 1pt solid #d8e4e3; margin: 16pt 0; }
  a { color: var(--blue); text-decoration: none; }
  blockquote { border-left: 3pt solid var(--gold); margin: 8pt 0; padding: 2pt 10pt; color: #444; background: #fdf9ee; }
  li { margin: 2pt 0; }
  strong { color: var(--navy); }
  @page { margin: 18mm 16mm; }
</style></head>
<body>
<div class="cover">
  <div class="brand">KSP</div>
  <div class="entity">Fulfillment</div>
  <div class="subtitle">Client API Integration Guide &mdash; connect.ksp3plhq.com</div>
  <div class="meta">Revised ${today}</div>
</div>
${body}
</body></html>`;

fs.writeFileSync(OUT, html);
console.log('wrote', OUT, html.length, 'chars');
