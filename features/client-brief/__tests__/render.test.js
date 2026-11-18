import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClientBrief, inlineToPlain } from '../parse.js';
import { renderClientBriefDocument, renderInline, CLIENT_BRIEF_CSS } from '../render.js';
import { INVOICE_CSS } from '../../invoices/render.js';
import { BUILTIN_THEME_PRESETS } from '../../../app/dashboard/studio/invoice/themes/theme-schema.js';

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

### Sub heading

3. Third
4. Fourth

## Next steps

> note

---

\`\`\`
code here
\`\`\`
`;

const renderClientBriefHtml = (model, options) => renderClientBriefDocument(model, options).html;
const parse = (text = SAMPLE) => parseClientBrief(text, { clientName: "Rosita's Tacos", asOf: '2026-11-18' });
function render(extra = '', options = {}) {
  return renderClientBriefHtml(parse(SAMPLE + extra), options);
}

test('invoice look: INVOICE_CSS + brief base CSS, invoice hero/cover, meta strip, doc label', () => {
  const html = render();
  assert.ok(html.includes(INVOICE_CSS), 'INVOICE_CSS is embedded verbatim');
  assert.match(html, /class="invoice-sheet cb-sheet"/);
  assert.match(html, /<header class="invoice-hero cb-cover" id="client-brief-cover">/);
  // Owner rule 2026-11-18: no small-caps label headers (no "Client Brief" eyebrow, no Client/Date/Prepared-by labels, no "• Section 0N").
  assert.doesNotMatch(html, /client-brief-doc-label|cb-eyebrow|cb-dot|class="k"|>Section \d/);
  assert.match(html, /<h1 class="invoice-hero-title" id="client-brief-title">NTR Daily Update<\/h1>/);
  assert.match(html, /<p class="cb-byline" id="client-brief-byline">Rosita&#39;s Tacos · Nov 18, 2026 · Prepared by HITLOOP<\/p>/);
  assert.match(html, /family=Doto/);
  assert.match(html, /Space\+Grotesk/);
  assert.match(html, /id="client-brief-footer"/);
});

test('## headings become brief-style sections, in source order, numbered 01..', () => {
  const html = render();
  const order = ['id="client-brief-section-1"', '>Snapshot<', 'Revenue:', '<table', '<ul', 'Sub heading', '<ol class="cb-list" start="3"', 'id="client-brief-section-2"', '>Next steps<', '<blockquote', '<hr', '<pre'];
  let at = -1;
  for (const marker of order) {
    const next = html.indexOf(marker, at + 1);
    assert.ok(next > at, `${marker} out of order`);
    at = next;
  }
  assert.equal((html.match(/class="cb-section-head"/g) || []).length, 2);
  assert.match(html, /<span class="cb-sec-num" aria-hidden="true">02<\/span>/);
  assert.match(html, /<h2 class="cb-section-title">Snapshot<\/h2>/);
  // ### stays a sub-heading inside its section
  assert.match(html, /<h3 class="cb-h cb-h3">Sub heading<\/h3>/);
  assert.match(html, /Intro line with <strong>bold<\/strong>\.<br \/>Second line\./);
  // content before the first ## lives in the intro, under the cover
  assert.ok(html.indexOf('id="client-brief-intro"') < html.indexOf('id="client-brief-section-1"'));
  assert.ok(html.indexOf('Intro line') > html.indexOf('id="client-brief-cover"'));
  assert.match(html, /<th style="text-align:left">Metric<\/th>/);
  assert.match(html, /<td style="text-align:right">47<\/td>/);
});

test('H1 equal to the title is not repeated; a different H1 stays in the flow', () => {
  const same = render();
  assert.equal((same.match(/NTR Daily Update<\/h/g) || []).length, 1);
  const other = renderClientBriefHtml(parseClientBrief('# Real heading\n\nbody\n\n## S\nx', { title: 'Custom Title', clientName: 'Co', asOf: '2026-11-18' }));
  assert.match(other, /<h1 class="invoice-hero-title" id="client-brief-title">Custom Title<\/h1>/);
  assert.match(other, /<h1 class="cb-h cb-h1">Real heading<\/h1>/);
});

test('nothing is dropped: every block text appears, in source order', () => {
  const model = parse();
  const html = renderClientBriefHtml(model);
  const texts = [];
  const plain = (tokens) => inlineToPlain(tokens || []);
  for (const block of model.blocks) {
    if (block.type === 'heading' && block.level === 1) continue; // the title (shown in the cover)
    if (block.type === 'heading' || block.type === 'paragraph') texts.push(plain(block.tokens));
    else if (block.type === 'blockquote') (block.paragraphs || []).forEach((p) => texts.push(plain(p.tokens)));
    else if (block.type === 'list') block.items.forEach((i) => texts.push(plain(i.tokens)));
    else if (block.type === 'table') { texts.push(...block.header.cells.map((c) => plain(c.tokens))); block.rows.forEach((r) => r.cells.forEach((c) => texts.push(plain(c.tokens)))); }
    else if (block.type === 'code') texts.push(block.text);
  }
  assert.ok(texts.length > 10);
  const visible = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<br \/>/g, ' ').replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  let at = -1;
  for (const t of texts) {
    const next = visible.indexOf(t.replace(/\s+/g, ' ').trim(), at + 1);
    assert.ok(next > at, `"${t}" dropped or out of order`);
    at = next;
  }
});

