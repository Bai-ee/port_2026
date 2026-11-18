// Client Brief renderer (v3) - the INVOICE document look (invoice cover/hero,
// meta strip, theme CSS, footer) with the pasted Markdown laid out as sections:
// each `##` heading opens a section with the brief section-header design
// (eyebrow "SECTION 0N", outlined number, Doto title). Blocks stay exactly as
// parsed, in source order. Sections flow; nothing forces a page break.
//
// ONE renderer: the Studio canvas and the server publish route both call
// renderClientBriefDocument(), so preview and published output cannot drift.
// Client-safe: ESM imports only (no createRequire, no crypto).
//
// Takes the parser's model only: never raw HTML, so everything is escaped and
// inline markup comes from safe tokens (links re-validated here). Carries NO
// owner contact details, address, phone, tax id or payment info. The HITLOOP
// brand mark is only drawn when the caller passes `options.brand`.

import { safeLinkUrl, inlineToPlain } from './parse.js';
import { BRIEF_CSS } from '../invoices/brief-css.js';
import { INVOICE_CSS } from '../invoices/render.js';
import { normalizeTheme, themeToCss, themeFontsHref } from '../../app/dashboard/studio/invoice/themes/theme-schema.js';
import { GOOGLE_FONT_CATALOG } from '../../app/dashboard/studio/text-layers.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// "YYYY-MM-DD" is read as a calendar date (no timezone shift); other text is
// shown as typed when unparseable.
function dateLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = ymd ? new Date(Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3])) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function renderInline(tokens) {
  return (Array.isArray(tokens) ? tokens : []).map((token) => {
    if (!token || typeof token !== 'object') return '';
    const children = () => renderInline(token.c);
    switch (token.t) {
      case 'br': return '<br />';
      case 'b': return `<strong>${children()}</strong>`;
      case 'em': return `<em>${children()}</em>`;
      case 'bem': return `<strong><em>${children()}</em></strong>`;
      case 'code': return `<code class="cb-code">${esc(token.v)}</code>`;
      case 'link': {
        const href = safeLinkUrl(token.href);
        return href
          ? `<a class="cb-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${children()}</a>`
          : children();
      }
      default: return esc(token.v);
    }
  }).join('');
}

const SHORT_PARAGRAPH_CHARS = 320;
const SHORT_CODE_LINES = 14;
const ALIGNS = new Set(['left', 'right', 'center']);

function renderList(list) {
  const tag = list.ordered ? 'ol' : 'ul';
  const start = list.ordered && Number.isInteger(list.start) && list.start !== 1 ? ` start="${list.start}"` : '';
  const items = (Array.isArray(list.items) ? list.items : []).map((item) =>
    `<li>${renderInline(item?.tokens)}${item?.sub ? renderList(item.sub) : ''}</li>`
  ).join('');
  return `<${tag} class="cb-list"${start}>${items}</${tag}>`;
}

function renderCell(tag, cell, align) {
  const a = ALIGNS.has(align) ? ` style="text-align:${align}"` : '';
  return `<${tag}${a}>${renderInline(cell?.tokens)}</${tag}>`;
}

