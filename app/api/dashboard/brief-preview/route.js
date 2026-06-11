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

function renderMarketingBriefHtml({ marketingBrief, clientName, websiteUrl, generatedAt, clientId, userEmail, tier, watchlistKols = [], weather = null, moduleBriefs = [], auditMockupUrl = null, company = null, researchConfig = null, strategyData = null, signalsCore = [] }) {
  const content = marketingBrief?.content || {};
  const agentData = marketingBrief?.scoutBrief?.agentData || {};
  const opportunities = agentData?.viralOpportunities?.opportunities || marketingBrief?.contentOpportunities || [];
  const kols = agentData?.kolActivity || [];
  const trends = agentData?.categoryTrends || [];
  const competitors = agentData?.competitorIntel || [];
  const redditSignals = agentData?.redditSignals || [];
  const localDemandSignals = agentData?.localDemandSignals || [];
  const brandMentions = agentData?.brandMentions || [];
  const headline = marketingBrief?.headline || 'Founder marketing brief';
  const scoutBrief = marketingBrief?.scoutBrief?.humanBrief || 'No Scout brief text was stored for this run.';
  const guardian = marketingBrief?.guardianFlags || null;
  const generated = generatedAt || marketingBrief?.generatedAtIso || new Date().toISOString();
  const generatedDt = new Date(generated);
  const when = generatedDt.toISOString().slice(0, 10);
  const tierLabel = tier === 'paid' ? 'Recurring · Paid' : 'One-time · Free';
  // The cover h1 / priority pull use the run date+time as the oversized
  // editorial mark — not the long headline text (which lives in .sub /
  // stat-rows below). Two lines: MM/DD/YY, then time under it.
  const mm = String(generatedDt.getMonth() + 1).padStart(2, '0');
  const dd = String(generatedDt.getDate()).padStart(2, '0');
  const yy = String(generatedDt.getFullYear()).slice(-2);
  const headlineDateLines = [
    `${mm}/${dd}/${yy}`,
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

  // Market Signals: KOL activity + category trends (sourced from web/X
  // searches) + the intake pipeline's own core market signals card.
  const marketSignalRows = [
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
    ...compactList(signalsCore, (item) => buildRow({
      label: item.label || item.topic || item.title || 'Intake signal',
      value: item.summary || item.detail || item.whyNow || '',
      url: item.url || '',
      profileUrl: '',
      platform: item.source || 'site intake',
    }), 4),
  ];

  // ── Card roll-up helpers — every configured/derived card gets a row; empty
  // cards state it explicitly instead of disappearing. ──
  const kicker = (text) => `<div class="mono" style="font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:6px">${esc(text)}</div>`;
  const valRow = (k, vHtml) => `<div class="stat-row"><div class="k">${esc(k)}</div><div class="v">${vHtml}</div></div>`;
  const naRow = (k, hint) => valRow(k, `<span style="opacity:.55">${esc(hint)}</span>`);
  const textOr = (k, v, hint) => (String(v || '').trim() ? valRow(k, esc(String(v).trim())) : naRow(k, hint));
  const listOr = (k, list, hint) => {
    const vals = (Array.isArray(list) ? list : []).map((x) => String(x || '').trim()).filter(Boolean);
    return vals.length ? valRow(k, esc(vals.slice(0, 12).join(' · '))) : naRow(k, hint);
  };

  // Company Brief — business model, market category, positioning, tone,
  // founder Q&A, company brain, team conversations.
  const bo = company?.brandOverview || {};
  const tone = company?.brandTone || {};
  const qa = company?.onboardingSummary || null;
  const kbSources = Array.isArray(company?.knowledgeBaseSources) ? company.knowledgeBaseSources : [];
  const toneLine = [tone.primary, tone.secondary, ...(Array.isArray(tone.tags) ? tone.tags : [])].filter(Boolean).join(' · ');
  const companyBriefSection = `
  <section class="page">
    <div class="sec-num">CO</div>
    ${kicker('Company Brief')}
    <h2 class="headline">Company<br/>Foundation.</h2>
    <div class="card">
      ${textOr('Headline', bo.headline, 'Not captured — rerun website intake.')}
      ${textOr('Summary', bo.summary, 'Not captured — rerun website intake.')}
      ${textOr('Business model', bo.businessModel, 'Not set — fill in the Business Model card.')}
      ${textOr('Market category', bo.industry, 'Not set — fill in the Market Category card.')}
      ${textOr('Positioning', bo.positioning, 'Not captured this run.')}
      ${textOr('Target audience', bo.targetAudience, 'Not captured this run.')}
      ${textOr('Brand tone', toneLine, 'Not captured — run the brand system.')}
      ${textOr('Writing style', tone.writingStyle, 'Not captured this run.')}
      ${qa ? valRow('Founder Q&A', esc(`${qa.answeredCount ?? 0} of ${qa.total ?? 10} answered${qa.completedAt ? ' — complete' : ''}`)) : naRow('Founder Q&A', 'Not started — answer the onboarding survey.')}
      ${kbSources.length
        ? valRow('Company brain', esc(`${kbSources.length} source${kbSources.length === 1 ? '' : 's'} — ${kbSources.slice(0, 3).map((s) => s?.title || s?.itemTitle || 'item').join(' · ')}`))
        : naRow('Company brain', 'No knowledge uploaded — add docs to the Company Brain card.')}
      ${company?.conversationItemCount
        ? valRow('Team conversations', esc(`${company.conversationItemCount} item${company.conversationItemCount === 1 ? '' : 's'} digested into this brief`))
        : naRow('Team conversations', 'None digested — paste a team conversation to fold it in.')}
    </div>
  </section>`;

  // Research Parameters — the Scout configuration cards (search terms,
  // competitors, watchlist, platforms, focus) that produced this brief.
  const rc = researchConfig || {};
  const platformList = Array.isArray(rc.sourcePlatforms)
    ? rc.sourcePlatforms
    : rc.sourcePlatforms && typeof rc.sourcePlatforms === 'object'
      ? Object.entries(rc.sourcePlatforms).filter(([, v]) => v).map(([k]) => k)
      : [];
  const customSearches = Array.isArray(rc.searches) ? rc.searches.filter((s) => s?.query) : [];
  const researchBriefSection = `
  <section class="page">
    <div class="sec-num">RP</div>
    ${kicker('Research Brief')}
    <h2 class="headline">Search<br/>Parameters.</h2>
    <div class="card">
      ${listOr('Brand keywords', rc.brandKeywords, 'Not set — generated on next intake run.')}
      ${listOr('Category terms', rc.categoryTerms, 'Not set — generated on next intake run.')}
      ${listOr('Competitors watched', rc.competitors, 'None configured — add competitors to sharpen the Competitor Brief.')}
      ${listOr('Watchlist accounts', rc.kols, 'None configured — add handles to the KOL Signals card.')}
      ${listOr('Platforms searched', platformList, 'Defaults in use — web, X, Reddit.')}
      ${textOr('Research focus', rc.sourceFocus, 'Not set — add focus instructions on the Research Focus card.')}
      ${customSearches.length
        ? valRow('Custom searches', esc(customSearches.slice(0, 6).map((s) => s.label || s.query).join(' · ')))
        : naRow('Custom searches', 'None — Scout builds its own search plan.')}
      ${listOr('Local signals', rc.localSignals, 'None configured.')}
      ${Array.isArray(rc.events) && rc.events.length
        ? valRow('Saved events', esc(`${rc.events.length} feeding the Local Signals section`))
        : naRow('Saved events', 'None saved — search events from the Events card.')}
    </div>
  </section>`;

  // 30-Day Campaign — rolling strategy + posting rules + content angles.
  const s30 = strategyData?.strategy30 || null;
  const strat = strategyData?.strategy || null;
  const upcomingDays = Array.isArray(s30?.days) ? s30.days.slice(0, 7) : [];
  const angleList = Array.isArray(strat?.contentAngles)
    ? strat.contentAngles.map((a) => a?.angle || a?.label || (typeof a === 'string' ? a : '')).filter(Boolean)
    : [];
  const campaignSection = `
  <section class="page">
    <div class="sec-num">SC</div>
    ${kicker('Strategy Brief')}
    <h2 class="headline">30-Day<br/>Campaign.</h2>
    <div class="card">
      ${s30?.today ? valRow('Today', esc([s30.today.angle, s30.today.post].filter(Boolean).join(' — ').slice(0, 280))) : naRow('Today', 'Not generated yet — produced with each executive brief run.')}
      ${upcomingDays.length
        ? upcomingDays.map((d) => valRow(esc(d?.date || 'Day'), esc([d?.theme, d?.idea].filter(Boolean).join(' — ').slice(0, 200)))).join('')
        : naRow('Next 7 days', 'No rolling campaign yet — runs with each executive brief.')}
      ${textOr('Revision notes', s30?.revisionNotes, 'No revisions — first pass of the campaign.')}
      ${textOr('Posting approach', strat?.postStrategy?.approach, 'Not derived yet — set on the Custom Post Strategy card or rerun intake.')}
      ${listOr('Content angles', angleList, 'Not derived yet — rerun website intake.')}
    </div>
  </section>`;

  // Competitor Snapshot: competitor intel from web search
  const competitorRows = compactList(competitors, (item) => buildRow({
    label: item.competitor || 'Competitor',
    value: item.finding || item.impact || '',
    url: item.url || '',
    profileUrl: '',
    platform: '',
  }), 8);

  // Local Signals: Reddit signals + local demand signals + brand mentions from Reddit/web
  const redditLocalRows = [
    ...compactList(redditSignals, (item) => buildRow({
      label: item.subreddit ? `r/${item.subreddit}` : 'Reddit',
      value: [item.summary, item.actionableTakeaway].filter(Boolean).join(' — '),
      url: item.url || '',
      profileUrl: '',
      platform: 'Reddit',
    }), 5),
    ...compactList(localDemandSignals, (item) => buildRow({
      label: item.signal || item.topic || item.title || 'Local signal',
      value: item.insight || item.detail || item.summary || '',
      url: item.url || '',
      profileUrl: '',
      platform: item.source || 'Local',
    }), 8),
    ...compactList(
      brandMentions.filter((m) => /reddit\.com/i.test(m.url || '') || /reddit/i.test(m.source || '')),
      (item) => buildRow({
        label: item.author || 'Reddit mention',
        value: item.content || item.summary || '',
        url: item.url || '',
        profileUrl: '',
        platform: 'Reddit',
      }),
      3,
    ),
  ];

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
    <h2 class="headline">Local<br/>Weather.</h2>
    <div class="card">
      <div class="stat-row"><div class="k">${esc(weather.today.name)}</div><div class="v">${esc(weather.today.short)} · ${esc(String(weather.today.temp))}°${esc(weather.today.unit)}${weather.today.wind ? ` · wind ${esc(weather.today.wind)}` : ''}</div></div>
      ${weather.threeDayLine ? `<div class="stat-row"><div class="k">3-Day outlook</div><div class="v">${esc(weather.threeDayLine)}</div></div>` : ''}
    </div>
  </section>` : '';

  // Module roll-up — every intake card result compiled into the executive
  // brief, divided into the brief types they belong to: Performance Brief
  // (SEO/perf, agent readiness) and Creative Brief (device rendering, share
  // card, design system, design evaluation). Failed or absent modules are
  // named explicitly — never silently omitted.
  const auditItems = Array.isArray(moduleBriefs) ? moduleBriefs : [];
  const SECTION_BY_MODULE = {
    'seo-performance': 'performance',
    'agent-readiness': 'performance',
    'multi-device-view': 'creative',
    'social-preview': 'creative',
    'style-guide': 'creative',
    'design-evaluation': 'creative',
  };
  const sectionOf = (b) => b.section || SECTION_BY_MODULE[b.moduleId] || 'performance';
  // The Performance/Creative Brief sections ALWAYS render. When no module
  // data exists for this run (older runs, refresh skipped), every expected
  // module is named with an explicit "not captured" row — gaps are stated,
  // never silently omitted.
  const DEFAULT_MODULE_TITLES = {
    'seo-performance': 'SEO + Performance',
    'agent-readiness': 'AI Agent Readiness',
    'multi-device-view': 'Cross-Device Layouts',
    'social-preview': 'Social Share Card',
    'style-guide': 'Brand Snapshot',
    'design-evaluation': 'Design Evaluation',
  };
  const presentModuleIds = new Set(auditItems.map((b) => b.moduleId));
  const effectiveAuditItems = [
    ...auditItems,
    ...Object.keys(DEFAULT_MODULE_TITLES)
      .filter((id) => !presentModuleIds.has(id))
      .map((id) => ({
        moduleId: id,
        title: DEFAULT_MODULE_TITLES[id],
        section: SECTION_BY_MODULE[id],
        status: 'missing',
        summaryLine: 'Not captured this run — press RUN on the Executive Daily Brief card to refresh site data.',
        stats: [],
        highlights: [],
        findings: [],
      })),
  ];
  const perfItems = effectiveAuditItems.filter((b) => sectionOf(b) === 'performance');
  const creativeItems = effectiveAuditItems.filter((b) => sectionOf(b) === 'creative');

  const renderAuditRow = (b) => {
    if (b.status === 'failed' || b.status === 'missing') {
      return `<div class="stat-row">
        <div class="k">${esc(b.title || b.moduleId || 'Module')}</div>
        <div class="v"><span style="color:#b42318;font-weight:600">✗ ${b.status === 'failed' ? 'Failed to retrieve results this run' : 'Did not run this pass'}</span><br/><span style="font-size:12px;opacity:.75">${esc(b.summaryLine || '')}</span></div>
      </div>`;
    }
    return `<div class="stat-row">
      <div class="k">${esc(b.title || b.moduleId || 'Module')}</div>
      <div class="v">${esc(b.summaryLine || '')}${
        (b.stats || []).length
          ? `<br/><span class="mono" style="font-size:11px;letter-spacing:.04em;opacity:.75">${b.stats.map((s) => `${esc(s.k)} ${esc(s.v)}`).join(' · ')}</span>`
          : ''
      }${
        (b.highlights || []).length
          ? b.highlights.map((h) => `<span style="display:block;font-size:12px;line-height:1.5;opacity:.8">+ ${esc(h)}</span>`).join('')
          : ''
      }${
        (b.findings || []).length
          ? b.findings.map((f) => `<span style="display:block;font-size:12px;line-height:1.5;opacity:.8">— ${esc((f.severity || 'info').toUpperCase())} · ${esc(f.label || '')}${f.detail ? `: ${esc(f.detail)}` : ''}</span>`).join('')
          : ''
      }</div>
    </div>`;
  };

  const deviceBrief = auditItems.find((b) => b.moduleId === 'multi-device-view');
  const shots = deviceBrief?.screenshots || {};
  const shotKeys = ['desktop', 'tablet', 'mobile'].filter((k) => shots[k]);
  const screenshotStrip = shotKeys.length ? `
    <div class="card" style="padding:10px;margin-bottom:14px">
      <div style="display:flex;gap:8px;align-items:flex-start">
        ${shotKeys.map((k) => `<figure style="margin:0;flex:1;min-width:0"><img src="${esc(shots[k])}" alt="${esc(k)} viewport screenshot" style="display:block;width:100%;height:auto;border:1px solid rgba(0,0,0,.08)"/><figcaption class="mono" style="font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft);margin-top:4px">${esc(k)}</figcaption></figure>`).join('')}
      </div>
    </div>` : '';
  const mockupSrc = deviceBrief?.mockupUrl || auditItems.find((b) => b.mockupUrl)?.mockupUrl || auditMockupUrl || null;

  const performanceBriefSection = perfItems.length ? `
  <section class="page">
    <div class="sec-num">PB</div>
    ${kicker('Performance Brief')}
    <h2 class="headline">Site<br/>Performance.</h2>
    ${screenshotStrip}
    <div class="card">
      ${perfItems.map(renderAuditRow).join('')}
    </div>
  </section>` : '';

  const creativeBriefSection = creativeItems.length ? `
  <section class="page">
    <div class="sec-num">CB</div>
    ${kicker('Creative Brief')}
    <h2 class="headline">Creative<br/>System.</h2>
    ${mockupSrc ? `<div class="card" style="padding:0;overflow:hidden;margin-bottom:14px"><img src="${esc(mockupSrc)}" alt="Homepage rendered across devices" style="display:block;width:100%;height:auto"/></div>` : ''}
    <div class="card">
      ${creativeItems.map(renderAuditRow).join('')}
    </div>
  </section>` : '';

  // Watchlist — every configured account, name-for-name, with this run's activity.
  const watchlist = buildWatchlist(watchlistKols, agentData);
  const watchlistSection = watchlist.length ? `
  <section class="page">
    <div class="sec-num">W</div>
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
  <style>${BRIEF_CSS}
  /* Primary "send to my email" CTA inside the cover title-stack, above the
     headline. Kept inline here (not in brief-css.cjs) so it ships with the
     markup and isn't subject to the .cjs require-cache in dev. */
  @property --cta-angle{syntax:'<angle>';initial-value:0deg;inherits:false}
  @keyframes briefCtaSpin{to{--cta-angle:360deg}}
  /* Pinned to the iframe viewport — stays in place while the brief scrolls. */
  .cap-brief-email-cta-row{position:fixed;top:40px;left:var(--gutter);z-index:50;display:flex;margin:0}
  .cap-brief-email-cta{
    position:relative;isolation:isolate;display:inline-flex;align-items:center;gap:.5rem;
    padding:.5rem .75rem;border:none;border-radius:999px;cursor:pointer;line-height:1;
    font-family:"Space Grotesk",sans-serif;font-weight:700;letter-spacing:.01em;
    font-size:clamp(13px,1.4vw,15px);color:#fff;white-space:nowrap;
    background:linear-gradient(175deg,rgba(255,255,255,.18) 0%,rgba(255,255,255,0) 52%),linear-gradient(135deg,hsl(185,100%,45%) 0%,hsl(262,100%,55%) 52%,hsl(314,100%,50%) 100%);
    box-shadow:0 2px 8px rgba(0,0,0,.2),inset 0 1px 0 rgba(255,255,255,.28),inset 0 -1px 0 rgba(0,0,0,.1);
  }
  .cap-brief-email-cta::before{
    content:'';position:absolute;inset:0;border-radius:inherit;padding:2px;
    background:conic-gradient(from var(--cta-angle),transparent 0deg,transparent 180deg,hsla(185,100%,58%,.12) 200deg,hsla(200,100%,62%,.35) 225deg,hsla(225,100%,64%,.6) 250deg,hsla(250,100%,66%,.78) 275deg,hsla(275,100%,66%,.88) 300deg,hsla(300,100%,68%,.94) 322deg,hsla(320,80%,80%,.97) 338deg,rgba(255,255,255,1) 350deg,transparent 358deg);
    -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
    -webkit-mask-composite:xor;mask-composite:exclude;
    animation:briefCtaSpin 2.4s linear infinite;pointer-events:none;
  }
  .cap-brief-email-cta img{width:1.75rem;height:1.75rem;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.35);flex-shrink:0;display:block}
  .cap-brief-email-cta .arrow{font-size:.7rem;opacity:.75;margin-left:.1rem}
  @media print{.cap-brief-email-cta-row{display:none}}
  /* Tighten vertical spacing between the top (cover) elements only. */
  /* CTA is now fixed (out of flow) — restore the space it used to take above
     the headline so the cover sits where it did before. */
  .cover .title-stack{margin-top:56px}
  .cover .headline{margin:0 0 10px}
  .cover .sub{margin:0 0 16px}
  .cover .meta{margin-top:18px;padding-top:14px;gap:14px 32px}
  .cover .marquee{margin-top:20px}
  </style>
</head>
<body>
  <section class="page cover">
    <div class="sec-num">00</div>
    <div class="title-stack">
      <div class="cap-brief-email-cta-row">
        <button type="button" id="brief-email-cta" class="cap-brief-email-cta">
          <img src="/img/profile2_400x400.png?v=1774582808" alt="" aria-hidden="true" />
          SEND TO MY EMAIL
          <span class="arrow" aria-hidden="true">↗</span>
        </button>
      </div>
      <h1 class="headline">${headlineDateLines}</h1>
    </div>
    <p class="sub">${esc(headline)}</p>
    <div class="meta">
      <div><div class="k">Date</div><div class="v">${esc(dateLine)}</div></div>
      <div><div class="k">Site</div><div class="v">${esc(hostnameOf(websiteUrl) || '—')}</div></div>
      <div><div class="k">Brief Title</div><div class="v">Daily Executive Brief</div></div>
      <div><div class="k">Account</div><div class="v mono" style="font-size:13px">${esc(userEmail || '—')}</div></div>
    </div>
    <div class="marquee"><span>${esc(brandUpper)} • ${esc(brandUpper)} • ${esc(brandUpper)} • ${esc(brandUpper)} • ${esc(brandUpper)}</span></div>
  </section>

  <section class="page">
    <div class="sec-num">01</div>
    ${kicker('Marketing Brief')}
    <h2 class="headline">What<br/>Scout<br/>Found.</h2>
    <div class="card" style="white-space:pre-wrap;font-family:'Space Grotesk';font-size:16px;line-height:1.6;color:#181818">${linkify(scoutBrief)}</div>
  </section>
${companyBriefSection}
${performanceBriefSection}
${creativeBriefSection}
${researchBriefSection}
${weatherSection}
  <section class="page">
    <div class="sec-num">02</div>
    ${kicker('Marketing Brief')}
    <h2 class="headline">Market<br/>Signals.</h2>
    <div class="card">
      ${renderRows(marketSignalRows, 'No market signals surfaced this run.')}
    </div>
  </section>
${watchlistSection}
  <section class="page">
    <div class="sec-num">03</div>
    ${kicker('Competitor Brief')}
    <h2 class="headline">Competitor<br/>Snapshot.</h2>
    <div class="card">
      ${renderRows(competitorRows, 'No competitor signals surfaced this run.')}
    </div>
  </section>

  <section class="page">
    <div class="sec-num">04</div>
    ${kicker('Marketing Brief')}
    <h2 class="headline">Local<br/>Signals.</h2>
    <div class="card">
      ${renderRows(redditLocalRows, 'No Reddit or local signals for this run.')}
    </div>
  </section>

  <section class="page">
    <div class="sec-num">05</div>
    ${kicker('Marketing Brief')}
    <h2 class="headline">Viral<br/>Windows.</h2>
    <div class="card">
      ${renderRows(opportunityRows, 'No viral windows captured for this run.')}
    </div>
  </section>

  <section class="page">
    <div class="sec-num">06</div>
    ${kicker('Strategy Brief')}
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
${campaignSection}
  <footer>
    <span>Generated · ${esc(new Date(generated).toISOString().slice(0, 19).replace('T', ' '))}</span>
    ${clientId ? `<span>Client · ${esc(clientId)}</span>` : ''}
    <span>Marketing Brief · Vol. 01${clientName ? ' · ' + esc(clientName) : ''}</span>
  </footer>
  <script>
    (function () {
      var b = document.getElementById('brief-email-cta');
      if (!b) return;
      b.addEventListener('click', function () {
        try { window.parent.postMessage({ type: 'brief-open-subscribe' }, '*'); } catch (e) {}
      });
    })();
  </script>
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

  // Client config: watchlist handles, research parameters, founder Q&A,
  // conversation intake — every configured card feeds the brief.
  let watchlistKols = [];
  let researchConfig = null;
  let onboardingAnswers = null;
  let conversationItemCount = 0;
  try {
    const cfgSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    const cfgData = cfgSnap.data() || {};
    const cfgKols = cfgData?.marketingBriefConfig?.kols;
    watchlistKols = Array.isArray(cfgKols) ? cfgKols : [];
    researchConfig = cfgData?.marketingBriefConfig || null;
    onboardingAnswers = cfgData?.onboardingAnswers || null;
    conversationItemCount = Array.isArray(cfgData?.conversationIntake?.items)
      ? cfgData.conversationIntake.items.length
      : 0;
  } catch { /* no config — sections render their explicit empty states */ }

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

  // Card roll-up payload — every dashboard card's data feeds the brief.
  const onboardingSummary = onboardingAnswers
    ? {
        total: 10,
        answeredCount: Object.values(onboardingAnswers.answers || {}).filter((a) => a && !a.skipped && a.value != null).length,
        completedAt: onboardingAnswers.completedAt || null,
      }
    : null;
  const cardRollup = {
    moduleBriefs: dash.moduleBriefs?.items || [],
    auditMockupUrl: dash.artifacts?.homepageDeviceMockup?.downloadUrl || null,
    company: {
      brandOverview: dash.snapshot?.brandOverview || null,
      brandTone: dash.snapshot?.brandTone || null,
      onboardingSummary,
      knowledgeBaseSources: dash.knowledgeBase?.sources || [],
      conversationItemCount,
    },
    researchConfig,
    strategyData: { strategy30: dash.strategy30 || null, strategy: dash.strategy || null },
    signalsCore: Array.isArray(dash.signals?.core) ? dash.signals.core : [],
  };

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
      ...cardRollup,
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
      ...cardRollup,
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
