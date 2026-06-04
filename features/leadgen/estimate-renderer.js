import { createRequire } from 'module';
import { formatCurrency } from './estimate-generator.js';

const require = createRequire(import.meta.url);
const { BRIEF_CSS } = require('../scout-intake/brief-css.cjs');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function list(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return '<li>—</li>';
  return rows.map((item) => `<li>${esc(item)}</li>`).join('');
}

function stat(label, value) {
  return `<div class="stat-row"><div class="k">${esc(label)}</div><div class="v">${value || '—'}</div></div>`;
}

function dateParts(iso) {
  const date = iso ? new Date(iso) : new Date();
  return {
    mark: [
      date.toLocaleString('en-US', { month: 'short', day: 'numeric' }).toUpperCase(),
      String(date.getFullYear()),
      date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' }),
    ].map(esc).join('<br/>'),
    full: date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
  };
}

export function renderEstimateHtml(estimate, options = {}) {
  const generated = dateParts(estimate?.generatedAt);
  const clientId = options.clientId || '';
  const brand = String(estimate?.clientName || 'Estimate').toUpperCase();
  const lineItems = Array.isArray(estimate?.lineItems) ? estimate.lineItems : [];
  const addOns = Array.isArray(estimate?.optionalAddOns) ? estimate.optionalAddOns : [];
  const proof = estimate?.proof || {};
  const currency = estimate?.currency || 'USD';

  const lineItemRows = lineItems.map((item) => `
    <div class="stat-row">
      <div class="k">${esc(item.label)}</div>
      <div class="v">
        <strong>${esc(formatCurrency(item.total, currency))}</strong>
        ${item.description ? `<div style="margin-top:6px;color:var(--ink-soft);font-size:13px;line-height:1.5">${esc(item.description)}</div>` : ''}
        <div class="mono" style="margin-top:7px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft)">
          ${esc(item.quantity)} x ${esc(formatCurrency(item.unitPrice, currency))}
        </div>
      </div>
    </div>
  `).join('');

  const addOnRows = addOns.length
    ? addOns.map((item) => `
      <div class="stat-row">
        <div class="k">${esc(item.label)}</div>
        <div class="v"><strong>${esc(formatCurrency(item.price, currency))}</strong>${item.description ? `<div style="margin-top:6px;color:var(--ink-soft);font-size:13px;line-height:1.5">${esc(item.description)}</div>` : ''}</div>
      </div>
    `).join('')
    : stat('Optional add-ons', '—');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(estimate?.title || 'Estimate')} · ${esc(estimate?.clientName || '')}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@300..700&family=Space+Mono:wght@400;700&display=swap"/>
  <style>${BRIEF_CSS}</style>
  <style>
    .estimate-list { margin:0; padding-left:18px; color:var(--ink); font-family:'Space Grotesk'; font-size:15px; line-height:1.65; }
    .estimate-list li { margin:0 0 8px; }
    .estimate-total { font-family:'Doto'; font-size:clamp(52px,10vw,120px); font-weight:900; letter-spacing:0; line-height:.88; color:var(--ink); }
    .estimate-link { color:var(--ink); text-decoration:underline; text-underline-offset:4px; word-break:break-all; }
  </style>