test('theme: built-in ids apply theme CSS + marker on <html>; unknown themes are ignored', () => {
  for (const preset of BUILTIN_THEME_PRESETS) {
    const html = render('', { theme: { id: preset.id } });
    assert.match(html, new RegExp(`<html lang="en" data-invoice-theme="${preset.id}">`));
    assert.match(html, new RegExp(`html\\[data-invoice-theme="${preset.id}"\\]`));
    assert.ok(html.includes(preset.colors.paper));
    assert.ok(html.indexOf('data-invoice-theme') < html.indexOf(CLIENT_BRIEF_CSS.slice(0, 40)), 'theme CSS precedes brief CSS');
  }
  const bad = render('', { theme: { id: 'evil', colors: { paper: 'red' } } });
  assert.ok(!bad.includes('data-invoice-theme'));
  assert.ok(!render().includes('data-invoice-theme'));
  const ledger = render('', { theme: { id: 'ledger' } });
  assert.match(ledger, /IBM\+Plex\+Mono/);
  // always A4: the brief's own @page comes after the theme's (which says letter)
  assert.ok(ledger.lastIndexOf('@page{size:A4') > ledger.indexOf('size:letter'));
});

test('dark themes print as dark ink on white (no white frame around a dark page)', () => {
  const dark = render('', { theme: { id: 'studio-dark' } });
  assert.match(dark, /@media print\{\s*html\[data-invoice-theme="studio-dark"\]/);
  assert.ok(!render('', { theme: { id: 'ledger' } }).includes('--bg:#fff;--card:#fff'));
});

test('print CSS: dense, flowing; no forced page breaks, avoid rules on small units', () => {
  const html = render();
  assert.match(html, /@media print/);
  assert.match(html, /@page\{size:A4;margin:16mm 14mm\}/);
  assert.match(html, /\.cb-doc \.cb-h,\.cb-doc \.cb-section-head\{break-after:avoid/);
  assert.match(html, /\.cb-table tr[^{]*\{break-inside:avoid/);
  assert.match(html, /\.cb-list li[^{]*\{break-inside:avoid/);
  assert.match(html, /\.cb-quote[^{]*\{break-inside:avoid/);
  assert.match(html, /\.cb-table thead\{display:table-header-group\}/);
  assert.match(html, /orphans:3;widows:3/);
  assert.match(html, /font-size:10pt/);
  // the brief's own CSS never forces a break or full-height page
  assert.ok(!/break-(before|after):\s*(page|always)/.test(CLIENT_BRIEF_CSS));
  assert.ok(!/page-break-(before|after):\s*always/.test(CLIENT_BRIEF_CSS));
  assert.ok(!/min-height:\s*100vh/.test(CLIENT_BRIEF_CSS));
  // sections are not wrapped in the invoice/brief page-jumping classes
  const body = html.slice(html.indexOf('<body'));
  assert.ok(!/class="[^"]*\b(invoice-block|page)\b[^"]*"/.test(body));
  assert.ok(!body.includes('data-pdf-page'));
  assert.ok(!/<section[^>]*class="page/.test(body));
});

test('brand mark: only when passed in; never owner contact, payment or tax info', () => {
  const none = render();
  assert.ok(!none.includes('client-brief-brand-logo'));
  const brand = { logo: { dataUri: 'data:image/png;base64,AAAA', width: 160, height: 133 }, wordmark: 'HITLOOP' };
  const withBrand = render('', { brand });
  assert.match(withBrand, /<img id="client-brief-brand-logo" src="data:image\/png;base64,AAAA"/);
  const forged = render('', { brand: { logo: { dataUri: 'javascript:alert(1)' } } });
  assert.ok(!forged.includes('client-brief-brand-logo'));
  for (const html of [none, withBrand]) {
    assert.ok(!/bryanballi|@gmail|venmo|routing|account number|tax id|\bEIN\b|\(\d{3}\) ?\d{3}-\d{4}/i.test(html));
  }
});

test('noindex, escaping, safe links, no raw HTML', () => {
  const evil = renderClientBriefHtml(parseClientBrief('<img src=x onerror=alert(1)> [x](javascript:alert(1)) "q" \'a\'\n\n## <script>alert(2)</script>', { clientName: '<b>Co</b>', title: '"><script>t</script>' }), { pdfPath: '/briefs/c/b/pdf' });
  assert.match(evil, /<meta name="robots" content="noindex,nofollow" \/>/);
  assert.ok(!evil.includes('<img src=x'));
  assert.ok(!evil.includes('<b>Co</b>'));
  assert.ok(!evil.includes('<script>alert(2)'));
  assert.ok(!evil.includes('<script>t</script>'));
  assert.ok(!/href="javascript/i.test(evil));
  assert.match(evil, /id="client-brief-pdf-link" class="invoice-pdf-link" href="\/briefs\/c\/b\/pdf"/);
  assert.match(render('', { pdfPath: '/p/pdf' }), /rel="noopener noreferrer"/);
  assert.ok(!render('', { pdfPath: 'javascript:alert(1)' }).includes('client-brief-pdf-link'));
});

test('renderClientBriefDocument returns html + section count; renderInline re-validates hrefs', () => {
  const doc = renderClientBriefDocument(parse());
  assert.equal(doc.sectionCount, 2);
  assert.ok(doc.html.startsWith('<!doctype html>'));
  assert.equal(renderInline([{ t: 'link', href: 'javascript:alert(1)', c: [{ t: 'text', v: 'x' }] }]), 'x');
  assert.match(renderInline([{ t: 'link', href: 'https://a.com/', c: [{ t: 'text', v: 'x' }] }]), /<a class="cb-link" href="https:\/\/a.com\/"/);
});

test('renderer stays client-safe: no createRequire, no node crypto, no .cjs import', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../render.js', import.meta.url), 'utf8');
  assert.ok(!/createRequire|from 'crypto'|from 'module'|\.cjs/.test(src.replace(/\/\/.*$/gm, '')));
  assert.match(src, /from '\.\.\/invoices\/brief-css\.js'/);
});
