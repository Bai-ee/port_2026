// mini-brief-renderer.js — Client-safe HTML generator for Design Evaluation
// and SEO Performance mini-brief panes. Zero Node dependencies; safe to
// import directly in the client bundle.
//
// Exports:
//   MINI_BRIEF_CSS          — named CSS constant (Brief design system + mini additions)
//   renderMiniBriefHtml()   — builds a complete <!doctype html> document

// ── CSS ──────────────────────────────────────────────────────────────────────
// CSS variables, typography, and component classes are lifted from
// brief-renderer.js and extended with mini-brief-specific section styles.
// This is the single source of truth for the mini-brief design system.

export const MINI_BRIEF_CSS = `
  :root{
    --bg:#f6f3ea;
    --bg2:#efe9d6;
    --ink:#0a0a0a;
    --ink-soft:#5a5346;
    --line:rgba(212,196,171,0.82);
    --card:rgba(255,255,255,0.5);
    --hl:rgba(255,255,255,0.65);
    --brand:#116dff;
    --grad:linear-gradient(92deg,#7a5cff 0%,#b14bff 38%,#ff4fa1 72%,#ff7a3a 100%);
    --gutter:clamp(20px,6vw,72px);
    --sev-high-bg:rgba(220,38,38,0.06);   --sev-high-border:rgba(220,38,38,0.35); --sev-high-ink:#dc2626;
    --sev-med-bg:rgba(217,119,6,0.06);    --sev-med-border:rgba(217,119,6,0.35);  --sev-med-ink:#d97706;
    --sev-low-bg:rgba(37,99,235,0.06);    --sev-low-border:rgba(37,99,235,0.28);  --sev-low-ink:#2563eb;
    --sev-info-bg:rgba(0,0,0,0.03);       --sev-info-border:rgba(0,0,0,0.12);     --sev-info-ink:#5a5346;
    --vd-ready-bg:rgba(22,101,52,0.06);   --vd-ready-border:rgba(22,101,52,0.30);   --vd-ready-ink:#166534;
    --vd-partial-bg:rgba(217,119,6,0.06); --vd-partial-border:rgba(217,119,6,0.35); --vd-partial-ink:#d97706;
    --vd-blocked-bg:rgba(220,38,38,0.06); --vd-blocked-border:rgba(220,38,38,0.35); --vd-blocked-ink:#dc2626;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{
    font-family:"Space Grotesk",system-ui,sans-serif;
    color:var(--ink);
    background:
      radial-gradient(700px 420px at 0% 4%,    rgba(255,120,90,0.28) 0%,transparent 65%),
      radial-gradient(620px 380px at 100% 18%,  rgba(176,90,255,0.22) 0%,transparent 65%),
      radial-gradient(700px 420px at 0% 44%,    rgba(255,90,160,0.22) 0%,transparent 65%),
      radial-gradient(600px 380px at 100% 72%,  rgba(90,140,255,0.20) 0%,transparent 65%),
      linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%);
    -webkit-font-smoothing:antialiased;
  }
  .mono{font-family:"Space Mono",ui-monospace,monospace}
  .doto{font-family:"Doto",monospace;letter-spacing:.02em}

  /* ── Shell ── */
  .mb-shell{
    max-width:1100px; margin:0 auto;
    padding:clamp(32px,5vw,60px) var(--gutter) clamp(48px,6vw,80px);
  }

  /* ── Document header ── */
  .mb-header{
    padding-bottom:clamp(24px,3vw,40px);
    border-bottom:1.5px solid rgba(0,0,0,0.10);
    margin-bottom:clamp(28px,4vw,48px);
  }
  .mb-eyebrow{
    font-family:"Space Mono",monospace; font-size:10px;
    letter-spacing:.24em; text-transform:uppercase; color:var(--ink-soft);
    display:flex; gap:14px; align-items:center; margin-bottom:14px; flex-wrap:wrap;
  }
  .mb-eyebrow .dot{width:5px;height:5px;background:var(--ink);border-radius:50%;flex-shrink:0}
  .mb-title{
    font-family:"Doto",monospace; font-weight:900;
    font-size:clamp(38px,6.5vw,88px); line-height:.92;
    letter-spacing:-.01em; text-transform:uppercase;
    margin:0 0 12px;
  }
  .mb-subtitle{
    font-family:"Space Grotesk",sans-serif; font-weight:300;
    font-size:clamp(15px,1.7vw,20px); line-height:1.35;
    color:#2a2a2a; max-width:60ch; margin:0;
  }

  /* ── Section block ── */
  .mb-section{
    padding:clamp(20px,2.8vw,36px) 0;
    border-bottom:1px solid rgba(0,0,0,0.06);
  }
  .mb-section:last-child{border-bottom:none; padding-bottom:0}
  .mb-section-eyebrow{
    font-family:"Space Mono",monospace; font-size:9px;
    letter-spacing:.26em; text-transform:uppercase; color:var(--ink-soft);
    margin-bottom:8px;
  }
  .mb-section-title{
    font-family:"Space Grotesk",sans-serif; font-weight:600;
    font-size:clamp(13px,1.5vw,17px); color:var(--ink);
    margin:0 0 14px;
  }

  /* ── Reused from Brief ── */
  .card{
    background:var(--card); border:1px solid var(--line); border-radius:16px;
    box-shadow:0 1px 0 var(--hl),inset 0 1px 0 rgba(255,255,255,0.4);
    padding:clamp(14px,1.8vw,22px);
  }
  .stat-row{display:grid;grid-template-columns:120px 1fr;gap:12px;padding:10px 0;border-bottom:1px dashed rgba(0,0,0,.12)}
  .stat-row:last-child{border-bottom:0}
  .stat-row .k{font-family:"Space Mono",monospace;font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft);padding-top:3px}
  .stat-row .v{font-family:"Space Grotesk";font-size:14px;line-height:1.45}
  .scores{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  @media(max-width:680px){.scores{grid-template-columns:repeat(2,1fr)}}
  .score{
    aspect-ratio:1/1; border-radius:16px; border:1px solid var(--line);
    background:rgba(255,255,255,.5);
    display:flex; flex-direction:column; justify-content:space-between; padding:14px;
  }
  .score .lbl{font-family:"Space Mono";font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft)}
  .score .num{font-family:"Doto";font-weight:900;font-size:clamp(32px,5vw,64px);line-height:.9}
  .score.ok   .num{color:#166534}
  .score.warn .num{color:#d97706}
  .score.bad  .num{color:#c2410c}
  .bar-row{display:flex;align-items:center;gap:10px;margin:7px 0;font-family:"Space Mono";font-size:11px}
  .bar-row .name{width:130px;text-transform:uppercase;letter-spacing:.16em;font-size:9px;color:var(--ink-soft);flex-shrink:0}
  .bar-row .val{font-size:10px;color:var(--ink-soft);width:48px;text-align:right;flex-shrink:0}
  .bar{flex:1;height:8px;background:rgba(0,0,0,.06);border-radius:999px;overflow:hidden}
  .bar > i{display:block;height:100%;background:var(--grad);border-radius:999px}
  .meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  @media(max-width:600px){.meta-grid{grid-template-columns:1fr 1fr}}
  .meta-tile{background:rgba(255,255,255,.55);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .meta-tile .k{font-family:"Space Mono";font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:4px}
  .meta-tile .v{font-family:"Space Grotesk";font-size:14px;word-break:break-word;font-weight:500}
  .pull{
    font-family:"Space Grotesk"; font-weight:300;
    font-size:clamp(18px,2.2vw,26px); line-height:1.2;
    border-left:3px solid var(--ink); padding:6px 0 6px 18px; max-width:38ch;
  }

  /* ── Finding list ── */
  .finding-list{display:flex;flex-direction:column;gap:7px}
  .finding-item{
    display:flex; gap:10px; align-items:flex-start;
    padding:9px 13px; border-radius:10px; border:1px solid;
  }
  .finding-item.sev-high  {background:var(--sev-high-bg);border-color:var(--sev-high-border)}
  .finding-item.sev-medium{background:var(--sev-med-bg); border-color:var(--sev-med-border)}
  .finding-item.sev-low   {background:var(--sev-low-bg); border-color:var(--sev-low-border)}
  .finding-item.sev-info  {background:var(--sev-info-bg);border-color:var(--sev-info-border)}
  .finding-sev{
    font-family:"Space Mono";font-size:8px;letter-spacing:.2em;text-transform:uppercase;
    white-space:nowrap;flex-shrink:0;padding-top:2px;font-weight:700;min-width:44px;
  }
  .finding-item.sev-high   .finding-sev{color:var(--sev-high-ink)}
  .finding-item.sev-medium .finding-sev{color:var(--sev-med-ink)}
  .finding-item.sev-low    .finding-sev{color:var(--sev-low-ink)}
  .finding-item.sev-info   .finding-sev{color:var(--sev-info-ink)}
  .finding-body{flex:1;min-width:0}
  .finding-text{font-family:"Space Grotesk";font-size:13px;line-height:1.4;color:var(--ink)}
  .finding-detail{font-family:"Space Grotesk";font-size:11px;color:var(--ink-soft);margin-top:3px;line-height:1.35}

  /* ── Verification list ── */
  .verify-split{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:560px){.verify-split{grid-template-columns:1fr}}
  .verify-col-label{
    font-family:"Space Mono";font-size:9px;letter-spacing:.22em;text-transform:uppercase;margin-bottom:9px;
  }
  .verify-col-label.confirmed  {color:#166534}
  .verify-col-label.contradicted{color:#dc2626}
  .verify-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
  .verify-list li{
    font-family:"Space Grotesk";font-size:13px;line-height:1.35;
    display:flex;align-items:flex-start;gap:7px;
  }
  .verify-list li::before{
    flex-shrink:0;font-family:"Space Mono";font-size:10px;padding-top:1px;font-weight:700;
  }
  .verify-list.confirmed-list    li::before{content:"✓";color:#166534}
  .verify-list.contradicted-list li::before{content:"✗";color:#dc2626}

  /* ── Readiness verdict ── */
  .mb-verdict{
    display:flex;align-items:flex-start;gap:14px;
    padding:14px 18px;border-radius:14px;border:1px solid;
  }
  .mb-verdict.verdict-ready  {background:var(--vd-ready-bg);  border-color:var(--vd-ready-border)}
  .mb-verdict.verdict-partial{background:var(--vd-partial-bg);border-color:var(--vd-partial-border)}
  .mb-verdict.verdict-blocked{background:var(--vd-blocked-bg);border-color:var(--vd-blocked-border)}
  .mb-verdict-label{
    font-family:"Doto",monospace;font-weight:900;
    font-size:clamp(16px,2.4vw,26px);letter-spacing:.02em;text-transform:uppercase;
    line-height:1;flex-shrink:0;padding-top:2px;
  }
  .mb-verdict.verdict-ready   .mb-verdict-label{color:var(--vd-ready-ink)}
  .mb-verdict.verdict-partial .mb-verdict-label{color:var(--vd-partial-ink)}
  .mb-verdict.verdict-blocked .mb-verdict-label{color:var(--vd-blocked-ink)}
  .mb-verdict-title{font-family:"Space Grotesk";font-weight:600;font-size:14px;color:var(--ink);margin:0 0 3px}
  .mb-verdict-desc {font-family:"Space Grotesk";font-size:12px;color:var(--ink-soft);margin:0;line-height:1.4}

  /* ── Code block ── */
  .mb-code-block{
    position:relative;
    background:#1a1714;
    border:1px solid rgba(212,196,171,0.22);
    border-radius:12px;
    padding:14px 18px 14px 18px;
    overflow-x:auto;
  }
  .mb-code-block code{
    font-family:"Space Mono",ui-monospace,monospace;
    font-size:11.5px; line-height:1.65; color:#e8dfc8;
    white-space:pre; display:block;
  }
  .mb-code-copy{
    position:absolute; top:10px; right:12px;
    background:rgba(255,255,255,0.07);
    border:1px solid rgba(212,196,171,0.22);
    border-radius:6px; color:#9e9282;
    font-family:"Space Mono",monospace;
    font-size:8px; letter-spacing:.2em; text-transform:uppercase;
    padding:4px 10px; cursor:pointer; line-height:1;
    transition:background .15s,color .15s;
  }
  .mb-code-copy:hover{background:rgba(255,255,255,0.13);color:#e8dfc8}

  /* ── Status banner (empty / partial) ── */
  .mb-status-banner{
    display:flex;align-items:center;gap:10px;
    padding:12px 16px;border-radius:10px;
    background:rgba(0,0,0,0.03);border:1px solid rgba(0,0,0,0.09);
    font-family:"Space Mono";font-size:10px;letter-spacing:.18em;text-transform:uppercase;
    color:var(--ink-soft); margin-bottom:clamp(20px,3vw,32px);
  }
  .mb-status-banner .dot{width:5px;height:5px;border-radius:50%;background:var(--ink-soft);flex-shrink:0}
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scoreClass(value, status) {
  if (status) return status;
  if (typeof value !== 'number') return '';
  if (value >= 80) return 'ok';
  if (value >= 50) return 'warn';
  return 'bad';
}

// ── Section renderers ─────────────────────────────────────────────────────────

function renderScoreBlock({ eyebrow, title, scores = [] }) {
  const tiles = scores.map(({ label, value, status }) => `
    <div class="score ${esc(scoreClass(value, status))}">
      <div class="lbl">${esc(label)}</div>
      <div class="num">${esc(value)}</div>
    </div>`).join('');
  return `
    <div class="mb-section">
      ${eyebrow ? `<div class="mb-section-eyebrow">${esc(eyebrow)}</div>` : ''}
      ${title   ? `<div class="mb-section-title">${esc(title)}</div>`   : ''}
      <div class="scores">${tiles}</div>
    </div>`;
}

function renderMetricGrid({ eyebrow, title, items = [] }) {
  const tiles = items.map(({ k, v }) => `
    <div class="meta-tile">
      <div class="k">${esc(k)}</div>
      <div class="v">${esc(v)}</div>
    </div>`).join('');
  return `
    <div class="mb-section">
      ${eyebrow ? `<div class="mb-section-eyebrow">${esc(eyebrow)}</div>` : ''}
      ${title   ? `<div class="mb-section-title">${esc(title)}</div>`   : ''}
      <div class="meta-grid">${tiles}</div>
    </div>`;
}

function renderBars({ eyebrow, title, items = [] }) {
  const rows = items.map(({ name, value, max = 100, unit = '' }) => {
    const pct = Math.min(100, Math.round((value / max) * 100));
    return `
      <div class="bar-row">
        <span class="name">${esc(name)}</span>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <span class="val">${esc(value)}${esc(unit)}</span>
      </div>`;
  }).join('');
  return `
    <div class="mb-section">
      ${eyebrow ? `<div class="mb-section-eyebrow">${esc(eyebrow)}</div>` : ''}
      ${title   ? `<div class="mb-section-title">${esc(title)}</div>`   : ''}
      ${rows}
    </div>`;
}

function renderFindingList({ eyebrow, title, items = [] }) {
  const findings = items.map(({ severity = 'info', text, detail }) => `
    <div class="finding-item sev-${esc(severity)}">
      <div class="finding-sev">${esc(severity)}</div>
      <div class="finding-body">
        <div class="finding-text">${esc(text)}</div>
        ${detail ? `<div class="finding-detail">${esc(detail)}</div>` : ''}
      </div>
    </div>`).join('');
  return `
    <div class="mb-section">
      ${eyebrow ? `<div class="mb-section-eyebrow">${esc(eyebrow)}</div>` : ''}
      ${title   ? `<div class="mb-section-title">${esc(title)}</div>`   : ''}
      <div class="finding-list">${findings}</div>
    </div>`;
}

function renderVerificationList({ eyebrow, title, confirmed = [], contradicted = [] }) {
  const confirmedItems = confirmed.map((t) => `<li>${esc(t)}</li>`).join('');
  const contradictedItems = contradicted.map((t) => `<li>${esc(t)}</li>`).join('');
  return `
    <div class="mb-section">
      ${eyebrow ? `<div class="mb-section-eyebrow">${esc(eyebrow)}</div>` : ''}
      ${title   ? `<div class="mb-section-title">${esc(title)}</div>`   : ''}
      <div class="verify-split">
        <div>
          <div class="verify-col-label confirmed">Confirmed</div>
          <ul class="verify-list confirmed-list">${confirmedItems || '<li style="opacity:.5">None detected</li>'}</ul>
        </div>
        <div>
          <div class="verify-col-label contradicted">Contradicted</div>
          <ul class="verify-list contradicted-list">${contradictedItems || '<li style="opacity:.5">None detected</li>'}</ul>
        </div>
      </div>
    </div>`;
}

function renderProse({ eyebrow, title, body = '' }) {
  return `
    <div class="mb-section">
      ${eyebrow ? `<div class="mb-section-eyebrow">${esc(eyebrow)}</div>` : ''}
      ${title   ? `<div class="mb-section-title">${esc(title)}</div>`   : ''}
      <p class="pull">${esc(body)}</p>
    </div>`;
}

function renderStatRows({ eyebrow, title, rows = [] }) {
  const items = rows.map(({ k, v }) => `
    <div class="stat-row">
      <div class="k">${esc(k)}</div>
      <div class="v">${esc(v)}</div>
    </div>`).join('');
  return `
    <div class="mb-section">
      ${eyebrow ? `<div class="mb-section-eyebrow">${esc(eyebrow)}</div>` : ''}
      ${title   ? `<div class="mb-section-title">${esc(title)}</div>`   : ''}
      <div>${items}</div>
    </div>`;
}

function renderCodeBlock({ eyebrow, title, body = '', language = '' }) {
  const id = `mb-cb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const copyScript = `var c=document.getElementById('${id}').querySelector('code');navigator.clipboard.writeText(c.textContent).then(function(){var b=this;b.textContent='COPIED';setTimeout(function(){b.textContent='COPY';},1500);}.bind(this))`;
  return `
    <div class="mb-section">
      ${eyebrow ? `<div class="mb-section-eyebrow">${esc(eyebrow)}</div>` : ''}
      ${title   ? `<div class="mb-section-title">${esc(title)}</div>`   : ''}
      <div class="mb-code-block" id="${id}">
        <button class="mb-code-copy" onclick="${copyScript}">COPY</button>
        <pre><code${language ? ` class="language-${esc(language)}"` : ''}>${esc(body)}</code></pre>
      </div>
    </div>`;
}