</head>
<body>
  <section class="page cover" data-pdf-page>
    <div class="sec-num">00</div>
    <div class="eyebrow">
      <span class="dot"></span>
      <span>Estimate · Vol. 01</span>
      ${clientId ? `<span>Client · ${esc(String(clientId).slice(0, 8))}</span>` : ''}
      <span>Generated · ${esc(generated.full)}</span>
    </div>
    <div class="title-stack">
      <h1 class="headline">${generated.mark}</h1>
    </div>
    <p class="sub">${esc(estimate?.summary || 'Website redesign estimate')}</p>
    <div class="meta">
      <div><div class="k">Client</div><div class="v">${esc(estimate?.clientName || '—')}</div></div>
      <div><div class="k">Timeline</div><div class="v">${esc(estimate?.timeline || '—')}</div></div>
      <div><div class="k">Model</div><div class="v">${esc(estimate?.pricingModel || 'line_items')}</div></div>
      <div><div class="k">Total</div><div class="v">${esc(formatCurrency(estimate?.total || 0, currency))}</div></div>
    </div>
    <div class="marquee"><span>${esc(brand)} • ${esc(brand)} • ${esc(brand)} • ${esc(brand)} • ${esc(brand)}</span></div>
  </section>

  <section class="page" data-pdf-page>
    <div class="sec-num">01</div>
    <div class="eyebrow"><span class="dot"></span><span>Estimate · Scope</span><span>Client Facing</span></div>
    <h2 class="headline">What<br/>This<br/>Covers.</h2>
    <div class="brief-grid">
      <div class="card"><ul class="estimate-list">${list(estimate?.scope)}</ul></div>
      <div class="card">
        ${stat('Timeline', esc(estimate?.timeline || '—'))}
        ${stat('Next step', esc(estimate?.nextStep || 'Approve estimate to begin.'))}
        ${estimate?.website ? stat('Current site', `<span style="word-break:break-all">${esc(estimate.website)}</span>`) : ''}
      </div>
    </div>
  </section>

  <section class="page" data-pdf-page>
    <div class="sec-num">02</div>
    <div class="eyebrow"><span class="dot"></span><span>Estimate · Pricing</span><span>${esc(currency)}</span></div>
    <h2 class="headline">Investment.</h2>
    <div class="brief-grid">
      <div>
        <div class="estimate-total">${esc(formatCurrency(estimate?.total || 0, currency))}</div>
        <p class="sub" style="font-size:20px;margin-top:18px">Estimated project total.</p>
      </div>
      <div class="card">
        ${lineItemRows || stat('Line items', '—')}
        ${stat('Subtotal', `<strong>${esc(formatCurrency(estimate?.subtotal || 0, currency))}</strong>`)}
        ${stat('Total', `<strong>${esc(formatCurrency(estimate?.total || 0, currency))}</strong>`)}
      </div>
    </div>
  </section>

  <section class="page" data-pdf-page>
    <div class="sec-num">03</div>
    <div class="eyebrow"><span class="dot"></span><span>Estimate · Proof</span><span>Generated Site</span></div>
    <h2 class="headline">Why<br/>This<br/>Now.</h2>
    <div class="card">
      ${proof.previewUrl ? stat('Preview URL', `<a class="estimate-link" href="${esc(proof.previewUrl)}" target="_blank" rel="noopener noreferrer">${esc(proof.previewUrl)}</a>`) : stat('Preview URL', 'Not generated yet')}
      ${proof.readinessBefore != null && proof.readinessAfter != null ? stat('AI Readiness', `${esc(proof.readinessBefore)} -> ${esc(proof.readinessAfter)}${proof.readinessImprovement != null ? ` (+${esc(proof.readinessImprovement)} points)` : ''}`) : stat('AI Readiness', 'Comparison not available')}
      ${Array.isArray(estimate?.proofPoints) && estimate.proofPoints.length ? stat('Proof points', `<ul class="estimate-list">${list(estimate.proofPoints)}</ul>`) : ''}
    </div>
  </section>

  <section class="page" data-pdf-page>
    <div class="sec-num">04</div>
    <div class="eyebrow"><span class="dot"></span><span>Estimate · Terms</span><span>Approval Details</span></div>
    <h2 class="headline">Terms<br/>And<br/>Timing.</h2>
    <div class="brief-grid">
      <div class="card">
        <div class="k" style="margin-bottom:12px">Payment schedule</div>
        <ul class="estimate-list">${list(estimate?.paymentSchedule)}</ul>
      </div>
      <div class="card">
        ${stat('Terms', `<ul class="estimate-list">${list(estimate?.terms)}</ul>`)}
        ${stat('Exclusions', `<ul class="estimate-list">${list(estimate?.exclusions)}</ul>`)}
      </div>
    </div>
  </section>

  <section class="page" data-pdf-page>
    <div class="sec-num">05</div>
    <div class="eyebrow"><span class="dot"></span><span>Estimate · Add-ons</span><span>Optional</span></div>
    <h2 class="headline">Optional<br/>Adds.</h2>
    <div class="card">${addOnRows}</div>
  </section>

  <footer>
    <span>Generated · ${esc(new Date(estimate?.generatedAt || Date.now()).toISOString().slice(0, 19).replace('T', ' '))}</span>
    ${clientId ? `<span>Client · ${esc(clientId)}</span>` : ''}
    <span>Estimate · ${esc(estimate?.clientName || '')}</span>
  </footer>
</body>
</html>`;
}

export default renderEstimateHtml;
