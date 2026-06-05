import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getDashboardBootstrap } = require('../../../../api/_lib/client-provisioning.cjs');
const { renderBriefHtml } = require('../../../../features/scout-intake/brief-renderer');
const { BRIEF_CSS } = require('../../../../features/scout-intake/brief-css.cjs');
const { validatePostUrl } = require('../../../../features/not-the-rug-brief/post-url-validator.cjs');
const { buildWatchlist } = require('../../../../features/intelligence/_brief-intel.js');
const { getClientWeather } = require('../../../../features/intelligence/_weather.js');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type':  'text/html; charset=utf-8',
      // Prevent browser / Next.js from serving a stale render after a new
      // pipeline run completes.
      'cache-control': 'no-store, max-age=0',
      'pragma':        'no-cache',
    },
  });
}

function errorPage(status, message) {
  return htmlResponse(
    `<!doctype html><meta charset="utf-8"><title>${message}</title><pre style="font:14px/1.5 system-ui;padding:24px;">${message}</pre>`,
    status
  );
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function compactList(items, pick, limit = 5) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      if (typeof pick === 'function') return pick(item);
      return item;
    })
    .filter(Boolean)
    .slice(0, limit);
}

// Escape free text and convert bare URLs into clickable links — but ONLY
// when the URL passes the canonical post-permalink validator. Profile pages,
// homepages, and search URLs are emitted as dim, unstyled text so they can
// still be read but cannot be confused with a citable source.
function linkify(text) {
  if (!text) return '';
  const urlRe = /\bhttps?:\/\/[^\s<>"']+/g;
  const t = String(text);
  let out = '';
  let last = 0;
  let m;
  while ((m = urlRe.exec(t)) !== null) {
    out += esc(t.slice(last, m.index));
    const raw = m[0];
    const trailing = raw.match(/[.,;:!?)\]]+$/);
    const url = trailing ? raw.slice(0, -trailing[0].length) : raw;
    if (validatePostUrl(url)) {
      out += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
    } else {
      out += `<span style="color:var(--ink-soft);text-decoration:line-through;text-decoration-color:rgba(0,0,0,.2)" title="Not a post permalink — no direct source to share">${esc(url)}</span>`;
    }
    if (trailing) out += esc(trailing[0]);
    last = m.index + raw.length;
  }
  out += esc(t.slice(last));
  return out;
}

const PLATFORM_LABELS = {
  'x.com': 'X',
  'twitter.com': 'Twitter',
  't.co': 'X',
  'reddit.com': 'Reddit',
  'instagram.com': 'Instagram',
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'tiktok.com': 'TikTok',
  'news.ycombinator.com': 'Hacker News',
  'linkedin.com': 'LinkedIn',
};

// Render a source URL as a styled anchor labeled with the platform / hostname.
function renderSourceLink(url) {
  if (!url) return '';
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = String(url); }
  const label = PLATFORM_LABELS[host] || host;
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft);text-decoration:underline;text-underline-offset:3px;word-break:break-word">↗ ${esc(label)}</a>`;
}

function splitLines(text, maxLines = 3) {
  if (!text) return ['Daily', 'Market', 'Brief.'];
  const t = String(text).trim();
  if (t.includes('\n')) return t.split(/\n+/).slice(0, maxLines);
  const words = t.split(/\s+/);
  if (words.length <= maxLines) return words;
  const perLine = Math.ceil(words.length / maxLines);
  const lines = [];
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine).join(' '));
  return lines.slice(0, maxLines);
}

function hostnameOf(url) {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url); }
}

