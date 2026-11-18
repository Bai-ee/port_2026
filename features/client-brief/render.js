// Client Brief renderer — fixed template on the existing brief design.
//
// Same <head> + BRIEF_CSS as features/leadgen/estimate-renderer.js, same
// cover / numbered-section / stat-row look. Takes the parser's model only:
// never raw HTML, so everything is escaped and inline markup comes from the
// parser's safe tokens (links re-validated here as defense in depth).
//
// Deliberately carries NO owner contact details, address, phone, tax id or
// payment info — this document is for the client.

import { createRequire } from 'module';
import { safeHttpUrl } from './parse.js';

const require = createRequire(import.meta.url);
const { BRIEF_CSS } = require('../scout-intake/brief-css.cjs');

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// "YYYY-MM-DD" is read as a calendar date (no timezone shift); anything else
// parseable is read in UTC; unparseable text is shown as typed.
function dateParts(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = ymd ? new Date(Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3])) : new Date(raw);
  if (Number.isNaN(date.getTime())) return { mark: esc(raw), full: raw };
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  return {
    mark: `${esc(month)} ${day}<br/>${year}`,
    full: `${month.charAt(0)}${month.slice(1).toLowerCase()} ${day}, ${year}`,
  };
}

export function renderInline(tokens) {
  return (Array.isArray(tokens) ? tokens : []).map((token) => {
    if (!token || typeof token !== 'object') return '';
    const value = esc(token.v);
    switch (token.t) {
      case 'b': return `<strong>${value}</strong>`;
      case 'em': return `<em>${value}</em>`;
      case 'code': return `<code class="mono cb-code">${value}</code>`;
      case 'link': {
        const href = safeHttpUrl(token.href);
        return href
          ? `<a class="cb-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${value}</a>`
          : value;
      }
      default: return value;
    }
  }).join('');
}

function renderBlock(block) {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'stats') {
    const rows = (Array.isArray(block.rows) ? block.rows : []).map((row) =>
      `<div class="stat-row"><div class="k">${esc(row.label)}</div><div class="v">${renderInline(row.value) || '&mdash;'}</div></div>`
    ).join('');
    return rows ? `<div class="card cb-block cb-stats">${rows}</div>` : '';
  }
  if (block.type === 'list') {
    const items = (Array.isArray(block.items) ? block.items : []).map((item) => `<li>${renderInline(item?.tokens)}</li>`).join('');
    const tag = block.ordered ? 'ol' : 'ul';
    return items ? `<div class="card cb-block"><${tag} class="cb-list">${items}</${tag}></div>` : '';
  }
  if (block.type === 'para') {
    const text = renderInline(block.text);
    return text ? `<p class="cb-para cb-block">${text}</p>` : '';
  }
  return '';
}

const CLIENT_BRIEF_CSS = `
  .cb-doc .cb-cover-title{font-size:clamp(40px,8vw,120px);overflow-wrap:anywhere}
  .cb-doc .cb-date-mark{font-family:"Doto",monospace;font-weight:900;font-size:clamp(28px,4vw,56px);line-height:.95;text-transform:uppercase;margin:0 0 24px;color:var(--ink-soft)}
  .cb-doc .cb-heading{font-size:clamp(34px,5.6vw,80px);overflow-wrap:anywhere;margin-bottom:32px}
  .cb-doc .cb-intro{max-width:70ch;margin:8px 0 0}
  .cb-doc .cb-body{display:flex;flex-direction:column;gap:18px;max-width:880px}
  .cb-doc .cb-para{font-family:"Space Grotesk";font-size:17px;line-height:1.65;margin:0;overflow-wrap:anywhere}
  .cb-doc .cb-list{margin:0;padding-left:20px;font-family:"Space Grotesk";font-size:16px;line-height:1.65}
  .cb-doc .cb-list li{margin:0 0 8px;overflow-wrap:anywhere}
  .cb-doc .cb-list li:last-child{margin-bottom:0}
  .cb-doc .cb-stats .stat-row{grid-template-columns:minmax(120px,210px) 1fr}
  .cb-doc .stat-row .v{overflow-wrap:anywhere}
  .cb-doc .cb-link{color:var(--ink);text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}
  .cb-doc .cb-code{font-size:.9em;background:rgba(0,0,0,.06);border-radius:4px;padding:1px 5px}
  .cb-doc footer.cb-footer{padding:40px 0 0;margin-top:48px}
  .cb-doc .cb-pdf-link{color:var(--ink);text-decoration:underline;text-underline-offset:4px}
  @media(max-width:640px){
    .cb-doc .cb-para{font-size:18px}
    .cb-doc .cb-list{font-size:17px}
    .cb-doc .cb-stats .stat-row{grid-template-columns:1fr}
  }
  /* PDF (edge-to-edge) prints each section as a fixed page and clips overflow;
     let long sections flow onto extra pages instead, never splitting a block. */
  @media print{
    .cb-doc section.page.cb-page{overflow:visible !important;height:auto !important}
    .cb-doc .cb-block{break-inside:avoid;page-break-inside:avoid}
    .cb-doc .stat-row,.cb-doc .cb-list li{break-inside:avoid;page-break-inside:avoid}
    .cb-doc .cb-pdf-link{display:none !important}
  }
`;