function renderReadiness({ label, verdict = 'partial', title, description }) {
  return `
    <div class="mb-section">
      <div class="mb-verdict verdict-${esc(verdict)}">
        <div class="mb-verdict-label">${esc(label)}</div>
        <div>
          ${title       ? `<div class="mb-verdict-title">${esc(title)}</div>`           : ''}
          ${description ? `<p class="mb-verdict-desc">${esc(description)}</p>` : ''}
        </div>
      </div>
    </div>`;
}

function renderSection(section) {
  switch (section.type) {
    case 'score-block':        return renderScoreBlock(section);
    case 'metric-grid':        return renderMetricGrid(section);
    case 'bars':               return renderBars(section);
    case 'finding-list':       return renderFindingList(section);
    case 'verification-list':  return renderVerificationList(section);
    case 'prose':              return renderProse(section);
    case 'stat-rows':          return renderStatRows(section);
    case 'readiness':          return renderReadiness(section);
    case 'code-block':         return renderCodeBlock(section);
    default:                   return '';
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * renderMiniBriefHtml — builds a complete <!doctype html> document string.
 *
 * @param {object} opts
 * @param {string}  opts.title       — document headline (Doto treatment)
 * @param {string}  [opts.subtitle]  — subheading below title
 * @param {string}  [opts.eyebrow]   — small-caps label above title
 * @param {Array}   [opts.sections]  — section descriptors (see renderSection)
 * @param {'ready'|'partial'|'empty'} [opts.status] — controls status banner
 * @param {string}  [opts.statusMessage] — override banner text
 */
export function renderMiniBriefHtml({
  title = '',
  subtitle = '',
  eyebrow = '',
  sections = [],
  status = 'ready',
  statusMessage = '',
} = {}) {
  const banner = status !== 'ready'
    ? `<div class="mb-status-banner">
        <span class="dot"></span>
        ${esc(statusMessage || (status === 'empty' ? 'No data yet — run the pipeline to generate this report.' : 'Partial data — some sections may be incomplete.'))}
       </div>`
    : '';

  const body = sections.map(renderSection).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Doto:wght@900&family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>${MINI_BRIEF_CSS}</style>
</head>
<body>
<div class="mb-shell">
  <header class="mb-header">
    ${eyebrow ? `<div class="mb-eyebrow"><span class="dot"></span>${esc(eyebrow)}</div>` : ''}
    <h1 class="mb-title">${esc(title)}</h1>
    ${subtitle ? `<p class="mb-subtitle">${esc(subtitle)}</p>` : ''}
  </header>
  ${banner}
  ${body}
</div>
</body>
</html>`;
}
