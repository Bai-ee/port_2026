'use strict';

// brief-renderer.js — Reproduces docs/brief.html exactly.
//
// Reference template: /docs/brief.html (canonical visual target).
// CSS block below is lifted near-verbatim from that file; each section is
// rendered from pipeline data but uses the same class names + DOM shape so
// the output matches the reference rendered in Safari/Chrome.
//
// Sections:
//   00 Cover            — brand headline, sub, meta grid, marquee band
//   01 Brief            — stat-row grid + pull quote
//   02 Intake Terminal  — 3-node flow (Scrape → Extract → Normalize)
//   03 Brand Tone       — pull quote + site-meta tile grid
//   04 Style Guide      — type sample + motion durations + 3 swatches
//   05 SEO + Perf       — 4 score tiles + core web vitals bars + top fixes
//   06 Industry         — ring diagram + stat rows
//   07 Business Model   — 3-node flow derived from model string
//   08 Work Needed      — bundles PS/DP/CA/CO into a 4-card grid when all empty;
//                          otherwise renders the sections that have data.

const path = require('path');
const fs = require('fs');

const SIG_DATA_URL = (() => {
  try {
    const sigPath = path.resolve(__dirname, '../../public/img/sig.png');
    const buf = fs.readFileSync(sigPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
})();

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasMeaning(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v).some(hasMeaning);
  return Boolean(v);
}

// Break a phrase into 2-3 lines for the giant headline treatment.
// Accepts a short string; returns an array of words grouped into lines.
function splitHeadline(text, maxLines = 3) {
  if (!text) return ['Intake', 'Brief.'];
  // First: honour explicit line breaks if present in the source.
  if (text.includes('\n')) return text.split(/\n+/).slice(0, maxLines);
  const words = String(text).trim().split(/\s+/);
  if (words.length <= maxLines) return words;
  // Group into ~equal line lengths.
  const perLine = Math.ceil(words.length / maxLines);
  const lines = [];
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine).join(' '));
  return lines.slice(0, maxLines);
}

function hostnameOf(url) {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url); }
}

// Split a business-model string like "Tickets + Vinyl + Partnerships" into
// up to 3 streams. Falls back to a single-stream array.
// Pull the first sentence (or a short phrase) from a longer string — used
// for the giant `.sub` treatment so headlines don't overflow at 34px.
function firstSentence(text, maxChars = 140) {
  if (!text) return '';
  const trimmed = String(text).trim();
  // First sentence via punctuation boundary.
  const m = trimmed.match(/^[\s\S]+?[.!?](?=\s|$)/);
  let out = m ? m[0].trim() : trimmed;
  if (out.length > maxChars) {
    // Truncate at the last whole word under the cap, then add an ellipsis.
    out = out.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
  }
  return out;
}

