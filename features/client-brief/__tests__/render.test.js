import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseClientBrief } from '../parse.js';
import { renderClientBriefHtml, renderInline } from '../render.js';

const require = createRequire(import.meta.url);
const { BRIEF_CSS } = require('../../scout-intake/brief-css.cjs');

const SAMPLE = `# NTR Daily Update

Intro line with **bold**.

## Snapshot
**Revenue**: $1,284
Orders: 47

## Wins
- Reel drove saves ([view](https://maps.google.com/?q=ntr))
- Email opened at 41%

## Steps
1. First
2. Second
`;

function render(extraText = '', options = {}) {
  const model = parseClientBrief(SAMPLE + extraText, { clientName: "Rosita's Tacos", asOf: '2026-11-18' });
  return renderClientBriefHtml(model, options);
}

test('document is noindex and uses the shared BRIEF_CSS and brief fonts', () => {
  const html = render();
  assert.match(html, /<meta name="robots" content="noindex,nofollow"/);
  assert.ok(html.includes(BRIEF_CSS));
  assert.ok(html.includes('family=Doto'));
  assert.ok(html.includes('Space+Grotesk'));
  assert.ok(html.includes('Space+Mono'));
});

test('structure: cover, numbered sections, stat rows, lists, footer', () => {
  const html = render();
  assert.match(html, /id="client-brief-cover"/);
  assert.match(html, /<h1 class="headline cb-cover-title">NTR Daily Update<\/h1>/);
  assert.ok(html.includes("ROSITA&#39;S TACOS"));
  assert.match(html, /<div class="sec-num">01<\/div>/);
  assert.match(html, /<div class="sec-num">02<\/div>/);
  assert.ok(!/<div class="sec-num">04<\/div>/.test(html));
  assert.match(html, /<div class="stat-row"><div class="k">Revenue<\/div><div class="v">\$1,284<\/div><\/div>/);
  assert.equal((html.match(/<li>/g) || []).length, 4);
  assert.match(html, /<ol class="cb-list"><li>First<\/li><li>Second<\/li><\/ol>/);
  assert.match(html, /<ul class="cb-list"><li>Reel/);
  assert.match(html, /Nov 18, 2026/);
  assert.match(html, /NOV 18<br\/>2026/);
  assert.equal((html.match(/data-pdf-page/g) || []).length, 4);
  // footer lives inside the last page so no trailing blank PDF page
  assert.match(html, /<footer class="cb-footer"[\s\S]*<\/footer>\s*<\/section>\s*<\/body>/);
});

test('user text is escaped: <script> and attribute payloads stay text', () => {
  const html = render('\n## <script>alert(1)</script>\n**<img src=x onerror=alert(1)>**: "q" & \'a\'\n- <b onmouseover=x>hi</b>\n');
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!/<img src=x/.test(html));
  assert.ok(!/<b onmouseover/.test(html));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;b onmouseover=x&gt;hi&lt;/b&gt;'));
});

test('title and client name are escaped in <title> and cover', () => {
  const model = parseClientBrief('## A\nx', { title: '"><script>x</script>', clientName: '<i>Co</i>' });
  const html = renderClientBriefHtml(model);
  assert.ok(!html.includes('<script>x'));
  assert.ok(!html.includes('<i>Co</i>'));
  assert.ok(html.includes('&lt;i&gt;Co&lt;/i&gt;'));
});

test('links get rel=noopener noreferrer; unsafe tokens never become anchors', () => {
  const html = render();
  assert.match(html, /<a class="cb-link" href="https:\/\/maps\.google\.com\/\?q=ntr" target="_blank" rel="noopener noreferrer">view<\/a>/);
  // a hand-built model with a javascript: link token is neutralised too
  const evil = renderInline([{ t: 'link', v: 'x', href: 'javascript:alert(1)' }]);
  assert.equal(evil, 'x');
  assert.ok(!render('\n[a](javascript:alert(1))').includes('javascript:'));
});

test('PDF link only when pdfPath is a safe path; hidden in print', () => {
  assert.ok(!render().includes('Download PDF</a>'));
  const html = render('', { pdfPath: '/briefs/rositas/client-brief-20261118-aaaaaaaaaaaaaaaa/pdf' });
  assert.match(html, /<a class="cb-pdf-link" id="client-brief-pdf-link" href="\/briefs\/rositas\/client-brief-20261118-aaaaaaaaaaaaaaaa\/pdf">Download PDF<\/a>/);
  assert.match(html, /\.cb-pdf-link\{display:none !important\}/);
  assert.ok(!render('', { pdfPath: 'javascript:alert(1)' }).includes('Download PDF</a>'));
});

test('print rules let long sections flow and avoid breaking mid-block', () => {
  const html = render();
  assert.match(html, /@media print\{[\s\S]*overflow:visible !important/);
  assert.match(html, /\.cb-doc \.cb-block\{break-inside:avoid/);
});

test('no owner contact, address, phone, tax or payment details', () => {
  const html = render('', { pdfPath: '/x/pdf' });
  for (const banned of [/bryanballi/i, /@gmail\.com/i, /venmo/i, /zelle/i, /\bEIN\b/, /tax id/i, /payment/i, /invoice/i, /\(\d{3}\)\s?\d{3}-\d{4}/, /Bryan Balli/i]) {
    assert.ok(!banned.test(html), `found ${banned}`);
  }
});

test('missing asOf and empty model do not throw', () => {
  assert.doesNotThrow(() => renderClientBriefHtml({ title: 'T', sections: [] }));
  assert.doesNotThrow(() => renderClientBriefHtml(null));
  assert.match(renderClientBriefHtml({ title: 'T', asOf: 'Next Tuesday <b>', sections: [] }), /Next Tuesday &lt;b&gt;/);
});