export function renderBlock(block) {
  if (!block || typeof block !== 'object') return '';
  switch (block.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(block.level) || 1));
      return `<h${level} class="cb-h cb-h${level}">${renderInline(block.tokens)}</h${level}>`;
    }
    case 'paragraph': {
      // Short paragraphs never split across a page in print (cb-p-short).
      const short = inlineToPlain(block.tokens).length <= SHORT_PARAGRAPH_CHARS ? ' cb-p-short' : '';
      return `<p class="cb-p${short}">${renderInline(block.tokens)}</p>`;
    }
    case 'blockquote':
      return `<blockquote class="cb-quote">${(block.paragraphs || []).map((p) => `<p class="cb-p">${renderInline(p?.tokens)}</p>`).join('')}</blockquote>`;
    case 'list': return renderList(block);
    case 'hr': return '<hr class="cb-hr" />';
    case 'code': return `<pre class="cb-pre${String(block.text || '').split('\n').length <= SHORT_CODE_LINES ? ' cb-pre-short' : ''}"><code>${esc(block.text)}</code></pre>`;
    case 'table': {
      const align = Array.isArray(block.align) ? block.align : [];
      const head = (block.header?.cells || []).map((cell, i) => renderCell('th', cell, align[i])).join('');
      const rows = (block.rows || []).map((row) => `<tr>${(row?.cells || []).map((cell, i) => renderCell('td', cell, align[i])).join('')}</tr>`).join('');
      return `<div class="cb-table-wrap"><table class="cb-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    default: return '';
  }
}


// ── Theme fonts ─────────────────────────────────────────────────────────
// themeToCss() retargets the invoice-* selectors only; the brief's own
// classes get their theme faces here (same catalog lookup theme-schema uses).
function fontStack(catalogId) {
  const entry = GOOGLE_FONT_CATALOG.find((f) => f.id === catalogId);
  return entry ? `'${entry.family}', ${entry.fallback}` : 'inherit';
}

function themeFontCss(theme) {
  if (!theme) return '';
  const id = theme.id;
  const sel = (inner) => `html[data-invoice-theme="${id}"] ${inner}`;
  const display = fontStack(theme.fonts?.display);
  const body = fontStack(theme.fonts?.body);
  const mono = fontStack(theme.fonts?.mono);
  return [
    `${sel('.cb-section-title')}, ${sel('.cb-sec-num')}, ${sel('.cb-h1')} { font-family:${display}; }`,
    `${sel('.cb-eyebrow')}, ${sel('.cb-table th')}, ${sel('.cb-h4')}, ${sel('.cb-h5')}, ${sel('.cb-h6')}, ${sel('.cb-code')}, ${sel('.cb-pre')}, ${sel('.cb-footer')} { font-family:${mono}; }`,
    `${sel('.cb-content')}, ${sel('.cb-h3')}, ${sel('.cb-table td')} { font-family:${body}; }`,
  ].join('\n');
}

// A dark theme (Studio Dark) cannot print edge to edge: the server PDF uses
// fixed page margins that Chromium paints white, so a dark ground would show
// as a box inside a white frame. Dark themes therefore print as dark ink on
// white (screen and canvas keep the theme's dark look).
function isDarkPaper(hex) {
  const m = String(hex || '').match(/^#([0-9a-f]{6})$/i);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum < 0.4;
}

function darkThemePrintCss(theme) {
  if (!theme || !isDarkPaper(theme.colors?.paper)) return '';
  const id = theme.id;
  const root = `html[data-invoice-theme="${id}"], html[data-invoice-theme="${id}"] body[data-invoice-theme="${id}"]`;
  return `@media print{
  ${root}{--bg:#fff;--card:#fff;--ink:#111;--ink-soft:#4a463e;--line:rgba(0,0,0,.18);background:#fff !important;background-image:none !important;color:#111 !important}
  html[data-invoice-theme="${id}"] .invoice-hero-sub,html[data-invoice-theme="${id}"] .cb-footer{color:#4a463e !important}
  html[data-invoice-theme="${id}"] .invoice-hero{border-color:rgba(0,0,0,.18) !important}
  html[data-invoice-theme="${id}"] .cb-doc .cb-sec-num{-webkit-text-stroke-color:rgba(0,0,0,.18)}
}`;
}

// ── CSS ─────────────────────────────────────────────────────────────────
// Layered on INVOICE_CSS (cover/hero, meta strip, link + PDF-button styles).
// Never wraps a whole section in .invoice-block / section.page: both force a
// page jump in print (INVOICE_CSS `.invoice-block{break-inside:avoid}`,
// BRIEF_CSS `section.page{page-break-after:always}`), so sections use their own
// cb-* classes and only small units (rows, items, quotes, short paragraphs)
// refuse to split.
export const CLIENT_BRIEF_CSS = `
  .cb-doc .cb-sheet{max-width:860px;margin:0 auto;padding:clamp(22px,4vw,44px) clamp(16px,4vw,40px) clamp(28px,5vw,52px)}
  .cb-doc .cb-cover{padding-bottom:16px;margin-bottom:20px}
  .cb-doc .cb-cover-eyebrow{margin:0 0 8px}
  .cb-doc .cb-cover .invoice-hero-title{font-size:clamp(28px,5.4vw,52px);overflow-wrap:anywhere}
  .cb-doc .cb-eyebrow{display:flex;align-items:center;gap:10px;margin:0 0 6px;font-family:"Space Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft)}
  .cb-doc .cb-eyebrow .cb-dot{width:6px;height:6px;border-radius:50%;background:var(--ink);flex:0 0 auto}
  .cb-doc .cb-content{font-family:"Space Grotesk",system-ui,sans-serif;font-size:14.5px;line-height:1.6;color:var(--ink);overflow-wrap:anywhere}
  .cb-doc .cb-intro{margin:0 0 22px}
  .cb-doc .cb-section{margin:0 0 26px}
  .cb-doc .cb-section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin:0 0 14px;padding:0 0 10px;border-bottom:1px solid var(--line);break-after:avoid;page-break-after:avoid}
  .cb-doc .cb-section-heading{min-width:0}
  .cb-doc .cb-section-title{font-family:"Doto",monospace;font-weight:900;font-size:clamp(22px,4.2vw,34px);line-height:1;letter-spacing:0;text-transform:uppercase;margin:0;color:var(--ink)}
  .cb-doc .cb-sec-num{font-family:"Doto",monospace;font-weight:900;font-size:clamp(40px,7vw,64px);line-height:.8;color:transparent;-webkit-text-stroke:1.5px var(--line);user-select:none;flex:0 0 auto}
  .cb-doc .cb-h{font-weight:700;line-height:1.2;margin:1.3em 0 .45em;break-after:avoid;page-break-after:avoid}
  .cb-doc .cb-content > :first-child,.cb-doc .cb-section-body > :first-child{margin-top:0}
  .cb-doc .cb-h1{font-family:"Doto",monospace;font-weight:900;font-size:clamp(26px,5vw,38px);text-transform:uppercase}
  .cb-doc .cb-h2{font-family:"Doto",monospace;font-weight:900;font-size:clamp(20px,3.6vw,28px);text-transform:uppercase}
  .cb-doc .cb-h3{font-family:"Space Grotesk",sans-serif;font-size:17px}
  .cb-doc .cb-h4,.cb-doc .cb-h5,.cb-doc .cb-h6{font-family:"Space Mono",ui-monospace,monospace;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft)}
  .cb-doc .cb-p{margin:0 0 .85em;orphans:3;widows:3}
  .cb-doc .cb-list{margin:0 0 .9em;padding-left:18px;font-family:"Space Grotesk",sans-serif;font-size:inherit;line-height:1.55}
  .cb-doc .cb-list .cb-list{margin:.3em 0 0}
  .cb-doc .cb-list li{margin:0 0 .35em;orphans:3;widows:3}
  .cb-doc .cb-quote{margin:0 0 .9em;padding:2px 0 2px 16px;border-left:2px solid var(--ink);color:var(--ink-soft)}
  .cb-doc .cb-quote .cb-p:last-child{margin-bottom:0}
  .cb-doc .cb-hr{border:0;border-top:1px solid var(--line);margin:1.4em 0}
  .cb-doc .cb-link{color:var(--ink);text-decoration:underline;text-underline-offset:3px;word-break:normal;overflow-wrap:anywhere}
  .cb-doc .cb-code,.cb-doc .cb-pre{font-family:"Space Mono",ui-monospace,monospace;font-size:.88em}
  .cb-doc .cb-code{border:1px solid var(--line);border-radius:4px;padding:0 4px}
  .cb-doc .cb-pre{border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin:0 0 .9em;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45}
  .cb-doc .cb-pre code{border:0;padding:0}
  .cb-doc .cb-table-wrap{margin:0 0 1em;overflow-x:auto}
  .cb-doc .cb-table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.4}
  .cb-doc .cb-table th{font-family:"Space Mono",ui-monospace,monospace;font-size:10px;font-weight:400;letter-spacing:.18em;text-transform:uppercase;text-align:left;vertical-align:bottom;padding:6px 12px 6px 0;border-bottom:1px solid var(--ink)}
  .cb-doc .cb-table td{font-family:"Space Grotesk",sans-serif;text-align:left;vertical-align:top;padding:8px 12px 8px 0;border-bottom:1px solid var(--line)}
  .cb-doc .cb-table tr:last-child td{border-bottom:none}
  .cb-doc .cb-table th:last-child,.cb-doc .cb-table td:last-child{padding-right:0}
  .cb-doc .cb-footer{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-top:8px;padding:14px 0 0;border-top:1px solid var(--line);font-family:"Space Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft)}
  @media(max-width:560px){.cb-doc .cb-content{font-size:16px}.cb-doc .cb-sec-num{font-size:40px}}
  @page{size:A4;margin:16mm 14mm}
  @media print{
    html,body{background:var(--bg) !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}
    .cb-doc .cb-sheet{max-width:none;margin:0;padding:0}
    .cb-doc .cb-cover{padding-bottom:7pt;margin-bottom:10pt}
    .cb-doc .cb-cover-eyebrow{font-size:7.5pt;margin:0 0 3pt}
    .cb-doc .cb-cover .invoice-hero-title{font-size:21pt;line-height:1}
    .cb-doc .cb-cover .invoice-hero-mark{margin:0}
    .cb-doc .cb-cover .invoice-hero-mark > img{max-height:34px;max-width:90px}
    .cb-doc .cb-cover .meta{margin-top:7pt;padding-top:7pt;gap:4pt 22pt}
    .cb-doc .cb-cover .meta .k{font-size:6.5pt;margin-bottom:2pt}
    .cb-doc .cb-cover .meta .v{font-size:9pt}
    .cb-doc .cb-content{font-size:10pt;line-height:1.42}
    .cb-doc .cb-intro{margin-bottom:11pt}
    .cb-doc .cb-section{margin-bottom:12pt}
    .cb-doc .cb-section-head{margin-bottom:7pt;padding-bottom:5pt}
    .cb-doc .cb-eyebrow{font-size:7pt;margin-bottom:3pt}
    .cb-doc .cb-section-title{font-size:15pt}
    .cb-doc .cb-sec-num{font-size:26pt}
    .cb-doc .cb-h{margin:9pt 0 3pt}
    .cb-doc .cb-h1{font-size:17pt}
    .cb-doc .cb-h2{font-size:14pt}
    .cb-doc .cb-h3{font-size:11pt}
    .cb-doc .cb-h4,.cb-doc .cb-h5,.cb-doc .cb-h6{font-size:7.5pt}
    .cb-doc .cb-p{margin-bottom:5pt}
    .cb-doc .cb-list{margin-bottom:6pt}
    .cb-doc .cb-list li{margin-bottom:2pt}
    .cb-doc .cb-hr{margin:8pt 0}
    .cb-doc .cb-table{font-size:8.8pt;line-height:1.3}
    .cb-doc .cb-table th{font-size:6.8pt;padding:3pt 8pt 3pt 0}
    .cb-doc .cb-table td{padding:3.5pt 8pt 3.5pt 0}
    .cb-doc .cb-table-wrap{overflow:visible;margin-bottom:7pt}
    .cb-doc .cb-pre{font-size:8.5pt;padding:6pt 8pt;margin-bottom:6pt}
    .cb-doc .cb-footer{font-size:6.5pt;margin-top:6pt;padding:7pt 0 0}
    .cb-doc .cb-h,.cb-doc .cb-section-head{break-after:avoid;page-break-after:avoid}
    .cb-doc .cb-table tr,.cb-doc .cb-list li,.cb-doc .cb-quote,.cb-doc .cb-p-short,.cb-doc .cb-pre-short,.cb-doc .cb-footer{break-inside:avoid;page-break-inside:avoid}
    .cb-doc .cb-table thead{display:table-header-group}
    .invoice-pdf-link{display:none !important}
  }
`;

function sectionNumber(index) {
  return String(index + 1).padStart(2, '0');
}

// Splits the parsed blocks into the intro (before the first `##`) and sections.
// A leading `#` equal to the document title is the title itself (not repeated);
// any other `#` stays in the flow as a heading.
function splitSections(blocks, title) {
  const intro = [];
  const sections = [];
  let current = null;
  const titleKey = String(title || '').replace(/\s+/g, ' ').trim().toLowerCase();
  blocks.forEach((block, index) => {
    if (!block || typeof block !== 'object') return;
    if (index === 0 && block.type === 'heading' && Number(block.level) === 1
      && inlineToPlain(block.tokens).replace(/\s+/g, ' ').trim().toLowerCase() === titleKey) return;
    if (block.type === 'heading' && Number(block.level) === 2) {
      current = { heading: block, blocks: [] };
      sections.push(current);
      return;
    }
    (current ? current.blocks : intro).push(block);
  });
  return { intro, sections };
}

function renderSection(section, index) {
  const num = sectionNumber(index);
  const id = `client-brief-section-${index + 1}`;
  return `<section class="cb-section" id="${id}" data-section="${id}">
  <header class="cb-section-head" id="${id}-header">
    <div class="cb-section-heading">
      <div class="cb-eyebrow"><span class="cb-dot"></span><span>Section ${num}</span></div>
      <h2 class="cb-section-title">${renderInline(section.heading.tokens)}</h2>
    </div>
    <span class="cb-sec-num" aria-hidden="true">${num}</span>
  </header>
  <div class="cb-section-body" id="${id}-body">${section.blocks.map(renderBlock).join('\n')}</div>
</section>`;
}

// options: { pdfPath, generatedAt, theme (built-in theme object or {id}),
//            brand ({ logo:{dataUri,width,height}, wordmark } | null) }
// Returns { html, sectionCount }.
export function renderClientBriefDocument(model, options = {}) {
  const safe = model && typeof model === 'object' ? model : {};
  const title = String(safe.title || 'Client Brief').trim() || 'Client Brief';
  const clientName = String(safe.clientName || '').trim();
  const asOf = dateLabel(safe.asOf) || dateLabel(options.generatedAt);
  const blocks = Array.isArray(safe.blocks) ? safe.blocks : [];
  const pdfPath = typeof options.pdfPath === 'string' && /^(\/|https?:\/\/)/i.test(options.pdfPath) ? options.pdfPath : '';
  const theme = normalizeTheme(options.theme);
  const themeAttr = theme ? ` data-invoice-theme="${esc(theme.id)}"` : '';
  const logo = options.brand?.logo;
  const mark = logo && typeof logo.dataUri === 'string' && /^data:image\/(png|jpe?g|webp|svg\+xml);base64,/i.test(logo.dataUri)
    ? `<img id="client-brief-brand-logo" src="${esc(logo.dataUri)}" alt="${esc(options.brand?.wordmark || '')}" width="${Number(logo.width) || ''}" height="${Number(logo.height) || ''}" />`
    : '';
  const { intro, sections } = splitSections(blocks, title);

  // Theme CSS comes before the brief's own @page so A4 wins: the server PDF
  // (Browserless 'default' mode) is always A4, whatever the theme's paper.
  const themeCss = theme
    ? `<style>${themeToCss(theme)}\nhtml[data-invoice-theme="${theme.id}"], body[data-invoice-theme="${theme.id}"] { -webkit-print-color-adjust:exact; print-color-adjust:exact; color-adjust:exact; }\n${themeFontCss(theme)}\n${darkThemePrintCss(theme)}</style>`
    : '';
  const themeFontHref = theme ? themeFontsHref(theme) : '';

  const html = `<!doctype html>
<html lang="en"${themeAttr}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${esc(title)}${clientName ? ` · ${esc(clientName)}` : ''}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@300..700&family=Space+Mono:wght@400;700&display=swap"/>${themeFontHref ? `\n  <link rel="stylesheet" href="${esc(themeFontHref)}"/>` : ''}
  <style>${BRIEF_CSS}</style>
  <style>${INVOICE_CSS}</style>
  ${themeCss}
  <style>${CLIENT_BRIEF_CSS}</style>
</head>
<body class="cb-doc" id="client-brief-document"${themeAttr}>
  ${pdfPath ? `<a id="client-brief-pdf-link" class="invoice-pdf-link" href="${esc(pdfPath)}" target="_blank" rel="noopener noreferrer">Download PDF</a>` : ''}
  <main class="invoice-sheet cb-sheet" id="client-brief-sheet">
    <header class="invoice-hero cb-cover" id="client-brief-cover">
      <div class="invoice-hero-mark">
        <div class="invoice-hero-text">
          <p class="invoice-hero-sub cb-cover-eyebrow" id="client-brief-doc-label">Client Brief</p>
          <h1 class="invoice-hero-title" id="client-brief-title">${esc(title)}</h1>
        </div>
        ${mark}
      </div>
      <div class="meta" id="client-brief-meta">
        <div><div class="k">Client</div><div class="v">${esc(clientName || '—')}</div></div>
        <div><div class="k">Date</div><div class="v">${esc(asOf || '—')}</div></div>
        <div><div class="k">Prepared by</div><div class="v">HITLOOP</div></div>
      </div>
    </header>
    <div class="cb-content" id="client-brief-content">
      ${intro.length ? `<section class="cb-intro" id="client-brief-intro">${intro.map(renderBlock).join('\n')}</section>` : ''}
      ${sections.map(renderSection).join('\n')}
    </div>
    <footer class="cb-footer" id="client-brief-footer">
      <span>${esc(clientName ? `Client brief for ${clientName}` : 'Client brief')}</span>
      <span>${esc(asOf || '')}</span>
    </footer>
  </main>
</body>
</html>`;
  return { html, sectionCount: sections.length };
}