export function renderClientBriefHtml(model, options = {}) {
  const safe = model && typeof model === 'object' ? model : {};
  const title = String(safe.title || 'Client Brief').trim() || 'Client Brief';
  const clientName = String(safe.clientName || '').trim();
  const clientUpper = (clientName || 'Client Brief').toUpperCase();
  const asOf = dateParts(safe.asOf) || dateParts(options.generatedAt);
  const intro = Array.isArray(safe.intro) ? safe.intro : [];
  const sections = Array.isArray(safe.sections) ? safe.sections : [];
  const pdfPath = typeof options.pdfPath === 'string' && /^(\/|https?:\/\/)/i.test(options.pdfPath) ? options.pdfPath : '';

  const footerHtml = `
    <footer class="cb-footer" id="client-brief-footer">
      <span>${asOf ? `As of &middot; ${esc(asOf.full)}` : 'Client Brief'}</span>
      <span>${esc(title)}${clientName ? ` &middot; ${esc(clientName)}` : ''}</span>
      ${pdfPath ? `<a class="cb-pdf-link" id="client-brief-pdf-link" href="${esc(pdfPath)}">Download PDF</a>` : ''}
    </footer>`;

  const pages = [];

  pages.push(`
  <section class="page cover cb-page" id="client-brief-cover" data-pdf-page>
    <div class="sec-num">00</div>
    <div class="eyebrow">
      <span class="dot"></span>
      <span>Client Brief</span>
      ${asOf ? `<span>As of &middot; ${esc(asOf.full)}</span>` : ''}
    </div>
    ${asOf ? `<div class="cb-date-mark">${asOf.mark}</div>` : ''}
    <div class="title-stack">
      <h1 class="headline cb-cover-title">${esc(title)}</h1>
    </div>
    ${clientName ? `<p class="sub">${esc(clientName)}</p>` : ''}
    ${intro.map((paragraph) => `<p class="cb-para cb-intro">${renderInline(paragraph?.tokens)}</p>`).join('')}
    <div class="meta">
      <div><div class="k">Client</div><div class="v">${esc(clientName || '—')}</div></div>
      <div><div class="k">Document</div><div class="v">${esc(title)}</div></div>
      <div><div class="k">As of</div><div class="v">${esc(asOf ? asOf.full : '—')}</div></div>
      <div><div class="k">Sections</div><div class="v">${sections.length}</div></div>
    </div>
    <div class="marquee"><span>${esc(clientUpper)} &bull; ${esc(clientUpper)} &bull; ${esc(clientUpper)} &bull; ${esc(clientUpper)}</span></div>
  </section>`);

  sections.forEach((section, index) => {
    const number = String(index + 1).padStart(2, '0');
    const heading = String(section?.heading || '').trim();
    const blocks = (Array.isArray(section?.blocks) ? section.blocks : []).map(renderBlock).join('');
    pages.push(`
  <section class="page cb-page" id="client-brief-section-${number}" data-pdf-page>
    <div class="sec-num">${number}</div>
    <div class="eyebrow"><span class="dot"></span><span>${esc(title)}</span><span>Section ${number}</span></div>
    ${heading ? `<h2 class="headline cb-heading">${esc(heading)}</h2>` : ''}
    <div class="cb-body">${blocks}</div>
  </section>`);
  });

  // Footer lives inside the last page so a full last page never spawns a
  // trailing blank PDF page.
  const last = pages.length - 1;
  pages[last] = pages[last].replace(/<\/section>\s*$/, `${footerHtml}\n  </section>`);

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
<body class="cb-doc" id="client-brief-document">${pages.join('')}
</body>
</html>`;
}

export default renderClientBriefHtml;
