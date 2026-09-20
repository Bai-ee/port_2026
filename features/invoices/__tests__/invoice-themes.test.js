// Q3 (Lane T) — theme + print-geometry wiring in render.js.
// design-layer plan §3.2/§3.3, L1/L2/L3/L8.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderInvoiceHtml } from '../render.js';
import { HITLOOP_BRAND } from '../brand-marks.js';
import { SAMPLE_INVOICE } from './fixtures/sample-invoice.js';
import {
  BUILTIN_THEME_PRESETS,
  themeToCss,
  themeFontsHref,
} from '../../../app/dashboard/studio/invoice/themes/theme-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readBaseline = () => fs.readFileSync(path.join(__dirname, 'fixtures/invoice-baseline-pre-studio.html'), 'utf8');

test('theme:null (and theme omitted) stays byte-identical to the golden fixture', () => {
  const baseline = readBaseline();
  const withNullTheme = renderInvoiceHtml(SAMPLE_INVOICE, { brand: HITLOOP_BRAND, editable: false, theme: null });
  const withOmittedTheme = renderInvoiceHtml(SAMPLE_INVOICE, { brand: HITLOOP_BRAND, editable: false });
  assert.equal(withNullTheme, baseline);
  assert.equal(withOmittedTheme, baseline);
});

test('theme:null emits no data-invoice-theme marker and no extra theme style/font link', () => {
  const html = renderInvoiceHtml(SAMPLE_INVOICE, { theme: null });
  assert.ok(!html.includes('data-invoice-theme'));
  assert.ok(!html.includes('fonts.googleapis.com/css2?family=IBM'));
  assert.ok(!html.includes('fonts.googleapis.com/css2?family=Playfair'));
  assert.ok(!html.includes('fonts.googleapis.com/css2?family=Unbounded'));
});

test('a malformed/unknown theme object is treated as null (defensive normalizeTheme), not passed through raw', () => {
  const baseline = readBaseline();
  const html = renderInvoiceHtml(SAMPLE_INVOICE, {
    brand: HITLOOP_BRAND,
    editable: false,
    theme: { id: 'nonsense', colors: { paper: '#ff00ff', ink: '#000' }, fonts: {}, paper: 'letter' },
  });
  assert.equal(html, baseline);
});

test('each built-in theme renders its data-invoice-theme marker, its themeToCss() output, and its font link', () => {
  for (const theme of BUILTIN_THEME_PRESETS) {
    const html = renderInvoiceHtml(SAMPLE_INVOICE, { theme });
    assert.ok(html.includes(`<html lang="en" data-invoice-theme="${theme.id}">`), `${theme.id}: missing html marker`);
    assert.ok(html.includes(themeToCss(theme)), `${theme.id}: themeToCss() output not found verbatim`);
    const href = themeFontsHref(theme);
    assert.ok(href, `${theme.id}: themeFontsHref() returned empty`);
    // esc() only rewrites '&' for this URL shape (no other reserved chars in
    // a Google Fonts css2 href), so compare against that same rewrite.
    assert.ok(html.includes(href.replace(/&/g, '&amp;')), `${theme.id}: font <link> href not found`);
    // The default Doto/Space Grotesk/Space Mono link must still be present
    // (L3: additive, never a replacement) even under a theme.
    assert.ok(html.includes('family=Doto:wght@400;700;900'), `${theme.id}: lost the default font link`);
  }
});

test('Ledger (paper:"letter") emits @page{size:letter;...} geometry', () => {
  const ledger = BUILTIN_THEME_PRESETS.find((t) => t.id === 'ledger');
  assert.equal(ledger.paper, 'letter');
  const html = renderInvoiceHtml(SAMPLE_INVOICE, { theme: ledger });
  assert.match(html, /@page\{size:letter;margin:\d+mm;\}/);
});

test('Studio Dark (paper:"fluid") emits a margin-only @page rule, no size:', () => {
  const dark = BUILTIN_THEME_PRESETS.find((t) => t.id === 'studio-dark');
  assert.equal(dark.paper, 'fluid');
  const html = renderInvoiceHtml(SAMPLE_INVOICE, { theme: dark });
  assert.match(html, /@page\{margin:\d+mm;\}/);
  // The compact (no-space) theme form of a sized rule must not appear.
  assert.ok(!html.includes('@page{size:'));
});

test('Studio Dark emits print-color-adjust so its dark background survives print', () => {
  const dark = BUILTIN_THEME_PRESETS.find((t) => t.id === 'studio-dark');
  const html = renderInvoiceHtml(SAMPLE_INVOICE, { theme: dark });
  assert.ok(html.includes('-webkit-print-color-adjust:exact'));
  assert.ok(html.includes('print-color-adjust:exact'));
});

test('options.paper:"letter" with theme:null applies Letter @page geometry but keeps the default look', () => {
  const html = renderInvoiceHtml(SAMPLE_INVOICE, { theme: null, paper: 'letter' });
  assert.ok(!html.includes('data-invoice-theme'));
  assert.match(html, /@page\{size:letter;margin:14mm;\}/);
  // No theme <style>/font link beyond the paper geometry rule itself.
  assert.ok(!html.includes('fonts.googleapis.com/css2?family=IBM'));
});

test('options.paper:"a4" with theme omitted applies A4 @page geometry', () => {
  const html = renderInvoiceHtml(SAMPLE_INVOICE, { paper: 'a4' });
  assert.ok(!html.includes('data-invoice-theme'));
  assert.match(html, /@page\{size:a4;margin:14mm;\}/);
});

test('an explicit paper override is ignored whenever a theme is present (theme.paper wins)', () => {
  const ledger = BUILTIN_THEME_PRESETS.find((t) => t.id === 'ledger'); // paper: 'letter'
  const html = renderInvoiceHtml(SAMPLE_INVOICE, { theme: ledger, paper: 'a4' });
  assert.ok(!html.includes('@page{size:a4;'));
  assert.match(html, /@page\{size:letter;margin:\d+mm;\}/);
});

test('print pagination CSS (per-row/totals no-split, lineItems section override) ships only with a theme or explicit paper', () => {
  const bare = renderInvoiceHtml(SAMPLE_INVOICE, {});
  assert.ok(!bare.includes('#invoice-line-items-section{break-inside:auto'));
  assert.ok(!bare.includes('.invoice-item-row{break-inside:avoid'));

  const withPaper = renderInvoiceHtml(SAMPLE_INVOICE, { paper: 'letter' });
  assert.ok(withPaper.includes('.invoice-item-row{break-inside:avoid;page-break-inside:avoid;}'));
  assert.ok(withPaper.includes('.invoice-balance{break-inside:avoid;page-break-inside:avoid;}'));
  assert.ok(withPaper.includes('#invoice-line-items-section{break-inside:auto;page-break-inside:auto;}'));

  const editorial = BUILTIN_THEME_PRESETS.find((t) => t.id === 'editorial');
  const withTheme = renderInvoiceHtml(SAMPLE_INVOICE, { theme: editorial });
  assert.ok(withTheme.includes('.invoice-item-row{break-inside:avoid;page-break-inside:avoid;}'));
  assert.ok(withTheme.includes('#invoice-line-items-section{break-inside:auto;page-break-inside:auto;}'));
});