function splitModelStreams(modelStr) {
  if (!modelStr) return [];
  const segs = String(modelStr)
    .split(/\s*[+·|/]\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return segs.slice(0, 3);
}

// Crude swatch ink resolver — white text on colors that aren't near-white.
function isLightHex(hex) {
  if (!hex) return false;
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // Relative luminance approximation.
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return y > 200;
}

// ── CSS (lifted from docs/brief.html near-verbatim) ──────────────────────────

const CSS = `
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
    --gutter:max(8vw, calc((100% - 1100px) / 2));
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{
    font-family:"Space Grotesk",system-ui,sans-serif;
    color:var(--ink);
    background:
      radial-gradient(700px 420px at 0% 4%,    rgba(255,120,90,0.38) 0%, transparent 65%),
      radial-gradient(620px 380px at 100% 16%, rgba(176,90,255,0.32) 0%, transparent 65%),
      radial-gradient(700px 420px at 0% 30%,   rgba(255,90,160,0.32) 0%, transparent 65%),
      radial-gradient(600px 380px at 100% 44%, rgba(90,140,255,0.30) 0%, transparent 65%),
      radial-gradient(720px 440px at 0% 58%,   rgba(255,180,90,0.32) 0%, transparent 65%),
      radial-gradient(620px 400px at 100% 72%, rgba(200,90,255,0.30) 0%, transparent 65%),
      radial-gradient(660px 400px at 0% 86%,   rgba(120,200,255,0.28) 0%, transparent 65%),
      radial-gradient(560px 360px at 100% 98%, rgba(255,120,160,0.28) 0%, transparent 65%),
      linear-gradient(180deg, #fefdf9 0%, #fbf8f0 50%, #fdfaf2 100%);
    -webkit-font-smoothing:antialiased;
  }
  .mono{font-family:"Space Mono",ui-monospace,monospace}
  .doto{font-family:"Doto",monospace;letter-spacing:.02em}

  section.page{
    min-height:100vh;
    padding:clamp(48px,9vh,120px) var(--gutter) clamp(64px,10vh,140px);
    display:flex; flex-direction:column; justify-content:center;
    border-bottom:1px solid rgba(0,0,0,0.05);
    position:relative; overflow:hidden;
  }
  .eyebrow{
    font-family:"Space Mono",monospace; font-size:11px;
    letter-spacing:.22em; text-transform:uppercase; color:var(--ink-soft);
    display:flex; gap:18px; align-items:center; margin-bottom:24px; flex-wrap:wrap;
  }
  .eyebrow .dot{width:6px;height:6px;background:var(--ink);border-radius:50%}
  .headline{
    font-family:"Doto",monospace;
    font-weight:900; letter-spacing:-.01em; line-height:.92;
    font-size:clamp(64px, 13vw, 200px);
    margin:0 0 24px;
    text-transform:uppercase;
  }
  .sub{
    font-family:"Space Grotesk",sans-serif;
    font-weight:300; font-size:clamp(20px,2.4vw,34px);
    line-height:1.25; color:#1a1a1a; max-width:58ch; margin:0 0 40px;
  }
  .rule{height:1px;background:rgba(0,0,0,.1);margin:28px 0}

  .cover .title-stack{display:flex;align-items:baseline;gap:20px;flex-wrap:wrap}
  .cover .meta{
    display:grid; grid-template-columns:repeat(4,minmax(0,1fr));
    gap:24px 40px; margin-top:40px;
    border-top:1px solid rgba(0,0,0,.15); padding-top:24px;
  }
  .cover .meta .k{font-family:"Space Mono",monospace;font-size:10px;letter-spacing:.25em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:6px}
  .cover .meta .v{font-family:"Space Grotesk";font-size:18px;word-break:break-word}
  .marquee{
    overflow:hidden; white-space:nowrap;
    font-family:"Doto",monospace; font-weight:900;
    font-size:clamp(44px,10vw,160px); text-transform:uppercase;
    line-height:1; letter-spacing:.02em;
    border-top:1px solid rgba(0,0,0,.2);
    border-bottom:1px solid rgba(0,0,0,.2);
    padding:12px 0; margin-top:40px;
  }
  .marquee span{display:inline-block}

  .card{
    background:var(--card);
    border:1px solid var(--line);
    border-radius:18px;
    box-shadow:0 1px 0 var(--hl), inset 0 1px 0 rgba(255,255,255,0.4);
    padding:clamp(18px,2vw,28px);
  }

  .brief-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:clamp(24px,3vw,48px);align-items:start}
  @media(max-width:900px){.brief-grid{grid-template-columns:1fr}}
  .stat-row{display:grid;grid-template-columns:120px 1fr;gap:16px;padding:14px 0;border-bottom:1px dashed rgba(0,0,0,.15)}
  .stat-row:last-child{border-bottom:0}
  .stat-row .k{font-family:"Space Mono",monospace;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft);padding-top:4px}
  .stat-row .v{font-family:"Space Grotesk";font-size:16px;line-height:1.45}

  .pull{
    font-family:"Space Grotesk"; font-weight:300;
    font-size:clamp(26px,3.2vw,44px); line-height:1.2;
    border-left:4px solid var(--ink); padding:8px 0 8px 24px;
    max-width:28ch;
  }
  .meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:30px}
  @media(max-width:800px){.meta-grid{grid-template-columns:1fr 1fr}}
  .meta-tile{background:rgba(255,255,255,.55);border:1px solid var(--line);border-radius:14px;padding:16px}
  .meta-tile .k{font-family:"Space Mono";font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:6px}
  .meta-tile .v{font-family:"Space Grotesk";font-size:15px;word-break:break-word}

  .sg-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:20px}
  .sg-grid > *{grid-column:span 6}
  .sg-grid .w4{grid-column:span 4}
  .sg-grid .w12{grid-column:span 12}
  @media(max-width:900px){.sg-grid > *{grid-column:span 12!important}}
  .swatch{height:160px;border-radius:16px;border:1px solid var(--line);position:relative;overflow:hidden;display:flex;align-items:flex-end;padding:16px;color:#fff}
  .swatch .hex{font-family:"Space Mono";font-size:13px}
  .swatch.light{color:#111}
  .type-sample{font-family:"Space Grotesk";font-size:48px;line-height:1;margin:0 0 6px}
  .dur-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .dur{font-family:"Space Mono";font-size:11px;padding:6px 10px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.5)}

  .scores{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-bottom:32px}
  @media(max-width:800px){.scores{grid-template-columns:repeat(2,1fr)}}
  .score{aspect-ratio:1/1;border-radius:20px;border:1px solid var(--line);background:rgba(255,255,255,.5);display:flex;flex-direction:column;justify-content:space-between;padding:18px}
  .score .lbl{font-family:"Space Mono";font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft)}
  .score .num{font-family:"Doto";font-weight:900;font-size:clamp(48px,7vw,96px);line-height:.9}
  .score.bad .num{color:#c2410c}
  .score.ok .num{color:#166534}
  .bar-row{display:flex;align-items:center;gap:14px;margin:10px 0;font-family:"Space Mono";font-size:12px}
  .bar-row .name{width:140px;text-transform:uppercase;letter-spacing:.18em;font-size:10px;color:var(--ink-soft)}
  .bar{flex:1;height:10px;background:rgba(0,0,0,.06);border-radius:999px;overflow:hidden}
  .bar > i{display:block;height:100%;background:var(--grad)}

  .status-tag{display:inline-flex;align-items:center;gap:8px;font-family:"Space Mono";font-size:10px;letter-spacing:.2em;text-transform:uppercase;padding:6px 12px;border-radius:999px;background:#fff;border:1px solid var(--line);color:var(--ink)}
  .status-tag.warn{background:rgba(220,38,38,0.06);border-color:rgba(220,38,38,0.40);color:#dc2626}
  .status-tag.warn::before{content:"";width:6px;height:6px;border-radius:50%;background:#dc2626;box-shadow:0 0 0 3px rgba(220,38,38,0.15)}
  .wn-eyebrow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft)}

  footer{padding:40px var(--gutter);font-family:"Space Mono";font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft);display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}

  .sec-num{
    position:absolute; top:24px; right:var(--gutter);
    font-family:"Doto"; font-weight:900;
    font-size:clamp(80px,14vw,220px);
    color:transparent; -webkit-text-stroke:1.5px rgba(0,0,0,.12);
    line-height:.8; pointer-events:none; user-select:none;
  }

  .ring{
    width:min(420px,70vw);aspect-ratio:1/1;border-radius:50%;
    border:1px dashed rgba(0,0,0,.25);
    display:flex;align-items:center;justify-content:center;
    position:relative;
  }
  .ring::before,.ring::after{content:"";position:absolute;inset:12%;border-radius:50%;border:1px dashed rgba(0,0,0,.2)}
  .ring::after{inset:26%}
  .ring .core{font-family:"Doto";font-weight:900;font-size:clamp(22px,3vw,42px);text-align:center;max-width:60%;line-height:.95;text-transform:uppercase}

  .flow{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
  @media(max-width:800px){.flow{grid-template-columns:1fr}}
  .flow .node{padding:22px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.55)}
  .flow .node .n{font-family:"Space Mono";font-size:10px;letter-spacing:.22em;color:var(--ink-soft);margin-bottom:8px}
  .flow .node .t{font-family:"Doto";font-weight:900;font-size:26px;text-transform:uppercase;line-height:1}
  .flow .node p{font-family:"Space Grotesk";font-size:14px;margin:10px 0 0;color:#2a2a2a}

  @media print{
    section.page{min-height:auto;padding:48px 40px;page-break-after:always;page-break-inside:avoid}
    .sec-num{font-size:140px}
  }
`;

// ── Section templates ───────────────────────────────────────────────────────

function renderHeadline(text) {
  const lines = splitHeadline(text);
  return lines.map(esc).join('<br/>');
}

function sectionCover({ brief, websiteUrl, when, tier, clientId, userEmail }) {
  const brand = brief?.headline
    ? String(brief.headline).split(/[—:·]/)[0].trim()
    : hostnameOf(websiteUrl).split('.')[0];
  const sub = brief?.summary || '';
  const tierLabel = tier === 'paid' ? 'Recurring · Paid' : 'One-time · Free';
  const dateLine = when.replace(/-/g, ' · ');
  return `
    <section class="page cover">
      <div class="sec-num">00</div>
      <div class="eyebrow">
        <span class="dot"></span>
        <span>Intake Brief · Vol. 01</span>
        ${clientId ? `<span>Client · ${esc(clientId.slice(0, 8))}</span>` : ''}
        <span>Tier · ${esc(tierLabel.split(' · ')[0])}</span>
      </div>
      <div class="title-stack">
        <h1 class="headline">${renderHeadline(brand || 'Intake Brief')}</h1>
      </div>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
      <div class="meta">
        <div><div class="k">Date</div><div class="v">${esc(dateLine)}</div></div>
        <div><div class="k">Site</div><div class="v">${esc(hostnameOf(websiteUrl) || '—')}</div></div>
        <div><div class="k">Tier</div><div class="v">${esc(tierLabel)}</div></div>
        <div><div class="k">Account</div><div class="v mono" style="font-size:13px">${esc(userEmail || '—')}</div></div>
      </div>
      <div class="marquee"><span>${esc((brand || 'BRIEF').toUpperCase())} • ${esc((brand || 'BRIEF').toUpperCase())} • ${esc((brand || 'BRIEF').toUpperCase())} • ${esc((brand || 'BRIEF').toUpperCase())} • ${esc((brand || 'BRIEF').toUpperCase())}</span></div>
    </section>
  `;
}

function sectionBrief({ ctx }) {
  const bo = ctx.snapshot?.brandOverview || {};
  const bt = ctx.snapshot?.brandTone || {};
  const strat = ctx.strategy || {};
  const headline = ctx.scribeCards?.brief?.short || 'The Brief.';
  const sub = ctx.scribeCards?.brief?.expanded
    || bo.positioning
    || ctx.brief?.summary
    || '';
  const pullText = bo.positioning
    ? `"${String(bo.positioning).split(/[.!?]/)[0].trim()}."`
    : (bt.primary ? `"${bt.primary}."` : '"A signal worth investing in."');
  return `
    <section class="page">
      <div class="sec-num">01</div>
      <div class="eyebrow"><span class="dot"></span><span>BR · Brief</span><span>Live · Reviewed</span></div>
      <h2 class="headline">${renderHeadline('The Brief.')}</h2>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}

      <div class="brief-grid">
        <div class="card">
          ${[
            { k: 'Industry', v: bo.industry },
            { k: 'Model',    v: bo.businessModel },
            { k: 'Tone',     v: [bt.primary, bt.secondary].filter(Boolean).join(' + ') },
            { k: 'Target',   v: bo.targetAudience },
            { k: 'Position', v: bo.positioning },
            { k: 'Channels', v: Array.isArray(strat.postStrategy?.formats) ? strat.postStrategy.formats.join(' · ') : '' },
          ].map(({ k, v }) => hasMeaning(v)
            ? `<div class="stat-row"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`
            : ''
          ).join('')}
        </div>
        <div>
          <div class="pull">${esc(pullText)}</div>
          <div class="rule"></div>
          <p style="font-family:'Space Grotesk';font-size:16px;line-height:1.55;color:#1a1a1a;max-width:40ch">
            ${esc(ctx.brief?.summary || bo.summary || '')}
          </p>
        </div>
      </div>
    </section>
  `;
}

function sectionIntakeTerminal({ ctx }) {
  const m = ctx.runMeta || {};
  const pagesLine = m.pagesFetched != null
    ? `Crawl · pages, metadata, OG tags — ${m.pagesFetched} page${m.pagesFetched === 1 ? '' : 's'} scanned.`
    : 'Crawl · pages, metadata, links, OG tags.';
  const warnLine = m.warningCount != null
    ? `Warnings · ${m.warningCount}`
    : 'Pipeline signals validated.';
  return `
    <section class="page" style="background:linear-gradient(180deg,transparent, rgba(10,10,10,.02))">
      <div class="sec-num">02</div>
      <div class="eyebrow"><span class="dot"></span><span>IT · Intake Terminal</span><span>${esc(warnLine)}</span></div>
      <h2 class="headline">${renderHeadline('Intake Terminal.')}</h2>
      <p class="sub">Scraped pages, extracted signals, and normalization steps captured from the run lifecycle.</p>

      <div class="flow">
        <div class="node"><div class="n">Step 01</div><div class="t">Scrape</div><p>${esc(pagesLine)}</p></div>
        <div class="node"><div class="n">Step 02</div><div class="t">Extract</div><p>Signals · tone cues, offers, partners, audience frames.</p></div>
        <div class="node"><div class="n">Step 03</div><div class="t">Normalize</div><p>Map to brand / industry / model / opportunity schema.</p></div>
      </div>
    </section>
  `;
}

function sectionBrandTone({ ctx }) {
  const tone = ctx.snapshot?.brandTone || {};
  const siteMeta = ctx.siteMeta || {};
  const hasTone = hasMeaning(tone.primary) || hasMeaning(tone.writingStyle);
  if (!hasTone && !hasMeaning(siteMeta)) return null;

  const headlineText = ctx.scribeCards?.['brand-tone']?.short || 'Brand Tone.';
  // Sub lives at 20-34px — keep it to a single punchy line. Full copy moves
  // into the card body at normal body size.
  const longBody = ctx.scribeCards?.['brand-tone']?.expanded || tone.writingStyle || '';
  const subText = firstSentence(
    ctx.scribeCards?.['brand-tone']?.short
      || tone.writingStyle
      || longBody
      || 'Voice system and tone markers extracted from intake copy.',
    120
  );

  const pullText = Array.isArray(tone.tags) && tone.tags.length
    ? tone.tags.slice(0, 3).map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join('. ') + '.'
    : (tone.primary ? `${tone.primary.charAt(0).toUpperCase() + tone.primary.slice(1)}.` : 'Voice and cadence.');

  const NOT_PROVIDED = 'Not provided';
  const metaTiles = [
    { k: 'Title',           v: siteMeta.title        || NOT_PROVIDED },
    { k: 'Site Name',       v: siteMeta.siteName     || NOT_PROVIDED },
    { k: 'OG Type',         v: siteMeta.type         || NOT_PROVIDED },
    { k: 'Locale',          v: siteMeta.locale       || NOT_PROVIDED },
    { k: 'Theme Color',     v: siteMeta.themeColor   || NOT_PROVIDED },
    { k: 'Canonical',       v: siteMeta.canonical    || NOT_PROVIDED, mono: true },
  ];
  const description = siteMeta.description
    ? `<div class="meta-tile" style="grid-column:span 3"><div class="k">OG Description</div><div class="v">${esc(siteMeta.description)}</div></div>`
    : '';

  return `
    <section class="page">
      <div class="sec-num">03</div>
      <div class="eyebrow"><span class="dot"></span><span>BT · Brand Tone</span><span>Live · Reviewed</span></div>
      <h2 class="headline">${renderHeadline(headlineText)}</h2>
      <p class="sub">${esc(subText)}</p>

      <div class="brief-grid">
        <div>
          <div class="pull">${esc(pullText)}</div>
          <div class="rule"></div>
          <p style="font-family:'Space Grotesk';font-size:16px;line-height:1.55;max-width:42ch">
            ${esc(longBody)}
          </p>
        </div>
        <div class="meta-grid">
          ${metaTiles.map((t) => `
            <div class="meta-tile">
              <div class="k">${esc(t.k)}</div>
              <div class="v${t.mono ? ' mono' : ''}"${t.mono ? ' style="font-size:12px"' : ''}>${esc(t.v)}</div>
            </div>
          `).join('')}
          ${description}
        </div>
      </div>
    </section>
  `;
}

function sectionStyleGuide({ ctx }) {
  const sg = ctx.styleGuide;
  if (!sg) return null;
  const typ = sg.typography || {};
  const colors = sg.colors || {};
  const motion = sg.motion || {};
  const layout = sg.layout || {};

  const headlineText = ctx.scribeCards?.['style-guide']?.short || 'Style Guide.';
  // Keep .sub short at 20-34px — detail lives in the card grid below.
  const subText = firstSentence(
    ctx.scribeCards?.['style-guide']?.short
      || ctx.scribeCards?.['style-guide']?.expanded
      || 'Typography, color palette, layout system, and motion signals extracted from your live site\'s CSS.',
    120
  );

  const headingFam = typ.headingSystem?.fontFamily || 'system-ui';
  const bodyFam    = typ.bodySystem?.fontFamily    || headingFam;
  const headingTypeLine = [typ.headingSystem?.fontSize, typ.headingSystem?.fontWeight].filter(Boolean).join(' · ');
  const durations = Array.isArray(motion.durations) ? motion.durations.slice(0, 11) : [];

  const primary   = colors.primary   ? { hex: colors.primary.hex,   role: `Primary · ${colors.primary.role || ''}` } : null;
  const secondary = colors.secondary ? { hex: colors.secondary.hex, role: `Secondary · ${colors.secondary.role || ''}` } : null;
  const neutral   = colors.neutral   ? { hex: colors.neutral.hex,   role: `Neutral · ${colors.neutral.role || ''}` } : null;

  function renderSwatch(s) {
    if (!s) return '';
    const light = isLightHex(s.hex);
    return `
      <div class="w4 swatch${light ? ' light' : ''}" style="background:${esc(s.hex)}">
        <div>
          <div class="mono" style="font-size:10px;letter-spacing:.22em;${light ? 'color:#666' : 'opacity:.8'}">${esc(s.role.toUpperCase())}</div>
          <div class="hex">${esc(s.hex)}</div>
        </div>
      </div>
    `;
  }

  return `
    <section class="page">
      <div class="sec-num">04</div>
      <div class="eyebrow"><span class="dot"></span><span>SG · Style Guide</span><span>Live · Reviewed</span></div>
      <h2 class="headline">${renderHeadline(headlineText)}</h2>
      <p class="sub">${esc(subText)}</p>

      <div class="sg-grid">
        <div class="card">
          <div class="wn-eyebrow"><span>Heading + Body</span></div>
          <div class="type-sample">${esc(headingFam)}${bodyFam && bodyFam !== headingFam ? ` / ${esc(bodyFam)}` : ''}</div>
          ${headingTypeLine ? `<div class="mono" style="font-size:12px;color:var(--ink-soft)">${esc(headingTypeLine)}</div>` : ''}
          <div class="rule"></div>
          ${typ.scale       ? `<div class="mono" style="font-size:12px">Scale · ${esc(typ.scale)}</div>` : ''}
          ${layout.layoutType ? `<div class="mono" style="font-size:12px">Layout · ${esc(layout.layoutType)}${layout.contentWidth ? ' · ' + esc(layout.contentWidth) : ''}</div>` : ''}
          ${layout.framing || layout.grid ? `<div class="mono" style="font-size:12px">Framing · ${esc(layout.framing || '')}${layout.grid ? ' · ' + esc(layout.grid) : ''}</div>` : ''}
          ${layout.borderRadius || motion.level ? `<div class="mono" style="font-size:12px">Radius · ${esc(layout.borderRadius || '—')}${motion.level ? ' · Motion · ' + esc(motion.level) : ''}</div>` : ''}
        </div>
        <div class="card">
          <div class="wn-eyebrow"><span>Motion Durations</span></div>
          ${durations.length ? `<div class="dur-row">${durations.map((d) => `<span class="dur">${esc(d)}</span>`).join('')}</div>` : '<p class="mono" style="font-size:12px;color:var(--ink-soft);margin:0">No discrete durations surfaced.</p>'}
          <div class="rule"></div>
          <p class="mono" style="font-size:12px;color:var(--ink-soft);margin:0">${durations.length} discrete easing${durations.length === 1 ? '' : 's'} — deliberate pacing.</p>
        </div>

        ${renderSwatch(primary)}
        ${renderSwatch(secondary)}
        ${renderSwatch(neutral)}
      </div>
    </section>
  `;
}

function sectionSeoPerformance({ ctx }) {
  const ps = ctx.pagespeed;
  if (!ps || !ps.scores) return null;
  const { scores, coreWebVitals, labCoreWebVitals, opportunities, seoRedFlags } = ps;

  const perf = scores.performance ?? null;
  const seo  = scores.seo ?? null;
  const a11y = scores.accessibility ?? null;
  const bp   = scores.bestPractices ?? null;
  function cls(n) { return n == null ? '' : (n >= 90 ? ' ok' : (n < 70 ? ' bad' : '')); }

  const headlineText = ctx.scribeCards?.['seo-performance']?.short || 'SEO + Performance.';
  const subText = firstSentence(
    ctx.psiSummary
      || ctx.scribeCards?.['seo-performance']?.short
      || 'Lighthouse scores, Core Web Vitals, and top fixes pulled from PageSpeed Insights.',
    160
  );

  // Core Web Vitals — bar widths are proportional to thresholds (visual only).
  const lcp = coreWebVitals?.lcp?.p75 != null ? coreWebVitals.lcp : labCoreWebVitals?.lcp;
  const cls2 = coreWebVitals?.cls?.p75 != null ? coreWebVitals.cls : labCoreWebVitals?.cls;
  const ttfb = coreWebVitals?.ttfb?.p75 != null ? coreWebVitals.ttfb : labCoreWebVitals?.ttfb;
  const inp = coreWebVitals?.inp;
  function barRow(name, valueLabel, widthPct, color, verdict) {
    return `<div class="bar-row"><span class="name">${esc(name)}</span><span class="bar"><i style="width:${widthPct}%;background:${color}"></i></span><span>${esc(verdict)}</span></div>`;
  }
  const bars = [];
  if (lcp?.p75 != null) {
    const seconds = lcp.p75 / 1000;
    const pct = Math.min(100, (seconds / 6) * 100);
    const color = seconds > 4 ? '#c2410c' : (seconds > 2.5 ? '#b45309' : '#166534');
    const verdict = seconds > 4 ? 'SLOW' : (seconds > 2.5 ? 'AVG' : 'FAST');
    bars.push(barRow(`LCP · ${seconds.toFixed(1)}s`, '', pct, color, verdict));
  }
  if (cls2?.p75 != null) {
    const val = Number(cls2.p75);
    const pct = Math.min(100, val * 100);
    const color = val > 0.25 ? '#c2410c' : (val > 0.1 ? '#b45309' : '#166534');
    bars.push(barRow(`CLS · ${val.toFixed(2)}`, '', Math.max(4, pct), color, val < 0.1 ? 'OK' : 'AVG'));
  }
  if (ttfb?.p75 != null) {
    const s = ttfb.p75 / 1000;
    const pct = Math.min(100, (s / 3) * 100);
    const color = s > 1.8 ? '#c2410c' : (s > 0.8 ? '#b45309' : '#166534');
    bars.push(barRow(`TTFB · ${s.toFixed(1)}s`, '', Math.max(4, pct), color, s < 0.8 ? 'OK' : 'AVG'));
  }
  bars.push(barRow(`INP · ${inp?.p75 != null ? inp.p75 + 'ms' : '—'}`, '', 0, 'transparent', inp?.p75 == null ? 'N/A' : (inp.p75 > 200 ? 'SLOW' : 'OK')));

  const fixRows = (opportunities || []).slice(0, 2).map((op, i) =>
    `<div class="stat-row"><div class="k">Fix ${String(i + 1).padStart(2, '0')}</div><div class="v">${esc(op.title)} <span class="mono" style="color:var(--ink-soft)">— ${esc(op.savingsMs)}ms</span></div></div>`
  ).join('');
  const flagRow = (seoRedFlags && seoRedFlags.length)
    ? (() => {
        const f = seoRedFlags[0];
        const id = typeof f === 'string' ? f : f.id;
        const desc = typeof f === 'string' ? '' : (f.description || '');
        return `<div class="stat-row"><div class="k">SEO Flag</div><div class="v">${esc(String(id || '').replace(/-/g, ' '))}${desc ? ` — ${esc(desc)}` : ''}</div></div>`;
      })()
    : '';

  return `
    <section class="page">
      <div class="sec-num">05</div>
      <div class="eyebrow"><span class="dot"></span><span>SP · SEO + Performance</span><span>Lighthouse${ps.status === 'partial' ? ' · Partial' : ''}</span></div>
      <h2 class="headline">${renderHeadline(headlineText)}</h2>
      <p class="sub">${esc(subText)}</p>

      <div class="scores">
        <div class="score${cls(perf)}"><div class="lbl">Perf</div><div class="num">${perf != null ? perf : '—'}</div></div>
        <div class="score${cls(seo)}"><div class="lbl">SEO</div><div class="num">${seo != null ? seo : '—'}</div></div>
        <div class="score${cls(a11y)}"><div class="lbl">A11y</div><div class="num">${a11y != null ? a11y : '—'}</div></div>
        <div class="score${cls(bp)}"><div class="lbl">BP</div><div class="num">${bp != null ? bp : '—'}</div></div>
      </div>

      <div class="brief-grid">
        <div class="card">
          <div class="eyebrow" style="margin-bottom:12px"><span>Core Web Vitals</span></div>
          ${bars.join('')}
        </div>
        <div class="card">
          <div class="eyebrow" style="margin-bottom:12px"><span>Top Fixes</span></div>
          ${fixRows || '<p class="mono" style="font-size:12px;color:var(--ink-soft);margin:0">No savings opportunities surfaced.</p>'}
          ${flagRow}
        </div>
      </div>
    </section>
  `;
}

function sectionIndustry({ ctx }) {
  const industry = ctx.snapshot?.brandOverview?.industry;
  if (!hasMeaning(industry)) return null;

  const headlineText = ctx.scribeCards?.industry?.short || 'Industry.';
  const subText = firstSentence(ctx.scribeCards?.industry?.short || industry, 140);

  // Ring core: up to 3 short words from industry string or top tags.
  const ringWords = String(industry).match(/[A-Z][a-z]+|\b[A-Z]{2,}\b|\b[A-Za-z]{3,8}\b/g) || [];
  const ringCore = ringWords.slice(0, 3).join('<br/>');

  const target = ctx.snapshot?.brandOverview?.targetAudience;
  const positioning = ctx.snapshot?.brandOverview?.positioning;

  return `
    <section class="page">
      <div class="sec-num">06</div>
      <div class="eyebrow"><span class="dot"></span><span>IN · Industry</span><span>Live · Reviewed</span></div>
      <h2 class="headline">${renderHeadline(headlineText)}</h2>
      <p class="sub">${esc(subText)}</p>

      <div class="brief-grid" style="align-items:center">
        <div style="display:flex;justify-content:center">
          <div class="ring"><div class="core">${ringCore || esc(industry)}</div></div>
        </div>
        <div class="card">
          ${[
            { k: 'Sector',  v: industry },
            { k: 'Serves',  v: target },
            { k: 'Role',    v: positioning ? String(positioning).split(/[.!?]/)[0] : '' },
          ].map(({ k, v }) => hasMeaning(v)
            ? `<div class="stat-row"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`
            : '').join('')}
        </div>
      </div>
    </section>
  `;
}

function sectionBusinessModel({ ctx }) {
  const model = ctx.snapshot?.brandOverview?.businessModel;
  if (!hasMeaning(model)) return null;

  const streams = splitModelStreams(model);
  const headlineText = ctx.scribeCards?.['business-model']?.short
    || (streams.length > 1 ? `${streams.length} streams.` : 'Business Model.');
  const subText = firstSentence(ctx.scribeCards?.['business-model']?.short || model, 140);

  return `
    <section class="page">
      <div class="sec-num">07</div>
      <div class="eyebrow"><span class="dot"></span><span>BM · Business Model</span><span>Live · Reviewed</span></div>
      <h2 class="headline">${renderHeadline(headlineText)}</h2>
      <p class="sub">${esc(subText)}</p>

      <div class="flow">
        ${(streams.length ? streams : [model]).map((s, i) => `
          <div class="node">
            <div class="n">Stream ${String(i + 1).padStart(2, '0')}</div>
            <div class="t">${esc(s)}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function sectionStrategyCards({ ctx, sectionNumber }) {
  // Bundle PS/DP/CA/CO — renders 4 cards with their data, or Work Needed fallback.
  const ps   = ctx.signals?.core?.find((s) => s?.relevance === 'high') || ctx.signals?.core?.[0] || null;
  const post = ctx.outputsPreview?.samplePost;
  const ang  = ctx.strategy?.contentAngles?.[0];
  const ops  = ctx.strategy?.opportunityMap || [];

  const allEmpty = !ps && !hasMeaning(post) && !ang && !ops.length;
  const headlineText = allEmpty ? 'Work Needed.' : 'Strategy.';
  const subText = allEmpty
    ? 'The crawl did not surface enough validated positioning, offer clarity, or audience framing to draft credibly. The next pass tightens the signal.'
    : 'Priority signal, draft post, editorial angle, and the opportunity map — pulled from the intake.';

  const card = (title, body, status = 'live') => `
    <div class="card">
      <div class="wn-eyebrow"><span>${esc(title)}</span><span class="status-tag${status === 'warn' ? ' warn' : ''}">${status === 'warn' ? 'Work Needed' : 'Live'}</span></div>
      <p style="margin:0;font-family:'Space Grotesk';font-size:15px;line-height:1.5">${esc(body)}</p>
    </div>
  `;

  const psText = ps
    ? (ctx.scribeCards?.['priority-signal']?.expanded || ps.summary || ps.label || '')
    : 'The crawl did not surface enough validated positioning or urgency signals. The highest-confidence marketing move is not yet clear.';
  const dpText = hasMeaning(post)
    ? post
    : 'Not enough trustworthy brand voice and offer clarity to draft a publish-ready social post credibly.';
  const caText = ang
    ? (ctx.scribeCards?.['content-angle']?.expanded || ang.rationale || ang.angle || '')
    : 'Audience / problem framing is too thin to establish a reliable editorial lens for the next push.';
  const coText = ops.length
    ? (ctx.scribeCards?.['content-opportunities']?.expanded
       || ops.slice(0, 3).map((o) => `${o.opportunity || o.topic}${o.whyNow || o.why ? ` — ${o.whyNow || o.why}` : ''}`).join(' · '))
    : 'The current intake did not surface enough concrete evidence to suggest high-confidence content and channel moves.';

  return `
    <section class="page">
      <div class="sec-num">${String(sectionNumber).padStart(2, '0')}</div>
      <div class="eyebrow"><span class="dot"></span><span>PS · DP · CA · CO</span><span>Status · ${allEmpty ? 'Work Needed' : 'Live'}</span></div>
      <h2 class="headline">${renderHeadline(headlineText)}</h2>
      <p class="sub">${esc(subText)}</p>

      <div class="sg-grid">
        ${card('PS · Priority Signal',       psText, ps   ? 'live' : 'warn')}
        ${card('DP · Draft Post',            dpText, hasMeaning(post) ? 'live' : 'warn')}
        ${card('CA · Content Angle',         caText, ang  ? 'live' : 'warn')}
        ${card('CO · Content Opportunities', coText, ops.length ? 'live' : 'warn')}
      </div>
    </section>
  `;
}

function renderFooter({ generatedAt, clientId, brief, websiteUrl }) {
  const when = generatedAt ? new Date(generatedAt).toISOString().slice(0, 19).replace('T', ' ') : new Date().toISOString();
  const brand = brief?.headline ? String(brief.headline).split(/[—:·]/)[0].trim() : hostnameOf(websiteUrl);
  return `
    <footer>
      <span>Generated · ${esc(when)}</span>
      ${clientId ? `<span>Client · ${esc(clientId)}</span>` : ''}
      <span>Intake Brief · Vol. 01${brand ? ' · ' + esc(brand) : ''}</span>
    </footer>
  `;
}

// ── Main renderer ────────────────────────────────────────────────────────────

function renderBriefHtml(input = {}) {
  const {
    brief = null,
    scribeCards = {},
    snapshot = null,
    signals = null,
    strategy = null,
    outputsPreview = null,
    siteMeta = null,
    styleGuide = null,
    pagespeed = null,
    psiSummary = null,
    mockupUrl = null,
    userContext = null,
    runMeta = null,
    websiteUrl = '',
    clientId = '',
    userEmail = '',
    generatedAt = null,
    tier = 'free',
  } = input;

  if (!brief) throw new Error('renderBriefHtml: brief is required');

  const when = new Date(generatedAt || Date.now()).toISOString().slice(0, 10);
  const ctx = {
    brief, scribeCards, snapshot, signals, strategy, outputsPreview, siteMeta,
    styleGuide, pagespeed, psiSummary, userContext, runMeta,
  };

  const sections = [
    sectionCover({ brief, websiteUrl, when, tier, clientId, userEmail }),
    sectionBrief({ ctx }),
    sectionIntakeTerminal({ ctx }),
    sectionBrandTone({ ctx }),
    sectionStyleGuide({ ctx }),
    sectionSeoPerformance({ ctx }),
    sectionIndustry({ ctx }),
    sectionBusinessModel({ ctx }),
  ].filter(Boolean);

  sections.push(sectionStrategyCards({ ctx, sectionNumber: sections.length }));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Intake Brief · Vol. 01${brief.headline ? ` · ${esc(brief.headline)}` : ''}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@300..700&family=Space+Mono:wght@400;700&display=swap"/>
  <style>${CSS}</style>
</head>
<body>
  ${sections.join('\n')}
  ${renderFooter({ generatedAt, clientId, brief, websiteUrl })}
</body>
</html>`;
}

module.exports = { renderBriefHtml };