function renderMarketingBriefHtml({ marketingBrief, clientName, websiteUrl, generatedAt, clientId, userEmail, tier, watchlistKols = [], weather = null }) {
  const content = marketingBrief?.content || {};
  const agentData = marketingBrief?.scoutBrief?.agentData || {};
  const opportunities = agentData?.viralOpportunities?.opportunities || marketingBrief?.contentOpportunities || [];
  const kols = agentData?.kolActivity || [];
  const trends = agentData?.categoryTrends || [];
  const competitors = agentData?.competitorIntel || [];
  const headline = marketingBrief?.headline || 'Founder marketing brief';
  const scoutBrief = marketingBrief?.scoutBrief?.humanBrief || 'No Scout brief text was stored for this run.';
  const guardian = marketingBrief?.guardianFlags || null;
  const generated = generatedAt || marketingBrief?.generatedAtIso || new Date().toISOString();
  const generatedDt = new Date(generated);
  const when = generatedDt.toISOString().slice(0, 10);
  const tierLabel = tier === 'paid' ? 'Recurring · Paid' : 'One-time · Free';
  // The cover h1 / priority pull use the run date+time as the oversized
  // editorial mark — not the long headline text (which lives in .sub /
  // stat-rows below). Three lines: month+day, year, time.
  const headlineDateLines = [
    generatedDt.toLocaleString('en-US', { month: 'short', day: 'numeric' }).toUpperCase(),
    String(generatedDt.getFullYear()),
    generatedDt.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' }),
  ].map(esc).join('<br/>');
  const runTimestamp = generatedDt.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const dateLine = when.replace(/-/g, ' · ');
  const brandUpper = String(clientName || 'BRIEF').toUpperCase();
  const guardianText = guardian?.readyToPublish === undefined
    ? 'Needs review'
    : guardian.readyToPublish ? 'Ready to publish' : 'Needs review';

  // Coerce raw items into the row shape used by the renderer, then validate
  // each item.url at the boundary. Items whose url is missing or fails
  // validation keep the finding but get deprioritized into the background
  // pass — the brief never shows a clickable link to a profile/homepage.
  const buildRow = (raw) => ({
    ...raw,
    url: validatePostUrl(raw.url) ? raw.url : '',
  });

  const signalRows = [
    ...compactList(kols, (item) => buildRow({
      label: item.name || item.author || 'KOL',
      value: item.content || item.summary || item.sentiment || '',
      url: item.url || '',
      profileUrl: item.profileUrl || '',
      platform: item.platform || '',
    }), 4),
    ...compactList(trends, (item) => buildRow({
      label: item.trend || item.topic || 'Market trend',
      value: item.detail || item.relevance || '',
      url: item.url || '',
      profileUrl: '',
      platform: item.source || '',
    }), 4),
    ...compactList(competitors, (item) => buildRow({
      label: item.competitor || 'Competitor',
      value: item.finding || item.impact || '',
      url: item.url || '',
      profileUrl: '',
      platform: '',
    }), 4),
  ].slice(0, 8);

  const opportunityRows = compactList(opportunities, (item) => buildRow({
    label: item.conversation || item.topic || item.title || 'Opportunity',
    value: item.injectionAngle || item.whyNow || item.summary || '',
    url: item.url || '',
    profileUrl: item.profileUrl || '',
    platform: item.source || '',
  }), 6);

  // Partition: items with a real post permalink are the primary signals,
  // items without are background-only — same data, smaller treatment.
  const partition = (rows) => ({
    primary: rows.filter((r) => r.url),
    background: rows.filter((r) => !r.url),
  });

  const renderPrimaryRow = (item) => {
    const platformLabel = (() => {
      try { const h = new URL(item.url).hostname.replace(/^www\./, ''); return PLATFORM_LABELS[h] || h; }
      catch { return ''; }
    })();
    const postLink = `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" style="font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft);text-decoration:underline;text-underline-offset:3px;word-break:break-word">↗ View post${platformLabel ? ` on ${esc(platformLabel)}` : ''}</a>`;
    const profileLink = item.profileUrl ? renderSourceLink(item.profileUrl).replace('↗ ', '↗ Profile · ') : '';
    const footer = [postLink, profileLink].filter(Boolean).join(' · ');
    return `
      <div class="stat-row">
        <div class="k">${esc(item.label)}</div>
        <div class="v">
          ${linkify(item.value || '—')}
          ${footer ? `<div style="margin-top:8px">${footer}</div>` : ''}
        </div>
      </div>
    `;
  };

  const renderBackgroundRow = (item) => `
    <li style="display:grid;grid-template-columns:120px 1fr;gap:12px;padding:8px 0;border-bottom:1px dashed rgba(0,0,0,.08);font-size:13px;line-height:1.4;color:var(--ink-soft)">
      <span class="mono" style="font-size:10px;letter-spacing:.2em;text-transform:uppercase">${esc(item.label)}</span>
      <span>${linkify(item.value || '—')}${item.platform ? ` <span class="mono" style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;opacity:.8;margin-left:6px">${esc(item.platform)}</span>` : ''}</span>
    </li>
  `;

  const renderRows = (rows, emptyLabel) => {
    if (!rows.length) {
      return `<div class="stat-row"><div class="k">${esc(emptyLabel)}</div><div class="v">—</div></div>`;
    }
    const { primary, background } = partition(rows);
    const primaryHtml = primary.length
      ? primary.map(renderPrimaryRow).join('')
      : `<div class="stat-row"><div class="k">No grounded posts</div><div class="v">Scout did not surface a citable post permalink for this run. Background notes below.</div></div>`;
    const backgroundHtml = background.length
      ? `<div style="margin-top:18px;padding-top:14px;border-top:1px dashed rgba(0,0,0,.12)">
           <div class="mono" style="font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:8px">Background only · no direct link</div>
           <ul style="list-style:none;margin:0;padding:0">${background.map(renderBackgroundRow).join('')}</ul>
         </div>`
      : '';
    return primaryHtml + backgroundHtml;
  };

  const xPost = content.x_post || content.primary_post || content.post || '';
  const threadOpener = content.x_thread_opener || content.thread_opener || '';
  const contentAngle = content.content_angle || content.angle || '';

  const weatherSection = weather?.today ? `
  <section class="page">
    <div class="sec-num">WX</div>
    <div class="eyebrow"><span class="dot"></span><span>MB · Local Weather</span><span>${esc(weather.place || '')}</span></div>
    <h2 class="headline">Local<br/>Weather.</h2>
    <div class="card">
      <div class="stat-row"><div class="k">${esc(weather.today.name)}</div><div class="v">${esc(weather.today.short)} · ${esc(String(weather.today.temp))}°${esc(weather.today.unit)}${weather.today.wind ? ` · wind ${esc(weather.today.wind)}` : ''}</div></div>
      ${weather.threeDayLine ? `<div class="stat-row"><div class="k">3-Day outlook</div><div class="v">${esc(weather.threeDayLine)}</div></div>` : ''}
    </div>
  </section>` : '';

  // Watchlist — every configured account, name-for-name, with this run's activity.
  const watchlist = buildWatchlist(watchlistKols, agentData);
  const watchlistSection = watchlist.length ? `
  <section class="page">
    <div class="sec-num">W</div>
    <div class="eyebrow"><span class="dot"></span><span>MB · Watchlist</span><span>Name for name</span></div>
    <h2 class="headline">Watch<br/>list.</h2>
    <div class="card">
      ${watchlist.map((w) => `<div class="stat-row"><div class="k">${esc(w.handle)}</div><div class="v">${
        w.found
          ? w.activity.map((a) => linkify(a.text || '')).join('<br/>')
          : '<span style="opacity:.55">No activity surfaced this run.</span>'
      }</div></div>`).join('')}
    </div>
  </section>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Marketing Brief · Vol. 01${headline ? ` · ${esc(headline)}` : ''}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@300..700&family=Space+Mono:wght@400;700&display=swap"/>
  <style>${BRIEF_CSS}</style>
</head>
<body>
  <section class="page cover">
    <div class="sec-num">00</div>
    <div class="eyebrow">
      <span class="dot"></span>
      <span>Marketing Brief · Vol. 01</span>
      ${clientId ? `<span>Client · ${esc(String(clientId).slice(0, 8))}</span>` : ''}
      <span>Tier · ${esc(tierLabel.split(' · ')[0])}</span>
    </div>
    <div class="title-stack">
      <h1 class="headline">${headlineDateLines}</h1>
    </div>
    <p class="sub">${esc(headline)}</p>
    <div class="meta">
      <div><div class="k">Date</div><div class="v">${esc(dateLine)}</div></div>
      <div><div class="k">Site</div><div class="v">${esc(hostnameOf(websiteUrl) || '—')}</div></div>
      <div><div class="k">Pipeline</div><div class="v">Scout → Scribe → Guardian</div></div>
      <div><div class="k">Account</div><div class="v mono" style="font-size:13px">${esc(userEmail || '—')}</div></div>
    </div>
    <div class="marquee"><span>${esc(brandUpper)} • ${esc(brandUpper)} • ${esc(brandUpper)} • ${esc(brandUpper)} • ${esc(brandUpper)}</span></div>
  </section>

  <section class="page">
    <div class="sec-num">01</div>
    <div class="eyebrow"><span class="dot"></span><span>MB · Scout Intel</span><span>Live · Synthesized</span></div>
    <h2 class="headline">What<br/>Scout<br/>Found.</h2>
    <div class="card" style="white-space:pre-wrap;font-family:'Space Grotesk';font-size:16px;line-height:1.6;color:#181818">${linkify(scoutBrief)}</div>
  </section>
${weatherSection}
  <section class="page">
    <div class="sec-num">02</div>
    <div class="eyebrow"><span class="dot"></span><span>MB · Market Signals</span><span>KOL · Trend · Competitor</span></div>
    <h2 class="headline">Market<br/>Signals.</h2>
    <div class="card">
      ${renderRows(signalRows, 'No structured signals stored for this run.')}
    </div>
  </section>
${watchlistSection}
  <section class="page">
    <div class="sec-num">03</div>
    <div class="eyebrow"><span class="dot"></span><span>MB · Viral Windows</span><span>Where To Enter</span></div>
    <h2 class="headline">Viral<br/>Windows.</h2>
    <div class="card">
      ${renderRows(opportunityRows, 'No viral windows captured for this run.')}
    </div>
  </section>

  <section class="page">
    <div class="sec-num">04</div>
    <div class="eyebrow"><span class="dot"></span><span>MB · Today's Move</span><span>Founder Ready</span></div>
    <h2 class="headline">Today's<br/>Move.</h2>
    <div class="brief-grid">
      <div>
        <div class="pull">${linkify(xPost || 'No post generated yet.')}</div>
      </div>
      <div class="card">
        <div class="stat-row"><div class="k">Format</div><div class="v">X Post</div></div>
        ${threadOpener ? `<div class="stat-row"><div class="k">Thread Opener</div><div class="v">${linkify(threadOpener)}</div></div>` : ''}
        ${contentAngle ? `<div class="stat-row"><div class="k">Angle</div><div class="v">${esc(contentAngle)}</div></div>` : ''}
        <div class="stat-row"><div class="k">Guardian</div><div class="v">${esc(guardianText)}</div></div>
        <div class="stat-row"><div class="k">Generated</div><div class="v">${esc(runTimestamp)}</div></div>
      </div>
    </div>
  </section>

  <footer>
    <span>Generated · ${esc(new Date(generated).toISOString().slice(0, 19).replace('T', ' '))}</span>
    ${clientId ? `<span>Client · ${esc(clientId)}</span>` : ''}
    <span>Marketing Brief · Vol. 01${clientName ? ' · ' + esc(clientName) : ''}</span>
  </footer>
</body>
</html>`;
}

/**
 * GET /api/dashboard/brief-preview
 *
 * Reads bootstrap (dashboard_state + intelligence) and re-renders through
 * the live brief-renderer.js. Lets you preview the current design against
 * the last run without re-running the pipeline.
 */
export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return errorPage(401, err instanceof Error ? err.message : 'Unauthorized.');
  }

  const bootstrap = await getDashboardBootstrap({ uid: decoded.uid, email: decoded.email, request });
  const clientId = bootstrap?.effectiveClientId || bootstrap?.userProfile?.clientId || null;
  const dash = bootstrap?.dashboardState || null;
  if (!clientId) return errorPage(404, 'No client record for user.');
  if (!dash) return errorPage(404, 'No dashboard_state for client — run the pipeline first.');

  // Configured watchlist handles (for the name-for-name Watchlist section).
  let watchlistKols = [];
  try {
    const cfgSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    const cfgKols = cfgSnap.data()?.marketingBriefConfig?.kols;
    watchlistKols = Array.isArray(cfgKols) ? cfgKols : [];
  } catch { /* no config — empty watchlist */ }

  let weather = null;
  try { weather = await getClientWeather(clientId); } catch { /* no weather */ }

  // Optional run-level detail (warnings, cost) from the latest brief_run.
  let runCostData = null;
  let runWarnings = 0;
  let runStyleGuideCost = null;
  let runScribeCost = null;
  if (dash.latestRunId) {
    try {
      const briefSnap = await fb.adminDb
        .collection('clients').doc(clientId)
        .collection('brief_runs').doc(dash.latestRunId)
        .get();
      if (briefSnap.exists) {
        const brun = briefSnap.data() || {};
        runCostData = brun.summary?.runCostData || null;
        runWarnings = Array.isArray(brun.warnings) ? brun.warnings.length : 0;
        runStyleGuideCost = brun.styleGuideCost || null;
        runScribeCost = brun.scribe?.cost || null;
      }
    } catch { /* non-fatal */ }
  }

  const marketingBrief = dash.marketingBrief || null;
  const preferMarketingBrief =
    Boolean(marketingBrief) &&
    (
      request.nextUrl?.searchParams?.get('type') === 'marketing' ||
      dash?.modules?.['marketing-brief']?.lastRunId === dash.latestRunId
    );
  if (preferMarketingBrief) {
    return htmlResponse(renderMarketingBriefHtml({
      marketingBrief,
      watchlistKols,
      weather,
      clientName: bootstrap?.client?.companyName || dash.clientName || clientId,
      websiteUrl: bootstrap?.client?.websiteUrl || null,
      generatedAt: marketingBrief.generatedAtIso || null,
      clientId,
      userEmail: bootstrap?.userProfile?.email || decoded?.email || null,
      tier: dash.tier || 'free',
    }));
  }

  const scribe = dash.scribe || null;
  if ((!scribe || !scribe.brief) && marketingBrief) {
    return htmlResponse(renderMarketingBriefHtml({
      marketingBrief,
      watchlistKols,
      weather,
      clientName: bootstrap?.client?.companyName || dash.clientName || clientId,
      websiteUrl: bootstrap?.client?.websiteUrl || null,
      generatedAt: marketingBrief.generatedAtIso || null,
      clientId,
      userEmail: bootstrap?.userProfile?.email || decoded?.email || null,
      tier: dash.tier || 'free',
    }));
  }

  if (!scribe || !scribe.brief) {
    return errorPage(
      404,
      'This run has no scribe output yet — re-run the pipeline after the Scribe stage was added.'
    );
  }

  const snapshot = dash.snapshot || null;
  const mockupUrl = dash.artifacts?.homepageDeviceMockup?.downloadUrl
    || dash.artifacts?.homepageScreenshot?.downloadUrl
    || null;

  const seoAudit = bootstrap?.intelligence?.dashboardSeoAudit ?? dash.seoAudit ?? null;
  const psiSummary = bootstrap?.intelligence?.psiSummary || null;

  const html = renderBriefHtml({
    brief:           scribe.brief,
    scribeCards:     scribe.cards || {},
    snapshot,
    signals:         dash.signals || null,
    strategy:        dash.strategy || null,
    outputsPreview:  dash.outputsPreview || null,
    siteMeta:        dash.siteMeta || null,
    styleGuide:      snapshot?.visualIdentity?.styleGuide || null,
    pagespeed:       seoAudit,
    psiSummary,
    mockupUrl,
    userContext:     null,
    runMeta: {
      pagesFetched: null,
      pageTypes:    [],
      thin:         null,
      warningCount: runWarnings,
      costs: {
        synth:      runCostData?.estimatedCostUsd ?? null,
        styleGuide: runStyleGuideCost?.estimatedCostUsd ?? null,
        scribe:     runScribeCost?.estimatedCostUsd ?? null,
      },
    },
    websiteUrl:  bootstrap?.client?.websiteUrl || null,
    clientId,
    userEmail:   bootstrap?.userProfile?.email || decoded?.email || null,
    generatedAt: new Date().toISOString(),
    tier:        dash.tier || 'free',
  });

  return htmlResponse(html);
}
