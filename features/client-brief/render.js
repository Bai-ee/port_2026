// Client Brief renderer (v2) - one continuous document, exactly the blocks the
// parser found, in source order. House fonts + colour variables only (Doto
// headings, Space Grotesk body, Space Mono labels/code, BRIEF_CSS's ink/paper
// variables). No cover page, no hero, no section numbers, no full-page layout;
// just a small header (client + date), the content, and a small footer.
//
// Takes the parser's model only: never raw HTML, so everything is escaped and
// inline markup comes from safe tokens (links re-validated here). Carries NO
// owner contact details, address, phone, tax id or payment info.

import { createRequire } from 'module';
import { safeLinkUrl } from './parse.js';

const require = createRequire(import.meta.url);
const { BRIEF_CSS } = require('../scout-intake/brief-css.cjs');

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
    case 'paragraph': return `<p class="cb-p">${renderInline(block.tokens)}</p>`;
    case 'blockquote':
      return `<blockquote class="cb-quote">${(block.paragraphs || []).map((p) => `<p class="cb-p">${renderInline(p?.tokens)}</p>`).join('')}</blockquote>`;
    case 'list': return renderList(block);
    case 'hr': return '<hr class="cb-hr" />';
    case 'code': return `<pre class="cb-pre"><code>${esc(block.text)}</code></pre>`;
    case 'table': {
      const align = Array.isArray(block.align) ? block.align : [];
      const head = (block.header?.cells || []).map((cell, i) => renderCell('th', cell, align[i])).join('');
      const rows = (block.rows || []).map((row) => `<tr>${(row?.cells || []).map((cell, i) => renderCell('td', cell, align[i])).join('')}</tr>`).join('');
      return `<div class="cb-table-wrap"><table class="cb-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    default: return '';
  }
}

const CLIENT_BRIEF_CSS = `
  body.cb-doc{background:var(--bg);color:var(--ink)}
  .cb-doc .cb-shell{max-width:760px;margin:0 auto;padding:clamp(28px,6vw,64px) 16px clamp(40px,8vw,88px)}
  .cb-doc .cb-label{font-family:"Space Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft)}
  .cb-doc .cb-header{display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between;padding-bottom:16px;margin-bottom:32px;border-bottom:1px solid var(--ink)}
  .cb-doc .cb-content{font-family:"Space Grotesk",system-ui,sans-serif;font-size:17px;line-height:1.65;overflow-wrap:anywhere}
  .cb-doc .cb-content > *:first-child{margin-top:0}
  .cb-doc .cb-h{font-family:"Doto",monospace;font-weight:900;line-height:1.05;letter-spacing:.01em;margin:1.6em 0 .5em;break-after:avoid;page-break-after:avoid}
  .cb-doc .cb-h1{font-size:clamp(34px,7vw,52px);text-transform:uppercase}
  .cb-doc .cb-h2{font-size:clamp(26px,5vw,36px)}
  .cb-doc .cb-h3{font-size:24px}
  .cb-doc .cb-h4{font-size:20px}
  .cb-doc .cb-h5,.cb-doc .cb-h6{font-size:17px}
  .cb-doc .cb-p{margin:0 0 1em}
  .cb-doc .cb-list{margin:0 0 1em;padding-left:1.4em}
  .cb-doc .cb-list .cb-list{margin:.3em 0 0}
  .cb-doc .cb-list li{margin:0 0 .4em}
  .cb-doc .cb-quote{margin:0 0 1em;padding:2px 0 2px 18px;border-left:3px solid var(--ink);color:var(--ink-soft)}
  .cb-doc .cb-quote .cb-p:last-child{margin-bottom:0}
  .cb-doc .cb-hr{border:0;border-top:1px solid var(--ink);margin:2em 0}
  .cb-doc .cb-link{color:var(--ink);text-decoration:underline;text-underline-offset:3px}
  .cb-doc .cb-code,.cb-doc .cb-pre{font-family:"Space Mono",ui-monospace,monospace;font-size:.88em}
  .cb-doc .cb-code{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
  .cb-doc .cb-pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:0 0 1em;overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere}
  .cb-doc .cb-pre code{background:none;border:0;padding:0}
  .cb-doc .cb-table-wrap{margin:0 0 1.2em;overflow-x:auto}
  .cb-doc .cb-table{width:100%;border-collapse:collapse;font-size:15px;line-height:1.45}
  .cb-doc .cb-table th,.cb-doc .cb-table td{border:1px solid var(--ink);padding:8px 10px;text-align:left;vertical-align:top}
  .cb-doc .cb-table th{font-family:"Space Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;background:var(--card)}
  .cb-doc .cb-footer{display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between;margin-top:48px;padding:16px 0 0;border-top:1px solid var(--ink)}
  .cb-doc .cb-pdf-link{color:var(--ink);text-decoration:underline;text-underline-offset:4px}
  @media(max-width:640px){.cb-doc .cb-content{font-size:18px}}
  @page{size:A4;margin:16mm 14mm}
  @media print{
    body.cb-doc{background:var(--bg);-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .cb-doc .cb-shell{max-width:none;padding:0}
    .cb-doc .cb-h{break-after:avoid;page-break-after:avoid}
    .cb-doc .cb-table tr,.cb-doc .cb-list li,.cb-doc .cb-quote,.cb-doc .cb-pre,.cb-doc .cb-p{break-inside:avoid;page-break-inside:avoid}
    .cb-doc .cb-table thead{display:table-header-group}
    .cb-doc .cb-table-wrap{overflow:visible}
    .cb-doc .cb-pdf-link{display:none !important}
  }
`;

export function renderClientBriefHtml(model, options = {}) {
  const safe = model && typeof model === 'object' ? model : {};
  const title = String(safe.title || 'Client Brief').trim() || 'Client Brief';
  const clientName = String(safe.clientName || '').trim();
  const asOf = dateLabel(safe.asOf) || dateLabel(options.generatedAt);
  const blocks = Array.isArray(safe.blocks) ? safe.blocks : [];
  const pdfPath = typeof options.pdfPath === 'string' && /^(\/|https?:\/\/)/i.test(options.pdfPath) ? options.pdfPath : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${esc(title)}${clientName ? ` · ${esc(clientName)}` : ''}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@300..700&family=Space+Mono:wght@400;700&display=swap"/>
  <style>${BRIEF_CSS}</style>
  <style>${CLIENT_BRIEF_CSS}</style>
</head>
<body class="cb-doc" id="client-brief-document">
  <div class="cb-shell" id="client-brief-shell">
    <header class="cb-header" id="client-brief-header">
      <span class="cb-label">${esc(clientName || 'Client Brief')}</span>
      ${asOf ? `<span class="cb-label">${esc(asOf)}</span>` : ''}
    </header>
    <main class="cb-content" id="client-brief-content">${blocks.map(renderBlock).join('\n')}</main>
    <footer class="cb-footer cb-label" id="client-brief-footer">
      <span>${esc(asOf || 'Client Brief')}</span>
      ${pdfPath ? `<a class="cb-pdf-link" id="client-brief-pdf-link" href="${esc(pdfPath)}">Download PDF</a>` : ''}
    </footer>
  </div>
</body>
</html>`;
}

export default renderClientBriefHtml;
