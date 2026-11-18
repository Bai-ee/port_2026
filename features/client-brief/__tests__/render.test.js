import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClientBrief } from '../parse.js';
import { renderClientBriefHtml, renderInline } from '../render.js';

const SAMPLE = `# NTR Daily Update

Intro line with **bold**.
Second line.

## Snapshot
Revenue: $1,284

| Metric | Value |
|:--|--:|
| Orders | 47 |

- Reel drove saves ([view](https://maps.google.com/?q=ntr))
- Email opened at 41%

3. Third
4. Fourth

> note

---

\`\`\`
code here
\`\`\`
`;

function render(extra = '', options = {}) {
  return renderClientBriefHtml(parseClientBrief(SAMPLE + extra, { clientName: "Rosita's Tacos", asOf: '2026-11-18' }), options);
}

test('one continuous document: blocks appear in source order', () => {
  const html = render();
  const order = ['<h1 ', 'Intro line', '<h2 ', 'Revenue:', '<table', '<ul', '<ol class="cb-list" start="3"', '<blockquote', '<hr', '<pre'];
  let at = -1;
  for (const marker of order) {
    const next = html.indexOf(marker, at + 1);
    assert.ok(next > at, `${marker} out of order`);
    at = next;
  }
  assert.match(html, /Intro line with <strong>bold<\/strong>\.<br \/>Second line\./);
  assert.match(html, /<th style="text-align:left">Metric<\/th>/);
  assert.match(html, /<td style="text-align:right">47<\/td>/);
});

test('no cover, hero, section numbers, marquee or one-section-per-page layout', () => {
  const html = render();
  const classes = [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]).join(' ');
  for (const banned of ['page', 'cover', 'sec-num', 'marquee', 'cb-page', 'headline', 'title-stack']) {
    assert.ok(!new RegExp(`(^|\\s)${banned}(\\s|$)`).test(classes), `found class ${banned}`);
  }
  assert.ok(!html.includes('data-pdf-page'));
  assert.ok(!/Section \d/.test(html));
  assert.ok(!html.includes('<section'));
});

test('house fonts + colour variables; flat paper background (no gradient blobs)', () => {
  const html = render();
  assert.match(html, /family=Doto/);
  assert.match(html, /Space\+Grotesk/);
  assert.match(html, /Space\+Mono/);
  assert.match(html, /font-family:"Doto"/);
  assert.match(html, /--ink:#0a0a0a/);
  assert.match(html, /body\.cb-doc\{background:var\(--bg\)/);
  assert.match(html, /max-width:760px/);
});

test('print CSS: same flow, headings kept with next, rows/items not split', () => {
  const html = render();
  assert.match(html, /@media print/);
  assert.match(html, /\.cb-h\{break-after:avoid/);
  assert.match(html, /\.cb-table tr[^{]*\{break-inside:avoid/);
  assert.match(html, /cb-list li[^{]*\{break-inside:avoid/);
  assert.match(html, /@page\{size:A4/);
  assert.ok(!/overflow:hidden !important/.test(html.split('<style>')[2] || ''));
});

test('noindex, escaping, safe links, header/footer, no owner contact', () => {
  const evil = renderClientBriefHtml(parseClientBrief('<img src=x onerror=alert(1)> [x](javascript:alert(1)) "q" \'a\'', { clientName: '<b>Co</b>' }), { pdfPath: '/briefs/c/b/pdf' });
  assert.match(evil, /<meta name="robots" content="noindex,nofollow" \/>/);
  assert.ok(!evil.includes('<img src=x'));
  assert.ok(!evil.includes('<b>Co</b>'));
  assert.ok(!/href="javascript/i.test(evil));
  assert.match(evil, /id="client-brief-pdf-link" href="\/briefs\/c\/b\/pdf"/);
  const html = render('', { pdfPath: '/p/pdf' });
  assert.match(html, /id="client-brief-header"/);
  assert.match(html, /Nov 18, 2026/);
  assert.ok(!/bryanballi|@gmail|venmo|invoice/i.test(html));
  assert.match(html, /rel="noopener noreferrer"/);
});

test('renderInline re-validates link hrefs (defense in depth)', () => {
  assert.equal(renderInline([{ t: 'link', href: 'javascript:alert(1)', c: [{ t: 'text', v: 'x' }] }]), 'x');
  assert.match(renderInline([{ t: 'link', href: 'https://a.com/', c: [{ t: 'text', v: 'x' }] }]), /<a class="cb-link" href="https:\/\/a.com\/"/);
});
