import { createRequire } from 'module';
import { readSocialQueue } from '../../../../features/social-posting/twitter-service.js';

const require = createRequire(import.meta.url);

/* Dev only: Next hot-reloads this ESM route, but Node's CJS require cache
   keeps stale copies of the brief modules — edits to them (or new exports
   like isBriefAllowed) don't show until a server restart. Evict the
   stateless brief/intel modules so each route reload requires fresh copies.
   Stateful singletons (firebase-admin, auth, client-provisioning) stay
   cached on purpose. */
if (process.env.NODE_ENV !== 'production') {
  const STALE_CJS = /(scout-intake[\\/](brief-sections\.cjs|brief-css\.cjs|brief-renderer\.js)|not-the-rug-brief[\\/]post-url-validator\.cjs|intelligence[\\/](_brief-intel|_weather)\.js)$/;
  for (const key of Object.keys(require.cache)) {
    if (STALE_CJS.test(key)) delete require.cache[key];
  }
}

const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getDashboardBootstrap } = require('../../../../api/_lib/client-provisioning.cjs');
const { renderBriefHtml } = require('../../../../features/scout-intake/brief-renderer');
const { BRIEF_CSS } = require('../../../../features/scout-intake/brief-css.cjs');
const { validatePostUrl } = require('../../../../features/not-the-rug-brief/post-url-validator.cjs');
const { buildWatchlist, projectBrief } = require('../../../../features/intelligence/_brief-intel.js');
const { getClientWeather } = require('../../../../features/intelligence/_weather.js');
const { getComposition, resolveBriefType, DEFAULT_BRIEF_TYPE, isBriefAllowed } = require('../../../../features/scout-intake/brief-sections.cjs');
const { renderPdfBuffer } = require('../../../../api/_lib/browserless.cjs');

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
      out += `<span style="color:var(--ink-soft);text-decoration:line-through;text-decoration-color:rgba(0,0,0,.2)">${esc(url)}</span>`;
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

function renderMarketingBriefHtml({ marketingBrief, clientName, websiteUrl, generatedAt, clientId, userEmail, tier, watchlistKols = [], weather = null, moduleBriefs = [], auditMockupUrl = null, studioVideoUrl = null, socialPreviewImageUrl = null, siteMeta = null, fullPageScreenshots = null, company = null, researchConfig = null, strategyData = null, signalsCore = [], socialQueue = [], briefType = DEFAULT_BRIEF_TYPE, coverSummary = null, previousRunAt = null, displayLabel = null }) {
  const content = marketingBrief?.content || {};
  const agentData = marketingBrief?.scoutBrief?.agentData || {};
  // Single source of truth: every signal array is derived from the shared
  // canonical projection (features/intelligence/_brief-intel.js → projectBrief),
  // the same one the daily-digest email consumes, so the two surfaces never
  // drift on which fields exist or how they're named. `agentData` above is still
  // read raw for buildWatchlist's per-handle matching (see below).
  const projected = projectBrief(marketingBrief) || {};
  const opportunities = projected.opportunities || [];
  const kols = projected.kols || [];
  const trends = projected.narratives || [];
  const competitors = projected.competitors || [];
  const redditSignals = projected.redditSignals || [];
  const localDemandSignals = projected.localDemandSignals || [];
  const brandMentions = projected.brandMentions || [];
  const headline = projected.headline || 'Founder marketing brief';
  const scoutBrief = projected.humanBrief || 'No Scout brief text was stored for this run.';
  const guardian = marketingBrief?.guardianFlags || null;
  const generated = generatedAt || marketingBrief?.generatedAtIso || new Date().toISOString();
  const generatedDt = new Date(generated);
  const when = generatedDt.toISOString().slice(0, 10);
  const tierLabel = tier === 'paid' ? 'Recurring · Paid' : 'One-time · Free';
  // The cover h1 uses the run date+time as the editorial mark — not the long
  // headline text (which lives in .sub / stat-rows below). Two small lines
  // under the brief name: MM/DD/YY, then the time beneath it. Pin to EST so the
  // date/time read the same regardless of server timezone (Vercel runs UTC).
  const BRIEF_TZ = 'America/New_York';
  const headlineDateLines = [
    generatedDt.toLocaleDateString('en-US', { timeZone: BRIEF_TZ, month: '2-digit', day: '2-digit', year: '2-digit' }),
    `${generatedDt.toLocaleString('en-US', { timeZone: BRIEF_TZ, hour: 'numeric', minute: '2-digit' })} EST`,
  ].map(esc).join('<br/>');
  const runTimestamp = generatedDt.toLocaleString('en-US', {
    timeZone: BRIEF_TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
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
      value: item.detail || item.content || item.summary || item.sentiment || '',
      url: item.url || '',
      profileUrl: item.profileUrl || '',
      platform: item.platform || '',
    }), Infinity),
    ...compactList(trends, (item) => buildRow({
      label: item.trend || item.topic || 'Market trend',
      value: item.detail || item.relevance || '',
      url: item.url || '',
      profileUrl: '',
      platform: item.source || '',
    }), Infinity),
    ...compactList(signalsCore, (item) => buildRow({
      label: item.label || item.topic || item.title || 'Intake signal',
      value: item.summary || item.detail || item.whyNow || '',
      url: item.url || '',
      profileUrl: '',
      platform: item.source || 'site intake',
    }), Infinity),
    ...compactList(brandMentions, (item) => buildRow({
      label: item.author || item.source || 'Brand mention',
      value: item.content || item.summary || '',
      url: item.url || '',
      profileUrl: item.profileUrl || '',
      platform: item.source || '',
    }), Infinity),
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
    ${kicker('Knowledge Officer')}
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
    ${kicker('Knowledge Officer')}
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

  const opportunityRows = compactList(opportunities, (item) => buildRow({
    label: item.topic || item.conversation || item.title || 'Opportunity',
    value: item.angle || item.injectionAngle || item.whyNow || item.summary || '',
    url: item.url || '',
    profileUrl: item.profileUrl || '',
    platform: item.source || '',
  }), Infinity);
  const xPost = content.x_post || content.primary_post || content.post || '';
  const threadOpener = content.x_thread_opener || content.thread_opener || '';
  const contentAngle = content.content_angle || content.angle || '';

  // ── Bento helpers — executive narrative boards. One number or one phrase
  // per tile; detail demoted to .foot. ──
  const bTile = ({ span = 's2', cls = '', label = '', labelTag = '', big = null, unit = '', word = '', lite = false, foot = '', verdict = '', tone = '' }) => `
    <div class="tile${cls ? ` ${cls}` : ''} ${span}">
      ${label ? `<div class="k">${esc(label)}${labelTag}</div>` : ''}
      ${big != null ? `<div class="big${tone ? ` ${tone}` : ''}">${esc(String(big))}${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div>` : ''}
      ${word ? `<div class="word${lite ? ' lite' : ''}">${esc(word)}</div>` : ''}
      ${verdict ? `<div class="verdict${tone ? ` ${tone}` : ''}">${esc(verdict)}</div>` : ''}
      ${foot ? `<div class="foot">${esc(foot)}</div>` : ''}
    </div>`;
  const bQuote = ({ span = 's2', ink = false, q = '', src = '', who = '', url = '' }) => `
    <div class="tile say${ink ? ' ink' : ''} ${span}">
      <div class="q">&ldquo;${esc(q)}&rdquo;</div>
      <div class="who">${src ? `<span class="src">${esc(src)}</span>` : ''}<span>${esc(who)}</span>${url && validatePostUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;text-underline-offset:3px">↗ View</a>` : ''}</div>
    </div>`;
  const clip = (text, max) => {
    const t = String(text || '').trim();
    return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t;
  };
  const firstSentenceOf = (text, max = 160) => {
    const t = String(text || '').trim();
    const m = t.match(/^[\s\S]+?[.!?](?=\s|$)/);
    return clip(m ? m[0] : t, max);
  };
  const firstQuoted = (text) => {
    const m = String(text || '').match(/[“"']([^”"']{30,240})[”"']/);
    return m ? m[1] : '';
  };

  // EX1 · The Last N Hours — what changed since the previous brief run.
  let lastHoursTitle = 'Since<br/>Day One.';
  let lastHoursSub = 'Everything Scout has heard so far — this is the first brief for this account.';
  if (previousRunAt) {
    const prevDt = new Date(previousRunAt);
    if (!Number.isNaN(prevDt.getTime())) {
      const hrs = Math.max(1, Math.round((generatedDt - prevDt) / 3600000));
      const span = hrs < 48 ? `${hrs} Hour${hrs === 1 ? '' : 's'}` : `${Math.round(hrs / 24)} Days`;
      lastHoursTitle = `The Last<br/>${esc(span)}.`;
      lastHoursSub = `Everything new since the previous brief ran ${prevDt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`;
    }
  }
  const sortedTrends = [...trends].sort((a, b) => ((a.relevance === 'high' ? 0 : 1) - (b.relevance === 'high' ? 0 : 1)));
  const [leadTrend, ...restTrends] = sortedTrends;
  const trendQuoteTiles = sortedTrends
    .map((t) => ({ q: firstQuoted(t.detail), who: t.trend || t.topic || 'Market trend' }))
    .filter((t) => t.q)
    .map((t) => bQuote({ span: 's2', src: 'Web', q: t.q, who: clip(t.who, 60) }));
  const kolQuoteTiles = compactList(kols, (item) => ({
    q: clip(item.detail || item.content || item.summary || '', 220),
    who: item.name || item.author || 'KOL',
    url: item.url || '',
    platform: item.platform || 'X',
  }), Infinity).filter((t) => t.q).map((t) => bQuote({ span: 's2', src: t.platform, q: t.q, who: t.who, url: t.url }));
  const redditQuoteTiles = compactList(redditSignals, (item) => ({
    q: clip(item.summary || item.actionableTakeaway || '', 220),
    who: item.subreddit ? `r/${String(item.subreddit).replace(/^r\//, '')}` : 'Reddit',
    url: item.url || '',
  }), Infinity).filter((t) => t.q && t.q.length > 30).map((t) => bQuote({ span: 's2', src: 'Reddit', q: t.q, who: t.who, url: t.url }));
  const quoteWall = [...trendQuoteTiles, ...kolQuoteTiles, ...redditQuoteTiles];
  const lastHoursSection = `
  <section class="page">
    <div class="sec-num">01</div>
    ${kicker('Marketing Director')}
    <h2 class="headline">${lastHoursTitle}</h2>
    <p class="sub">${esc(lastHoursSub)}</p>
    <div class="bento">
      ${leadTrend
        ? bTile({ span: 's2', cls: 'ink', label: `Category Shift${leadTrend.relevance ? ` · ${leadTrend.relevance} relevance` : ''}`, word: clip(leadTrend.trend || leadTrend.topic, 90), foot: firstSentenceOf(leadTrend.detail || leadTrend.relevance, 200) })
        : bTile({ span: 's2', label: 'Category Signal', word: 'No new category signal this run', lite: true, foot: 'Scout searches again on the next pass.' })}
      ${restTrends.map((t) => bTile({ span: 's2', label: 'Market Trend', word: clip(t.trend || t.topic, 90), lite: true, foot: firstSentenceOf(t.detail || '', 160) })).join('')}
      ${bTile({ span: 's2', label: 'Viral Windows', big: opportunityRows.length, foot: opportunityRows.length ? 'Open conversations to inject into — detail in Viral Windows.' : 'No live viral signal this cycle.' })}
    </div>
    ${quoteWall.length ? `<div class="bento-gap"></div><div class="bento">${quoteWall.join('')}</div>` : ''}
  </section>`;

  // EX2 · Who We're Listening To — competitors, mentions, watch coverage.
  const competitorTiles = compactList(competitors, (item) => ({
    name: item.name || item.competitor || 'Competitor',
    finding: item.finding || item.impact || '',
    impact: item.impact || '',
  }), Infinity).map((c) => bTile({ span: 's2', label: `Competitor${c.impact ? ` · ${c.impact} impact` : ''}`, word: clip(c.name, 50), lite: true, foot: clip(c.finding, 220) }));
  const mentionCount = brandMentions.length;
  const kolCount = kols.length;
  const listeningSection = `
  <section class="page">
    <div class="sec-num">02</div>
    ${kicker('Marketing Director')}
    <h2 class="headline">Who We're<br/>Listening To.</h2>
    <div class="bento">
      ${competitorTiles.join('') || bTile({ span: 's2', label: 'Competitors', word: 'No competitor signal this run', lite: true, foot: 'Add competitors on the Research card to sharpen this read.' })}
      ${bTile({ span: '', label: 'Brand Mentions', big: mentionCount, foot: mentionCount ? 'Detail in Market Signals.' : 'No one is talking about the brand yet.' })}
      ${bTile({ span: '', label: 'KOL Activity', big: kolCount, foot: kolCount ? 'Detail in Watchlist.' : 'Watchlist empty — add handles to track voices.' })}
      ${mentionCount === 0 && kolCount === 0
        ? bTile({ span: 's2', cls: 'ink', label: 'The Read', word: 'Silence is the finding — own the conversation before someone else does', foot: 'The category discourse is loud while the brand is invisible in it.' })
        : bTile({ span: 's2', cls: 'ink', label: 'The Read', word: `${mentionCount + kolCount} voice${mentionCount + kolCount === 1 ? '' : 's'} captured this run`, foot: 'Full quotes and links in Market Signals and Watchlist.' })}
    </div>
  </section>`;

  // EX3 · The Strategy — priority action pulled from the Scout brief text.
  const priorityMatch = String(scoutBrief).match(/\*\*PRIORITY ACTION:?\*\*:?\s*([\s\S]+?)(?=\n{2}|\n---|$)/i);
  const priorityAction = priorityMatch ? clip(priorityMatch[1].replace(/\s+/g, ' '), 280) : '';
  const theStrategySection = `
  <section class="page">
    <div class="sec-num">03</div>
    ${kicker('Marketing Director')}
    <h2 class="headline">The<br/>Strategy.</h2>
    <div class="bento">
      ${priorityAction
        ? bTile({ span: 's4', cls: 'ink quote', label: 'Priority Action', word: priorityAction })
        : bTile({ span: 's4', label: 'Priority Action', word: 'No priority action this run', lite: true, foot: 'Produced with each Scout run — rerun the Marketing Director brief.' })}
      ${bTile({ span: 's2', label: 'Content Angle', word: contentAngle ? firstSentenceOf(contentAngle, 180) : 'Not generated this run', lite: true, foot: contentAngle ? clip(contentAngle.slice(firstSentenceOf(contentAngle, 180).length), 200) : '' })}
      ${bTile({ span: 's2', label: 'Ready To Post', word: xPost ? clip(xPost, 180) : 'No draft post this run', lite: true, foot: xPost ? "Full draft and guardian check in Today's Move." : '' })}
    </div>
  </section>`;

  // SC · 30-Day Plan — today's move, plan config, weather hook, calendar.
  const s30 = strategyData?.strategy30 || null;
  const strat = strategyData?.strategy || null;
  const strategyBuilder = strategyData?.strategyBuilder || null;
  const strategyBuilderItems = Array.isArray(strategyBuilder?.items) ? strategyBuilder.items : [];
  const strategyBuilderToday = strategyBuilder?.today || null;
  const strategyBuilderTodayPosts = Array.isArray(strategyBuilderToday?.posts) ? strategyBuilderToday.posts : [];
  const strategyBuilderDays = (() => {
    const byDay = new Map();
    for (const item of strategyBuilderItems) {
      const day = String(item?.scheduledAt || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(item);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 30)
      .map(([date, items]) => {
        const first = items[0] || {};
        return {
          date,
          theme: first.kind || 'post',
          idea: first.content || '',
          post: first.content || '',
          count: items.length,
        };
      });
  })();
  const planDays = strategyBuilderDays.length ? strategyBuilderDays : (Array.isArray(s30?.days) ? s30.days : []);
  const angleList = Array.isArray(strat?.contentAngles)
    ? strat.contentAngles.map((a) => a?.angle || a?.label || (typeof a === 'string' ? a : '')).filter(Boolean)
    : [];
  const todayLine = strategyBuilderTodayPosts.length
    ? [
        strategyBuilderToday?.strategy_intent,
        strategyBuilderTodayPosts.map((p) => p?.content).filter(Boolean).join(' / '),
      ].filter(Boolean).join(' — ')
    : s30?.today
    ? [s30.today.angle, s30.today.post].filter(Boolean).join(' — ')
    : xPost;
  const dayTiles = planDays.map((d) => bTile({
    span: 's2', cls: 'day',
    label: d?.date || 'Day',
    word: clip(d?.theme || d?.angle || d?.idea || '—', 80),
    foot: clip(`${d?.idea || d?.post || ''}${d?.count > 1 ? ` (+${d.count - 1} more)` : ''}`, 140),
  })).join('');
  const campaignSection = `
  <section class="page">
    <div class="sec-num">SC</div>
    ${kicker('Social Media Manager')}
    <h2 class="headline">30-Day<br/>Plan.</h2>
    <div class="bento">
      ${todayLine
        ? bTile({ span: 's2', cls: 'ink', label: 'Today · Ready To Post', word: clip(todayLine, 200), foot: angleList.length ? `Angles in rotation: ${clip(angleList.join(' · '), 160)}` : '' })
        : bTile({ span: 's2', cls: 'ink', label: 'Today', word: 'Nothing staged for today', foot: 'Produced with each executive brief run.' })}
      ${bTile({ span: '', label: 'Calendar', big: planDays.length || '—', unit: strategyBuilderItems.length ? ' DAYS' : (planDays.length ? ' DAYS' : ''), foot: strategyBuilderItems.length ? `${strategyBuilderItems.length} Market Insights-driven posts.` : planDays.length ? 'Rolling window — regenerates with every run.' : 'First pass pending — runs with each executive brief.' })}
      ${weather?.today
        ? bTile({ span: '', label: `Local Weather${weather.place ? ` · ${weather.place}` : ''}`, big: weather.today.temp, unit: `°${weather.today.unit} ${String(weather.today.short).toUpperCase()}`, foot: weather.threeDayLine || '' })
        : bTile({ span: '', label: 'Local Weather', word: 'Not configured', lite: true, foot: 'Set a ZIP on the Local Weather card.' })}
      ${strategyBuilderToday?.strategy_intent
        ? bTile({ span: 's4', label: 'Posting Approach', word: clip(strategyBuilderToday.strategy_intent, 160), lite: true, foot: strategyBuilderToday?.signals_used?.length ? clip(`Signals: ${strategyBuilderToday.signals_used.join(' · ')}`, 200) : '' })
        : strat?.postStrategy?.approach ? bTile({ span: 's4', label: 'Posting Approach', word: clip(strat.postStrategy.approach, 160), lite: true, foot: s30?.revisionNotes ? clip(`Revisions: ${s30.revisionNotes}`, 200) : '' }) : ''}
    </div>
    ${dayTiles ? `<div class="bento-gap"></div><div class="bento">${dayTiles}</div>` : ''}
  </section>`;

  // Competitor Snapshot: competitor intel from web search
  const competitorRows = compactList(competitors, (item) => buildRow({
    label: item.name || item.competitor || 'Competitor',
    value: item.finding || item.impact || '',
    url: item.url || '',
    profileUrl: '',
    platform: '',
  }), Infinity);

  // Local Signals: Reddit signals + local demand signals + brand mentions from Reddit/web
  const redditLocalRows = [
    // Signals with no real text (xscout no longer invents takeaway prose)
    // drop out instead of rendering an empty quote row.
    ...compactList(redditSignals, (item) => buildRow({
      label: item.subreddit ? `r/${item.subreddit}` : 'Reddit',
      value: [item.summary, item.actionableTakeaway].filter(Boolean).join(' — '),
      url: item.url || '',
      profileUrl: '',
      platform: 'Reddit',
    }), Infinity).filter((row) => row.value),
    ...compactList(localDemandSignals, (item) => buildRow({
      label: item.signal || item.topic || item.title || 'Local signal',
      value: item.insight || item.detail || item.summary || '',
      url: item.url || '',
      profileUrl: '',
      platform: item.source || 'Local',
    }), Infinity),
    ...compactList(
      brandMentions.filter((m) => /reddit\.com/i.test(m.url || '') || /reddit/i.test(m.source || '')),
      (item) => buildRow({
        label: item.author || 'Reddit mention',
        value: item.content || item.summary || '',
        url: item.url || '',
        profileUrl: '',
        platform: 'Reddit',
      }),
      Infinity,
    ),
  ];

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
  // Full-page captures (the same ones the Cross-Device Layouts card uses) — the
  // deliverables prefer these over the viewport-only homepage shots.
  const fullPages = fullPageScreenshots || {};
  const fullShot = (device) => fullPages[`${device}-full`]?.downloadUrl || (shots && shots[device]) || null;
  const shotKeys = ['desktop', 'tablet', 'mobile'].filter((k) => shots[k]);
  const screenshotStrip = shotKeys.length ? `
    <div class="card" style="padding:10px;margin-bottom:14px">
      <div style="display:flex;gap:8px;align-items:flex-start">
        ${shotKeys.map((k) => `<figure style="margin:0;flex:1;min-width:0"><img src="${esc(shots[k])}" alt="${esc(k)} viewport screenshot" style="display:block;width:100%;height:auto;border:1px solid rgba(0,0,0,.08)"/><figcaption class="mono" style="font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft);margin-top:4px">${esc(k)}</figcaption></figure>`).join('')}
      </div>
    </div>` : '';
  const mockupSrc = deviceBrief?.mockupUrl || auditItems.find((b) => b.mockupUrl)?.mockupUrl || auditMockupUrl || null;

  // Both the Executive and Creative Brief ('onboarding') show the device mockup
  // small in the cover top-right. When it rides the cover, the Creative Brief's
  // dedicated body mockup section is suppressed so it isn't shown twice (the
  // section stays in the composition for summary evidence).
  const _mockupBriefTypeEarly = resolveBriefType(briefType);
  // Both Executive and Creative ('onboarding') keep the device mockup in the
  // cover's top-right corner. The Creative Brief ALSO leads with a hero asset +
  // inline evidence inside the story.
  const isCoverMockup = (_mockupBriefTypeEarly === 'executive-daily' || _mockupBriefTypeEarly === 'onboarding') && Boolean(mockupSrc);

  const performanceBriefSection = perfItems.length ? `
  <section class="page">
    <div class="sec-num">PB</div>
    ${kicker('Website Developer')}
    <h2 class="headline">Site<br/>Performance.</h2>
    ${screenshotStrip}
    <div class="card">
      ${perfItems.map(renderAuditRow).join('')}
    </div>
  </section>` : '';

  const creativeBriefSection = creativeItems.length ? `
  <section class="page">
    <div class="sec-num">CB</div>
    ${kicker('Creative Director')}
    <h2 class="headline">Creative<br/>System.</h2>
    ${mockupSrc ? `<div class="card" style="padding:0;overflow:hidden;margin-bottom:14px"><img src="${esc(mockupSrc)}" alt="Homepage rendered across devices" style="display:block;width:100%;height:auto"/></div>` : ''}
    <div class="card">
      ${creativeItems.map(renderAuditRow).join('')}
    </div>
  </section>` : '';

  // ── Creative Brief assets ─────────────────────────────────────────────
  // The render assets (device mockup, full-page screenshots, social preview,
  // studio video) are no longer standalone bottom pages — they're used as a
  // HERO at the top and inline evidence/hooks INSIDE the story (built in
  // buildCreativeBrief below). So the composition sections render nothing.
  const creativeMockupSection = '';
  const creativeScreensSection = '';
  const creativeSocialSection = '';
  const creativeStudioSection = '';

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

  // ── Section consts for the remaining inline pages (HTML unchanged) ──
  const scoutFoundSection = `
  <section class="page">
    <div class="sec-num">01</div>
    ${kicker('Marketing Director')}
    <h2 class="headline">What<br/>Scout<br/>Found.</h2>
    <div class="card" style="white-space:pre-wrap;font-family:'Space Grotesk';font-size:16px;line-height:1.6;color:#181818">${linkify(scoutBrief)}</div>
  </section>`;

  const marketSignalsSection = `
  <section class="page">
    <div class="sec-num">02</div>
    ${kicker('Marketing Director')}
    <h2 class="headline">Market<br/>Signals.</h2>
    <div class="card">
      ${renderRows(marketSignalRows, 'No market signals surfaced this run.')}
    </div>
  </section>`;

  const competitorSnapshotSection = `
  <section class="page">
    <div class="sec-num">03</div>
    ${kicker('Marketing Director')}
    <h2 class="headline">Competitor<br/>Snapshot.</h2>
    <div class="card">
      ${renderRows(competitorRows, 'No competitor signals surfaced this run.')}
    </div>
  </section>`;

  const localSignalsSection = `
  <section class="page">
    <div class="sec-num">04</div>
    ${kicker('Marketing Director')}
    <h2 class="headline">Local<br/>Signals.</h2>
    <div class="card">
      ${renderRows(redditLocalRows, 'No Reddit or local signals for this run.')}
    </div>
  </section>`;

  const viralWindowsSection = `
  <section class="page">
    <div class="sec-num">05</div>
    ${kicker('Marketing Director')}
    <h2 class="headline">Viral<br/>Windows.</h2>
    <div class="card">
      ${renderRows(opportunityRows, 'No viral windows captured for this run.')}
    </div>
  </section>`;

  const todaysMoveSection = `
  <section class="page">
    <div class="sec-num">06</div>
    ${kicker('Creative Director')}
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
  </section>`;

  // Post Schedule — the Schedule Posts card's actual queue: what is scheduled,
  // drafted, posted, or failed on X. Empty queue is stated explicitly.
  const queuePosts = Array.isArray(socialQueue) ? socialQueue : [];
  const queueCounts = queuePosts.reduce((acc, p) => {
    const s = p?.status || 'draft';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  const fmtWhen = (iso) => {
    try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch { return String(iso || ''); }
  };
  const upcomingPosts = queuePosts
    .filter((p) => (p?.status === 'queued' || p?.status === 'scheduled') && p?.scheduledAt)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
    .slice(0, 5);
  const recentPosted = queuePosts.filter((p) => p?.status === 'posted').slice(0, 3);
  const failedPosts = queuePosts.filter((p) => p?.status === 'failed').slice(0, 3);
  const postText = (p) => String(p?.text || p?.content || p?.body || '').slice(0, 160);
  const postScheduleSection = `
  <section class="page">
    <div class="sec-num">XP</div>
    ${kicker('Social Media Manager')}
    <h2 class="headline">Post<br/>Schedule.</h2>
    <div class="card">
      ${queuePosts.length
        ? valRow('Queue', esc(['queued', 'scheduled', 'draft', 'posted', 'failed'].filter((s) => queueCounts[s]).map((s) => `${queueCounts[s]} ${s}`).join(' · ')))
        : naRow('Queue', 'Empty — no posts scheduled. Compose from the Schedule Posts card.')}
      ${upcomingPosts.map((p) => valRow(esc(fmtWhen(p.scheduledAt)), esc(postText(p) || 'Scheduled post'))).join('')}
      ${recentPosted.map((p) => valRow('Posted', esc(postText(p) || 'Published to X'))).join('')}
      ${failedPosts.map((p) => valRow('✗ Failed', `<span style="color:#b42318">${esc(postText(p) || 'Post failed to publish')}</span>`)).join('')}
    </div>
  </section>`;

  // ── Assembly — section id → rendered HTML, ordered by the named brief's
  // composition (features/scout-intake/brief-sections.cjs). Conditional
  // sections that rendered '' (no data) stay '' — same as before. ──
  const sectionHtmlById = {
    'last-hours': lastHoursSection,
    'listening': listeningSection,
    'the-strategy': theStrategySection,
    'scout-found': scoutFoundSection,
    'company-foundation': companyBriefSection,
    'site-performance': performanceBriefSection,
    'creative-system': creativeBriefSection,
    'creative-mockup': creativeMockupSection,
    'creative-screens': creativeScreensSection,
    'creative-social': creativeSocialSection,
    'creative-studio': creativeStudioSection,
    'search-parameters': researchBriefSection,
    'local-weather': weatherSection,
    'market-signals': marketSignalsSection,
    'watchlist': watchlistSection,
    'competitor-snapshot': competitorSnapshotSection,
    'local-signals': localSignalsSection,
    'viral-windows': viralWindowsSection,
    'todays-move': todaysMoveSection,
    'campaign-30day': campaignSection,
    'post-schedule': postScheduleSection,
  };
  const composition = getComposition(briefType);
  // Display label: caller may override (Onboarding vs Executive by run sequence);
  // named agent briefs fall back to the composition label.
  const briefLabel = displayLabel || composition.label;
  const bodySections = composition.sections.map((id) => sectionHtmlById[id] || '').join('\n');

  // Cover sub: the per-brief AI cover paragraph (briefSummaries) when present,
  // else the run headline. The executive JARVIS brief is multi-paragraph —
  // render each paragraph and let .cover-jarvis-sub size it down to body scale.
  // Strip the salutation ("Good morning/night. Here's what matters.") — the
  // cover reads conversational, not greeted.
  const coverParas = String(coverSummary || '')
    .replace(/^good\s+(morning|afternoon|evening|night)[.!,]*\s*/i, '')
    .replace(/^here'?s what matters[.!:]*\s*/i, '')
    .split(/\n+/).map((s) => s.trim()).filter(Boolean)
    .map((p, i) => (i === 0 && p ? p.charAt(0).toUpperCase() + p.slice(1) : p));

  // Creative Brief ('onboarding'): the summary is a labeled, structured website
  // analysis (Objective / Audience / Core Message / Creative Direction /
  // Deliverables / Success / Decision Needed). Render it as styled sections —
  // eyebrow label + body paragraph(s) or bullet list — with varying type scale
  // and smooth vertical rhythm, instead of flat paragraphs.
  const CB_LABELS = ['Headline', 'What This Site Is', "What's Missing", 'Biggest Risk', 'The Opportunity', 'Decision', 'Suggested Post'];
  const renderCreativeBriefSummary = (textRaw) => {
    const sections = [];
    let cur = null;
    // No dashes anywhere: em/en dashes become commas; leading bullet markers
    // are stripped (rendered as tiles/tags, never as "- ").
    const noDash = (s) => String(s).replace(/\s*[—–]\s*/g, ', ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').trim();
    for (const raw of String(textRaw || '').split('\n')) {
      const t = raw.trim();
      if (!t) continue;
      const low = t.toLowerCase().replace(/^[-•*\s]+/, '');
      const matched = CB_LABELS.find((L) => low === `${L.toLowerCase()}:` || low === L.toLowerCase() || low.startsWith(`${L.toLowerCase()}:`));
      if (matched) {
        cur = { label: matched, paras: [], bullets: [] };
        sections.push(cur);
        const after = noDash(t.slice(t.indexOf(':') + 1).trim());
        if (after && after !== ':') cur.paras.push(after);
        continue;
      }
      if (!cur) { cur = { label: '', paras: [], bullets: [] }; sections.push(cur); }
      if (/^[-•*]\s+/.test(t)) cur.bullets.push(noDash(t.replace(/^[-•*]\s+/, '')));
      else cur.paras.push(noDash(t));
    }
    if (!sections.length || !sections.some((s) => s.label)) return null;
    const byLabel = (L) => sections.find((s) => s.label === L);
    const subFrom = (paras) => paras.map((p) => `<p class="sub">${esc(p)}</p>`).join('');
    const tilesFrom = (items, opts = {}) => items.length
      ? `<div class="bento">${items.map((t) => bTile({ span: 's2', word: t, lite: true, ...opts })).join('')}</div>`
      : '';
    let n = 0;
    const page = (title, inner, secId) => {
      const num = String((n += 1)).padStart(2, '0');
      return `
  <section class="page cb-page"${secId ? ` id="${secId}"` : ''}>
    <div class="sec-num">${num}</div>
    <div class="cb-deco" aria-hidden="true"></div>
    <h2 class="headline">${title}</h2>
    <div class="rule"></div>
    ${inner}
  </section>`;
    };
    const pages = [];
    // Per-section content components — each page gets a distinct visual form.
    const longParas = (s) => s.paras.filter((p) => p.length > 64);
    const shortParas = (s) => s.paras.filter((p) => p.length <= 64);
    const pull = (text) => `<p class="pull">${esc(text)}</p>`;
    const gapList = (items) => `<div class="cb-gaps">${items.map((g, i) => `<div class="cb-gap"><span class="cb-gap-n">${String(i + 1).padStart(2, '0')}</span><span class="cb-gap-sep" aria-hidden="true">—</span><span class="cb-gap-t">${esc(g)}</span></div>`).join('')}</div>`;
    const metaTiles = (items) => `<div class="meta-grid">${items.map((t) => `<div class="meta-tile"><div class="v">${esc(t)}</div></div>`).join('')}</div>`;
    const tagRow = (items) => items.length ? `<div class="cb-tags">${items.map((t) => `<span class="cb-tag">${esc(t)}</span>`).join('')}</div>` : '';
    // Assets as inline evidence with a clear Download + Contact CTA on each, so
    // every deliverable connects to "get the file" and "talk to a human".
    const ok = (u) => u && /^https?:\/\/\S+$/i.test(u);
    // Downloads route through the same-origin proxy so the file SAVES (not opens
    // in a new tab) with a descriptive name: <client>-<asset>-<date>.<ext>.
    const dlClient = String(clientName || clientId || 'client').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'client';
    const dlDate = (() => { try { return new Date(generated).toISOString().slice(0, 10); } catch { return ''; } })();
    const slugify = (s) => String(s || 'asset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    const extFor = (url, type) => type === 'video'
      ? 'mp4'
      : ((/\.(png|jpe?g|webp|gif|mp4|webm|pdf)(?:\?|$)/i.exec(String(url)) || [, 'png'])[1] || 'png').toLowerCase();
    const dlName = (descriptor, url, type) => [dlClient, slugify(descriptor), dlDate].filter(Boolean).join('-') + '.' + extFor(url, type);
    const dlHref = (url, descriptor, type) => `/api/dashboard/deliverable-file?u=${encodeURIComponent(url)}&n=${encodeURIComponent(dlName(descriptor, url, type))}`;
    // Multi-asset download → one zip. items: [{url, descriptor, type}].
    const dlZipHref = (items, zipBase) => {
      const params = [];
      for (const it of items) {
        if (!ok(it.url)) continue;
        params.push(`u=${encodeURIComponent(it.url)}`);
        params.push(`n=${encodeURIComponent(dlName(it.descriptor, it.url, it.type))}`);
      }
      params.push(`zn=${encodeURIComponent([dlClient, slugify(zipBase), dlDate].filter(Boolean).join('-'))}`);
      return `/api/dashboard/deliverable-file?${params.join('&')}`;
    };
    // Download-only — contact / "Book a Call" CTAs removed from every page; the
    // only action a client sees in the brief is downloading their assets.
    const ctaRow = (url, descriptor = 'deliverable', type = 'img') => ok(url)
      ? `<div class="cb-cta-row"><a class="cb-cta cb-cta--dl" href="${esc(dlHref(url, descriptor, type))}" download>Download</a></div>`
      : '';
    // Deliverables row — every asset side by side, full viewport width, each
    // with Download + Book a Call; stacks to one column on mobile.
    // Each asset carries a stable anchor slug so the cover "What you get" links
    // jump straight to the matching deliverable cell.
    const deliverableAssets = [
      { url: studioVideoUrl, type: 'video', name: 'Video Post', slug: 'cb-d-video', desc: 'Your site turned into a social-ready video — see how your brand reads in motion and download content ready to share.' },
      { url: mockupSrc, type: 'img', name: 'Device Mockup', slug: 'cb-d-mockup', desc: 'Your homepage in a polished real-world device frame, ready for decks, posts, and presentations.' },
      { url: fullShot('desktop'), type: 'img', name: 'Desktop View', slug: 'cb-d-desktop', desc: 'Full desktop capture — review layout, content, and hierarchy at full width.' },
      { url: fullShot('tablet'), type: 'img', name: 'Tablet View', slug: 'cb-d-tablet', desc: 'Tablet capture — confirm the experience holds up at mid-size.' },
      { url: fullShot('mobile'), type: 'img', name: 'Mobile View', slug: 'cb-d-mobile', desc: 'Mobile capture — catch layout and content issues on the screen most people use.' },
      // Social Preview always shows: when the site has no og:image the cell
      // renders an empty bordered placeholder (no broken <img>) — the absence IS
      // the finding, so the deliverable still surfaces the gap.
      { url: socialPreviewImageUrl, type: 'img', name: 'Social Preview', slug: 'cb-d-social', keepIfEmpty: true, emptyLabel: 'No share image set', desc: 'How your brand appears when shared across platforms — and what to fix for clean, clickable links.' },
    ].filter((a) => ok(a.url) || a.keepIfEmpty);
    const deliverableMedia = (a) => {
      if (!ok(a.url)) return `<div class="cb-deliverable-media--empty">${esc(a.emptyLabel || 'Not available yet')}</div>`;
      return a.type === 'video'
        ? `<video src="${esc(a.url)}" autoplay muted loop playsinline></video>`
        : `<img src="${esc(a.url)}" alt="${esc(a.name)}"/>`;
    };
    const deliverablesRow = deliverableAssets.length
      ? `<div class="cb-deliverables-grid">${deliverableAssets.map((a, i) => `<div class="cb-deliverable" id="${a.slug}"><div class="cb-deliverable-idx">D${String(i + 1).padStart(2, '0')}</div><div class="cb-deliverable-media">${deliverableMedia(a)}</div><div class="cb-deliverable-name">${esc(a.name)}</div><p class="cb-deliverable-desc">${esc(a.desc)}</p>${ctaRow(a.url, a.name, a.type)}</div>`).join('')}</div>`
      : '';

    // INTRO SPLIT — "You're In." (welcome, left) + "Key Insight." (verdict,
    // right) share one page directly below the cover. Each column keeps its
    // oversized label; the two columns stack on mobile.
    const hero = byLabel('Headline');
    const heroWord = (hero && hero.paras.length) ? hero.paras.join(' ') : '';
    const splitNum = String((n += 1)).padStart(2, '0');
    const splitCol = (id, title, body) => `<div class="cb-split-col" id="${id}"><h2 class="headline">${title}</h2><div class="rule"></div>${body}</div>`;
    const ONBOARD_COPY = [
      'Most agencies start by asking questions. Hit Loop starts by doing the work.',
      'Before a single onboarding call, the assets above were generated to establish context, capture observations, and identify opportunities across your website, brand, and digital presence.',
      'The result is less time spent explaining your business and more time focused on what comes next. Instead of paying for discovery, you arrive with a brief, creative assets, and a starting point for meaningful discussion.',
      "When you're ready, your Human steps in to review the findings, validate the opportunities, and help prioritize the work that will create the greatest impact.",
      'By the time we speak, the conversation has already moved beyond introductions and into execution.',
    ];
    const [onboardLead, ...onboardRest] = ONBOARD_COPY;
    const onboardBody = `<div class="cb-onboard-copy">
      <p class="cb-onboard-lead">${esc(onboardLead)}</p>
      ${onboardRest.map((p) => `<p class="cb-onboard-line">${esc(p)}</p>`).join('')}
    </div>`;
    const systemCol = splitCol('cb-system', "You're<br/>Onboarded.", onboardBody);
    const insightCol = heroWord ? splitCol('cb-insight', 'Key<br/>Insight.', `<div class="bento">${bTile({ span: 's4', cls: 'ink', word: heroWord })}</div>`) : '';
    pages.push(`
  <section class="page cb-page" id="cb-intro-split">
    <div class="sec-num">${splitNum}</div>
    <div class="cb-deco" aria-hidden="true"></div>
    <div class="cb-split${insightCol ? '' : ' cb-split--single'}">${systemCol}${insightCol}</div>
  </section>`);

    // FEATURED POST — the Suggested Post caption rendered as a real X / Share
    // Post card with the studio video front and center. Mirrors the dashboard
    // Post Me card UI (DashboardPage.jsx #post-me-tile-mockup).
    const featPost = byLabel('Suggested Post');
    if (featPost && featPost.paras.length) {
      const handle = '@' + String(clientName || 'yourbrand').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
      const site = hostnameOf(websiteUrl) || '';
      const caption = featPost.paras.join(' ');
      const featMedia = ok(studioVideoUrl)
        ? `<div class="cb-xpost-media"><video src="${esc(studioVideoUrl)}" autoplay muted loop playsinline></video></div>`
        : ok(mockupSrc)
        ? `<div class="cb-xpost-media"><img src="${esc(mockupSrc)}" alt="Featured creative"/></div>`
        : ok(socialPreviewImageUrl)
        ? `<div class="cb-xpost-media"><img src="${esc(socialPreviewImageUrl)}" alt="Featured creative"/></div>`
        : '';
      const xActions = [
        { p: 'M1.751 10c0-4.42 3.584-8 8.005-8h.366a8.001 8.001 0 0 1 7.97 9.58l.001.02 1.024 1.024a1.07 1.07 0 0 1-.953 1.763L16.5 22.5l-2.836-2.837c-.33.1-.67.187-1.014.256A8 8 0 0 1 2.1 11.39 8 8 0 0 1 1.75 10Z', l: '4' },
        { p: 'M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5a4 4 0 0 1-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6h-6V4h6a4 4 0 0 1 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z', l: '1' },
        { p: 'M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82z', l: '12' },
        { p: 'M8.75 21V3h2v18h-2zM13 21V8.5h2V21h-2zM4.5 21V13h2v8h-2zM17.5 21V11.5h2V21h-2z', l: '2.4K' },
      ].map(({ p, l }) => `<span><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="${p}"/></svg>${l}</span>`).join('');
      const xCard = `<div class="cb-xpost">
      <div class="cb-xpost-head">
        <img class="cb-xpost-avatar" src="/img/profile2_400x400.png?v=1774582808" alt="" />
        <div class="cb-xpost-id">
          <span class="cb-xpost-name">${esc(clientName || 'Your Brand')}</span>
          <svg class="cb-xpost-badge" width="15" height="15" viewBox="0 0 22 22" fill="#1d9bf0"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.469-.445-1.053-.751-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.469-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.22.878 1.69.47.444 1.055.75 1.69.88.635.13 1.294.08 1.902-.144.27.586.7 1.084 1.24 1.44.54.354 1.167.55 1.813.566.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>
          <span class="cb-xpost-handle">${esc(handle)}</span>
        </div>
        <svg class="cb-xpost-logo" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.722-8.831L1.534 2.25H8.08l4.259 5.631zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </div>
      <p class="cb-xpost-caption">${esc(caption)}${site ? ` <span class="cb-xpost-link">${esc(site)}</span>` : ''}</p>
      ${featMedia}
      <div class="cb-xpost-actions">${xActions}</div>
    </div>`;
      // Post copy lifted out of the mock as a slightly oversized, easy-to-copy
      // quote beside the video mock (2-col, stacks on mobile). Primary action
      // downloads the video; secondary copies the caption (live iframe only —
      // inert but harmless in the PDF).
      const postActions = `<div class="cb-post-actions">${ok(studioVideoUrl) ? `<a class="cb-cta cb-cta--solid" href="${esc(studioVideoUrl)}" download target="_blank" rel="noopener noreferrer">Download Video</a>` : ''}<button type="button" class="cb-cta cb-post-copy" data-copy="${esc(caption)}" onclick="(function(b){try{navigator.clipboard.writeText(b.dataset.copy);var t=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=t},1600);}catch(e){}})(this)">Copy Caption</button></div>`;
      const featuredCopy = `<div class="cb-featured-copy"><blockquote class="cb-post-quote">${esc(caption)}</blockquote>${postActions}</div>`;
      // Deliverables ride underneath as a sub-category of the same page.
      const deliverablesBlock = deliverablesRow
        ? `<div class="cb-sub-head" id="cb-deliverables"><span>Deliverables</span><span class="cb-sub-head-meta">${deliverableAssets.length} assets</span></div>${deliverablesRow}`
        : '';
      pages.push(page('Featured<br/>Post.', `<div class="cb-featured-row">${featuredCopy}<div class="cb-featured-mock">${xCard}</div></div>${deliverablesBlock}`, 'cb-featured-post'));
    } else if (deliverablesRow) {
      // No Suggested Post caption this run — still surface deliverables alone.
      pages.push(page('Deliverables.', deliverablesRow, 'cb-deliverables'));
    }

    // SITE AUDIT — one compact page. "What This Site Is" reads big at the top,
    // then every site-specific section is demoted to a sub-category (same inner
    // styling as before: checklist, alert, tiles, pull) under one header.
    const wtis = byLabel('What This Site Is');
    const miss = byLabel("What's Missing");
    const risk = byLabel('Biggest Risk');
    const opp = byLabel('The Opportunity');
    const dec = byLabel('Decision');
    // Each sub-section is its own wrapper (id on the wrapper, not the label) so
    // layout/spacing can be scoped per section.
    const subSection = (label, inner, id) => inner
      ? `<section class="cb-subsec"${id ? ` id="${id}"` : ''}><div class="cb-sub-head"><span>${esc(label)}</span></div>${inner}</section>`
      : '';
    const missInner = miss ? gapList([...miss.paras, ...miss.bullets]) : '';
    const riskInner = risk ? `<div class="cb-alert">${subFrom(longParas(risk))}</div>${tagRow(risk.bullets)}` : '';
    const oppInner = opp ? `${metaTiles([...shortParas(opp), ...opp.bullets])}${subFrom(longParas(opp))}` : '';
    let decInner = '';
    if (dec && dec.paras.length) {
      const [q, ...rest] = dec.paras;
      decInner = `${pull(q)}${subFrom(rest.filter((p) => p.length > 0))}${tagRow(dec.bullets)}`;
    }
    // Social Share — surfaces exactly what the site exposes when shared: a
    // faux share-card preview (og:image, falling back to the largest icon /
    // favicon) plus a captured/missing checklist of the social tags we read.
    // Renders whenever a homepage was captured; "all missing" IS the finding.
    const socialInner = (() => {
      const sm = siteMeta || {};
      if (!siteMeta && !socialPreviewImageUrl) return '';
      const shareImg = socialPreviewImageUrl || sm.ogImage || null;
      const fallbackIcon = sm.appleTouchIcon || sm.favicon || null;
      const host = hostnameOf(websiteUrl) || sm.siteName || '';
      const cardImg = ok(shareImg)
        ? `<div class="cb-social-card-img"><img src="${esc(shareImg)}" alt="${esc(sm.ogImageAlt || 'Share image')}"/></div>`
        : ok(fallbackIcon)
        ? `<div class="cb-social-card-img cb-social-card-img--icon"><img src="${esc(fallbackIcon)}" alt="Site icon"/></div>`
        : `<div class="cb-social-card-img cb-social-card-img--empty">No share image set</div>`;
      const card = `<div class="cb-social-card">${cardImg}<div class="cb-social-card-meta">${host ? `<span class="cb-social-card-host">${esc(host)}</span>` : ''}<span class="cb-social-card-title">${esc(sm.title || sm.siteName || host || 'Untitled')}</span>${sm.description ? `<span class="cb-social-card-desc">${esc(sm.description)}</span>` : ''}</div></div>`;
      const checks = [
        { label: 'Share image (og:image)', val: sm.ogImage },
        { label: 'Image alt text', val: sm.ogImageAlt },
        { label: 'Title', val: sm.title },
        { label: 'Description', val: sm.description },
        { label: 'Site name', val: sm.siteName },
        { label: 'Favicon', val: sm.favicon },
        { label: 'Brand color', val: sm.themeColor },
      ];
      const list = `<ul class="cb-social-checks">${checks.map((c) => `<li class="cb-social-check ${c.val ? 'is-ok' : 'is-miss'}"><span class="cb-social-mark" aria-hidden="true">${c.val ? '✓' : '✗'}</span><span class="cb-social-label">${esc(c.label)}</span><span class="cb-social-status">${c.val ? 'Captured' : 'Missing'}</span></li>`).join('')}</ul>`;
      return `<div class="cb-social"><div class="cb-social-preview">${card}</div>${list}</div>`;
    })();
    if (wtis || miss || risk || opp || dec || socialInner) {
      // WTIS lead reads full-width across the page (not a narrow pull-quote).
      const wtisBig = (wtis && wtis.paras.length) ? wtis.paras.map((p) => `<p class="cb-wtis-lead">${esc(p)}</p>`).join('') : '';
      const missSec = subSection("What's Missing", missInner, 'cb-whats-missing');
      const riskSec = subSection('Biggest Risk', riskInner, 'cb-biggest-risk');
      // What's Missing + Biggest Risk sit side by side, stacking on mobile.
      const missRiskRow = (missSec || riskSec) ? `<div class="cb-audit-row">${missSec}${riskSec}</div>` : '';
      const auditBody = `${wtisBig}
      ${subSection('Social Share', socialInner, 'cb-social-share')}
      ${missRiskRow}
      ${subSection('The Opportunity', oppInner, 'cb-opportunity')}
      ${subSection('The Decision', decInner, 'cb-decision')}`;
      pages.push(page('Your Website<br/>Status.', auditBody, 'cb-what-this-site-is'));
    }

    // CONTACT YOUR HUMAN — closing page in the same format as the rest of the
    // brief: a direct line to the human plus the services Hit Loop offers.
    // Contact details mirror the marketing site (Calendly / email / socials).
    const HUMAN = {
      calendly: 'https://calendly.com/bballi/30min',
      email: 'bryanballi@gmail.com',
      linkedin: 'https://www.linkedin.com/in/bryanballi',
      x: 'https://x.com/bai_ee',
    };
    const SERVICES = [
      { name: 'Brand Identity & Design', desc: 'Logos, visual systems, and brand kits, built to hold up across every surface your business shows up on.' },
      { name: 'Websites & Landing Pages', desc: 'Designed, built, and optimized to convert. Sites that perform on every screen, at every stage.' },
      { name: 'Social Media & Content', desc: 'Posts, captions, and content strategy aligned to how your brand sounds and what your audience wants.' },
      { name: 'Video & Motion', desc: 'Short-form content, reels, and visual storytelling crafted to get watched, saved, and shared.' },
      { name: 'SEO & Content Strategy', desc: 'Search visibility and structured content growth — the long game, built to compound over time.' },
      { name: 'Email & Newsletter Systems', desc: 'Campaigns, automated flows, and newsletters built to keep your audience close and revenue moving.' },
      { name: 'Daily Briefs', desc: 'Automated daily intelligence briefings that surface what matters — competitor moves, content opportunities, and operational signals — delivered to your dashboard every morning.' },
      { name: 'AI Automation & Workflows', desc: 'Custom systems that remove manual work and scale output, built around how your business actually runs.' },
      { name: 'Blockchain', desc: 'Web3 product design, token UX, and smart contract interfaces — built for clarity in a space where trust is everything.' },
      { name: 'Browser Based Games', desc: 'Game UI, interactive experiences, and player-facing systems designed to keep users engaged and coming back.' },
    ];
    const servicesGrid = `<div class="cb-services-grid">${SERVICES.map((s, i) => `<div class="cb-service"><div class="cb-service-idx">S${String(i + 1).padStart(2, '0')}</div><div class="cb-service-name">${esc(s.name)}</div><p class="cb-service-desc">${esc(s.desc)}</p></div>`).join('')}</div>`;
    const contactActions = `<div class="cb-contact-actions"><a class="cb-cta cb-cta--solid" href="${HUMAN.calendly}" target="_blank" rel="noopener noreferrer">Meet with a Human</a><a class="cb-cta" href="mailto:${esc(HUMAN.email)}">Email Us</a></div>`;
    // LinkedIn + X buttons that sit under the role line on every signature.
    const humanSocials = `<div class="cb-human-socials"><a href="${HUMAN.linkedin}" target="_blank" rel="noopener noreferrer">LinkedIn</a><a href="${HUMAN.x}" target="_blank" rel="noopener noreferrer">X</a></div>`;
    const sigBlock = `<div class="cb-contact-sig"><img class="cb-cover-sig" src="/img/sig.png" alt="Signature" /><div class="cb-human"><div class="cb-human-label">Your Human</div><div class="cb-human-name">Bryan Balli</div><div class="cb-human-role">Creative Lead @ HITLOOP</div>${humanSocials}</div></div>`;
    const contactBody = `<div class="cb-contact-top">
      <div class="cb-contact-lede">${pull("Your brief is built. Onboarding is complete. When you're ready to move from insight to execution, your Human is one click away. Here's what we bring to the table.")}${contactActions}</div>
      ${sigBlock}
    </div>
      <div class="cb-sub-head" id="cb-services-head"><span>What We Offer</span><span class="cb-sub-head-meta">${SERVICES.length} services</span></div>
      ${servicesGrid}`;
    pages.push(page('Contact Your<br/>Human.', contactBody, 'cb-contact'));

    // Suggested Post now renders as the Featured Post X-card above (after Key
    // Insight) — no separate bottom page.

    // Cover — the device mockup sits in the top-right corner (isCoverMockup);
    // no video on the cover. Just the lede + the "What you get" rows (plain,
    // non-linked, each with a thumbnail of the matching deliverable).
    // Cover list mirrors the actual deliverables (deliverableAssets) so every
    // asset shipped this run shows as its own line item with a thumbnail.
    // Friendlier cover labels for the known assets; unknown names pass through.
    const PKG_LABELS = {
      'Video Post': 'A shareable video of your brand',
      'Device Mockup': 'Your homepage in a device mockup',
      'Social Preview': 'Social preview validation',
    };
    // Desktop / Tablet / Mobile collapse into a single "device views" line; its
    // download bundles all three captures into one zip.
    const DEVICE_NAMES = ['Desktop View', 'Tablet View', 'Mobile View'];
    const deviceAssets = deliverableAssets.filter((a) => DEVICE_NAMES.includes(a.name) && ok(a.url));
    const deviceThumb = deviceAssets[0] || null;
    const pkgItems = [];
    let devicePushed = false;
    for (const a of deliverableAssets) {
      if (DEVICE_NAMES.includes(a.name)) {
        if (!devicePushed && deviceThumb) {
          pkgItems.push({
            label: 'Full desktop, tablet and mobile views',
            thumb: deviceThumb.url,
            thumbType: 'img',
            dlZip: deviceAssets.map((d) => ({ url: d.url, descriptor: d.name, type: d.type })),
            zipBase: 'site-views',
          });
          devicePushed = true;
        }
        continue;
      }
      pkgItems.push({ label: PKG_LABELS[a.name] || a.name, thumb: a.url, thumbType: a.type, dl: ok(a.url) ? a.url : null, emptyLabel: a.emptyLabel, fileBase: a.name });
    }
    const pkgThumb = (a) => ok(a.thumb)
      ? (a.thumbType === 'video'
          ? `<span class="cb-package-thumb"><video src="${esc(a.thumb)}" autoplay muted loop playsinline></video></span>`
          : `<span class="cb-package-thumb"><img src="${esc(a.thumb)}" alt="" /></span>`)
      : '<span class="cb-package-thumb cb-package-thumb--empty"></span>';
    const coverHtml = `<div class="cb-handoff" id="brief-cover-handoff">
      <div class="cb-handoff-sig">
        <img class="cb-cover-sig" src="/img/sig.png" alt="Signature" />
        <div class="cb-human" id="brief-cover-human">
          <div class="cb-human-label">Your Human</div>
          <div class="cb-human-name">Bryan Balli</div>
          <div class="cb-human-role">Creative Lead @ HITLOOP</div>
          ${humanSocials}
        </div>
      </div>
      <div class="cb-package" id="brief-cover-package">
        <div class="cb-package-label">Deliverables Snapshot</div>
        <ul class="cb-package-list">
          ${pkgItems.map((a) => {
            const href = a.dlZip ? dlZipHref(a.dlZip, a.zipBase) : (a.dl ? dlHref(a.dl, a.fileBase, a.thumbType === 'video' ? 'video' : 'img') : null);
            return `<li>${pkgThumb(a)}<span class="cb-package-text">${esc(a.label)}</span>${href ? `<a class="cb-package-dl" href="${esc(href)}" download>↓ Download</a>` : ''}</li>`;
          }).join('')}
        </ul>
      </div>
    </div>`;
    return { coverHtml, pages: pages.join('\n') };
  };
  const _creativeBrief = resolveBriefType(briefType) === 'onboarding'
    ? renderCreativeBriefSummary(coverSummary)
    : null;

  const coverSubHtml = _creativeBrief
    ? _creativeBrief.coverHtml
    : coverParas.length > 1
    ? `<div class="sub cover-jarvis-sub" id="brief-cover-exec-summary">${coverParas.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`
    : `<p class="sub">${esc(coverParas[0] || headline)}</p>`;

  // Executive + Creative ('onboarding') briefs render the multi-device mockup
  // small in the cover's top-right; the cover text narrows to the left half
  // (CSS). DOM id stays #onboarding-cover-mockup. isCoverMockup is computed
  // near mockupSrc above (it also gates the redundant body mockup section).

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(briefLabel)} · Vol. 01${clientName ? ` · ${esc(clientName)}` : ''}</title>
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
    font-size:clamp(13px,1.4vw,15px);color:#fff;white-space:nowrap;text-decoration:none;
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
  /* Date/time stamp headline — small, two lines (date over time), sitting
     directly under the brief name. */
  .cover .headline{
    margin:14px 0 10px;
    flex-basis:100%;
    width:100%;
    font-size:clamp(28px,5vw,56px);
    line-height:1.08;
  }
  /* Brief name — sits above the date headline inside the title stack;
     slightly heavier and larger than .sub (300 / clamp(20px,2.4vw,34px)).
     flex-basis:100% forces its own row in the flex title-stack. */
  .cover-brief-name{
    flex-basis:100%;
    width:100%;
    font-family:"Space Grotesk",sans-serif;
    font-weight:500;
    font-size:clamp(23px,2.8vw,38px);
    line-height:1.2;
    margin:0 0 8px;
  }
  /* Cover summary — spans the full page width, justified so it stretches
     flush to both edges. */
  .cover .sub{margin:28px 0 16px;width:100%;max-width:100%;text-align:justify}
  /* JARVIS-mode executive summary — multi-paragraph, body scale (the giant
     .sub treatment is for one-line headlines only). */
  #brief-cover-exec-summary{margin:28px 0 16px;width:100%;max-width:100%}
  #brief-cover-exec-summary p{font-size:clamp(15px,1.45vw,18px);line-height:1.6;font-weight:400;margin:0 0 12px;max-width:100%;text-align:justify}
  #brief-cover-exec-summary p:last-child{margin-bottom:0}
  /* Creative Brief — BIG TYPE, minimal chrome. No boxes, no borders: pure type
     hierarchy on the canvas with vast spacing between sections (Nothing:
     subtract, type does the work, confidence through emptiness). Monochrome,
     installed ink/gray. The one moment is the oversized verdict. */
  .cb-flow{display:flex;flex-direction:column;gap:clamp(44px,7vw,88px);width:100%;max-width:100%}
  .cb-lede{font-family:"Space Grotesk",sans-serif;font-size:clamp(17px,1.7vw,21px);line-height:1.5;font-weight:300;color:var(--ink-soft);margin:0;max-width:60ch;text-wrap:pretty}
  /* Cover hero — lead with the strongest asset (video/mockup). */
  .cb-hero{margin:10px 0 6px;max-width:820px}
  .cb-hero .cb-evidence{margin:0}
  .cb-hero-cap{font-family:"Space Grotesk",sans-serif;font-weight:500;font-size:clamp(22px,2.6vw,34px);line-height:1.1;letter-spacing:-.01em;margin:18px 0 0;color:var(--ink)}
  .cb-cover-lede{font-family:"Space Grotesk",sans-serif;font-weight:300;font-size:clamp(18px,1.9vw,24px);line-height:1.4;color:var(--ink-soft);margin:22px 0 0;max-width:60ch}
  /* Inline evidence — a medium asset thumbnail inside the story + CTAs. */
  .cb-evidence{margin:28px 0 0;max-width:460px}
  .cb-evidence--video{max-width:540px}
  .cb-evidence img,.cb-evidence video{display:block;width:100%;height:auto;border-radius:14px;border:1px solid var(--line);box-shadow:0 14px 38px rgba(0,0,0,.16)}
  .cb-evidence figcaption{margin-top:14px}
  /* CTAs — Download only (solid ink). Contact CTAs removed from the brief. */
  .cb-cta-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
  .cb-cta-row--lg{margin-top:30px}
  .cb-cta{display:inline-flex;align-items:center;font-family:"Space Mono",monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;text-decoration:none;padding:13px 24px;border-radius:999px;border:1px solid var(--ink);background:transparent;color:var(--ink)}
  .cb-cta--dl,.cb-cta--solid{background:var(--ink);color:#f6f3ea}
  .cb-cta:hover{opacity:.86}
  /* Full-bleed bento tiles (Key Insight ink verdict) span the row at EVERY
     width — the base brief CSS only defines .s4 above 760px, so below it the
     tile collapsed to half. */
  .cb-page .bento .s3,.cb-page .bento .s4{grid-column:1 / -1}
  /* Deliverables — bordered grid (Nothing: structure is ornament). Connected
     hairline cells, no fill, no shadows, no radius — matches the document's
     other grids. Each cell: index → media → name → description → CTAs. */
  .cb-deliverables-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:0;border:1px solid var(--line);border-width:1px 0 0 1px;width:100%}
  .cb-deliverable{display:flex;flex-direction:column;gap:14px;min-width:0;background:transparent;border:1px solid var(--line);border-width:0 1px 1px 0;padding:clamp(20px,2.4vw,34px)}
  /* Services — same connected hairline grid as deliverables (index → name →
     description), used in the closing Contact Your Human page. */
  .cb-services-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0;border:1px solid var(--line);border-width:1px 0 0 1px;width:100%}
  .cb-service{display:flex;flex-direction:column;gap:10px;min-width:0;border:1px solid var(--line);border-width:0 1px 1px 0;padding:clamp(20px,2.4vw,32px)}
  .cb-service-idx{font-family:"Space Mono",monospace;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-soft)}
  .cb-service-name{font-family:"Space Grotesk",sans-serif;font-weight:600;font-size:clamp(17px,1.7vw,21px);line-height:1.2;color:var(--ink)}
  .cb-service-desc{font-family:"Space Grotesk",sans-serif;font-weight:300;font-size:clamp(13px,1.3vw,15px);line-height:1.5;color:var(--ink-soft);margin:0}
  /* Lede (left) + signature block (right); stacks on mobile. */
  .cb-contact-top{display:grid;grid-template-columns:1fr auto;gap:clamp(28px,5vw,72px);align-items:center;width:100%}
  .cb-contact-lede{min-width:0}
  .cb-contact-sig{display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px;flex-shrink:0;min-width:200px}
  @media(max-width:760px){.cb-contact-top{grid-template-columns:1fr;gap:32px;justify-items:start}.cb-contact-sig{align-items:flex-start;text-align:left}.cb-contact-sig .cb-human{align-items:flex-start;text-align:left}}
  .cb-contact-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
  /* LinkedIn + X buttons under each signature's role line. */
  .cb-human-socials{display:flex;gap:8px;margin-top:10px}
  .cb-human-socials a{font-family:"Space Mono",monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;color:var(--ink);border:1px solid var(--ink);padding:6px 12px;border-radius:999px;white-space:nowrap}
  .cb-human-socials a:hover{background:var(--ink);color:#f6f3ea}
  .cb-deliverable-idx{font-family:"Space Mono",monospace;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-soft)}
  /* Fixed-height media so every cell is the same size — full-page screenshots
     crop to the box (top-anchored) instead of stretching the row taller. */
  .cb-deliverable-media{margin:0;height:clamp(170px,20vw,220px);overflow:hidden;border:1px solid var(--line)}
  .cb-deliverable-media img,.cb-deliverable-media video{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}
  .cb-deliverable-media--empty{display:flex;align-items:center;justify-content:center;text-align:center;height:100%;padding:18px;border:0;font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft)}
  .cb-deliverable-name{font-family:"Space Grotesk",sans-serif;font-weight:500;font-size:clamp(20px,2vw,28px);letter-spacing:-.01em;line-height:1.05;color:var(--ink)}
  .cb-deliverable-desc{font-family:"Space Grotesk",sans-serif;font-weight:300;font-size:clamp(14px,1.4vw,17px);line-height:1.5;color:var(--ink-soft);margin:0}
  .cb-deliverable .cb-cta-row{margin-top:auto;padding-top:4px}
  .cb-deliverable .cb-cta{padding:10px 18px;font-size:11px}
  @media(max-width:760px){.cb-deliverables-grid{grid-template-columns:1fr}}
  /* Featured Post — the Suggested Post as a real X / Share Post card, mirroring
     the dashboard Post Me tile. Dark card object on the light brief canvas. */
  .cb-xpost{max-width:560px;background:#000;color:#e7e9ea;border:1px solid var(--line);border-radius:18px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.22)}
  .cb-xpost-head{display:flex;align-items:center;gap:10px;padding:16px 18px 8px}
  .cb-xpost-avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid rgba(255,255,255,.14);background:#15202b;display:block}
  .cb-xpost-id{display:flex;align-items:center;gap:5px;flex:1;min-width:0}
  .cb-xpost-name{font-weight:700;font-size:16px;color:#e7e9ea;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}
  .cb-xpost-badge{flex-shrink:0}
  .cb-xpost-handle{font-size:14px;color:#71767b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cb-xpost-logo{flex-shrink:0;color:#e7e9ea;opacity:.9}
  .cb-xpost-caption{margin:0;padding:2px 18px 12px;font-size:15px;line-height:1.45;color:#e7e9ea;white-space:pre-wrap}
  .cb-xpost-link{color:#1d9bf0}
  .cb-xpost-media{margin:0 18px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.12);aspect-ratio:16/10;background:#000}
  .cb-xpost-media video,.cb-xpost-media img{width:100%;height:100%;object-fit:cover;display:block}
  .cb-xpost-actions{display:flex;align-items:center;justify-content:space-between;padding:14px 26px 18px}
  .cb-xpost-actions span{display:flex;align-items:center;gap:6px;color:#71767b;font-size:13px}
  @media(max-width:760px){.cb-xpost{max-width:100%}}
  /* Featured Post page: post copy (oversized quote + actions) beside the video
     mock in a 2-col row; stacks on mobile. Deliverables sub-category below. */
  .cb-featured-row{display:grid;grid-template-columns:1fr minmax(0,560px);gap:clamp(28px,4vw,64px);align-items:center;width:100%;margin:0 0 clamp(40px,6vw,72px)}
  .cb-featured-copy{min-width:0;display:flex;flex-direction:column;gap:clamp(22px,3vw,34px)}
  .cb-featured-mock{min-width:0;display:flex;justify-content:center}
  .cb-post-quote{margin:0;font-family:"Space Grotesk",sans-serif;font-weight:400;font-size:clamp(20px,2.4vw,30px);line-height:1.32;color:var(--ink);border-left:4px solid var(--ink);padding-left:22px;text-wrap:pretty}
  .cb-post-actions{display:flex;flex-wrap:wrap;gap:12px}
  .cb-post-copy{cursor:pointer}
  @media(max-width:760px){.cb-featured-row{grid-template-columns:1fr;gap:28px}}
  .cb-sub-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;width:100%;border-top:1px solid var(--line);padding-top:18px;margin:0 0 22px;font-family:"Space Mono",monospace;font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink)}
  .cb-sub-head-meta{font-size:11px;letter-spacing:.16em;color:var(--ink-soft)}
  /* Site-audit page (combined): no h1-scale headers inside — the sub-heads do
     the dividing. Bigger gaps + a solid ink rule define each section; content
     drops to compact body scale. Id-scoped so it overrides the .cb-page sizes
     without affecting Key Insight / Featured / You're In. */
  #cb-what-this-site-is .cb-sub-head{margin:clamp(46px,6vw,84px) 0 22px;padding-top:22px;border-top:1.5px solid var(--ink);font-family:"Doto",monospace;font-weight:900;font-size:clamp(26px,3.6vw,46px);letter-spacing:.03em;line-height:1}
  #cb-what-this-site-is .pull{font-size:clamp(22px,2.5vw,32px);line-height:1.2;border-left-width:4px;padding-left:22px;max-width:34ch}
  #cb-what-this-site-is .sub{font-size:clamp(15px,1.5vw,18px);line-height:1.55;font-weight:300;max-width:none}
  #cb-what-this-site-is .cb-gap-t{font-size:clamp(15px,1.5vw,18px);line-height:1.4}
  #cb-what-this-site-is .cb-gap{padding:10px 0}
  #cb-what-this-site-is .meta-grid .meta-tile{padding:18px}
  #cb-what-this-site-is .meta-grid .meta-tile .v{font-size:clamp(15px,1.5vw,18px);line-height:1.35}
  #cb-what-this-site-is .cb-tag{font-size:11px;padding:9px 14px;letter-spacing:.08em}
  #cb-what-this-site-is .cb-alert{border-left-width:4px;padding-left:22px}
  /* WTIS lead — full-width statement across the page, not a narrow pull-quote. */
  #cb-what-this-site-is .cb-wtis-lead{font-family:"Space Grotesk",sans-serif;font-weight:500;font-size:clamp(22px,2.5vw,32px);line-height:1.2;border-left:4px solid var(--ink);padding-left:22px;max-width:none;width:100%;margin:0 0 6px;text-wrap:pretty}
  /* What's Missing + Biggest Risk side by side; stack on mobile. align-items
     start so the shorter column doesn't stretch. */
  #cb-what-this-site-is .cb-audit-row{display:grid;grid-template-columns:1fr 1fr;gap:clamp(28px,4vw,60px);align-items:start}
  #cb-what-this-site-is .cb-subsec{min-width:0}
  @media(max-width:760px){#cb-what-this-site-is .cb-audit-row{grid-template-columns:1fr;gap:0}}
  /* Social Share — share-card preview (left) + captured/missing checklist (right).
     Flat hairline borders, one type scale (16px Grotesk body + 11px Mono micro-
     labels), no shadows or filled badges — matches the rest of the brief. */
  .cb-social{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(28px,3.5vw,56px);align-items:start;width:100%}
  .cb-social-card{border:1px solid var(--line);overflow:hidden;background:var(--card);max-width:460px}
  .cb-social-card-img{aspect-ratio:1.91/1;overflow:hidden;background:var(--card);border-bottom:1px solid var(--line)}
  .cb-social-card-img img{width:100%;height:100%;object-fit:cover;display:block}
  .cb-social-card-img--icon{display:flex;align-items:center;justify-content:center}
  .cb-social-card-img--icon img{width:72px;height:72px;object-fit:contain}
  .cb-social-card-img--empty{display:flex;align-items:center;justify-content:center;font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft)}
  .cb-social-card-meta{display:flex;flex-direction:column;gap:6px;padding:16px 18px}
  .cb-social-card-host{font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft)}
  .cb-social-card-title{font-family:"Space Grotesk",sans-serif;font-weight:500;font-size:16px;line-height:1.3;color:var(--ink)}
  .cb-social-card-desc{font-family:"Space Grotesk",sans-serif;font-weight:300;font-size:14px;line-height:1.5;color:var(--ink-soft);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .cb-social-checks{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
  .cb-social-check{display:flex;align-items:center;gap:14px;padding:13px 0;border-bottom:1px solid var(--line)}
  .cb-social-mark{flex-shrink:0;width:16px;text-align:center;font-family:"Space Mono",monospace;font-size:13px;font-weight:400;line-height:1}
  .cb-social-check.is-ok .cb-social-mark{color:var(--ink)}
  .cb-social-check.is-miss .cb-social-mark{color:var(--ink-soft)}
  .cb-social-label{flex:1;min-width:0;font-family:"Space Grotesk",sans-serif;font-weight:400;font-size:16px;line-height:1.3;color:var(--ink)}
  .cb-social-check.is-miss .cb-social-label{color:var(--ink-soft)}
  .cb-social-status{font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft);flex-shrink:0}
  @media(max-width:760px){.cb-social{grid-template-columns:1fr;gap:24px}}
  /* Cover handoff — Nothing container: one bordered box, sig on the left,
     "what you get" on the right, split by a single hairline divider. */
  .cb-handoff{display:grid;grid-template-columns:1fr auto;align-items:center;gap:0;border:0;padding:0;margin:30px 0 0;width:100%;max-width:100%}
  .cb-handoff-sig{order:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:clamp(20px,2.6vw,32px);border-left:1px solid var(--ink)}
  .cb-cover-sig{display:block;height:auto;width:clamp(120px,13vw,168px);opacity:.9}
  /* Your Human tile — sits under the signature. */
  .cb-human{display:flex;flex-direction:column;align-items:center;text-align:center;gap:2px}
  .cb-human-label{font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-soft)}
  .cb-human-name{font-family:"Space Grotesk",sans-serif;font-weight:600;font-size:clamp(16px,1.7vw,20px);line-height:1.1;color:var(--ink)}
  .cb-human-role{font-family:"Space Grotesk",sans-serif;font-weight:300;font-size:clamp(12px,1.2vw,14px);line-height:1.2;color:var(--ink-soft)}
  .cb-package{order:1;padding:clamp(20px,2.4vw,30px);min-width:0}
  .cb-package-label{font-family:"Space Mono",monospace;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:6px}
  .cb-package-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
  .cb-package-list li{display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid var(--line);font-family:"Space Grotesk",sans-serif;font-weight:400;font-size:clamp(15px,1.5vw,19px);line-height:1.3;color:var(--ink)}
  .cb-package-thumb{flex-shrink:0;width:64px;height:46px;overflow:hidden;display:block;background:var(--card)}
  .cb-package-thumb img,.cb-package-thumb video{width:100%;height:100%;object-fit:cover;display:block}
  .cb-package-thumb--empty{background:var(--card)}
  .cb-package-text{flex:1;min-width:0}
  .cb-package-dl{flex-shrink:0;font-family:"Space Mono",monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;color:#f6f3ea;background:var(--ink);border:1px solid var(--ink);padding:7px 13px;border-radius:999px;white-space:nowrap}
  .cb-package-dl:hover{opacity:.85}
  /* Mobile — stack: line items first, signature underneath, divider becomes a
     horizontal rule between them. */
  @media(max-width:600px){
    .cb-handoff{grid-template-columns:1fr}
    .cb-handoff-sig{order:2;border-left:0;border-top:1px solid var(--ink);justify-content:flex-start}
    .cb-package{order:1}
  }
  /* Decorative motifs — dot strips, corner brackets, dotted eyebrow + index. */
  .cb-page::before{content:'';position:absolute;top:16px;left:var(--gutter);width:24px;height:24px;border-left:2px solid rgba(10,10,10,.22);border-top:2px solid rgba(10,10,10,.22);pointer-events:none}
  .cb-page::after{content:'';position:absolute;left:var(--gutter);bottom:26px;width:140px;height:11px;background-image:radial-gradient(rgba(10,10,10,.18) 1.3px,transparent 1.6px);background-size:14px 11px;pointer-events:none}
  .cb-deco{height:10px;width:128px;margin:0 0 22px;background-image:radial-gradient(rgba(10,10,10,.26) 1.4px, transparent 1.7px);background-size:13px 10px}
  .cb-page .rule{height:1px;background:rgba(0,0,0,.12);margin:22px 0 26px;max-width:520px}
  /* What's Missing — big-numbered gap list. */
  /* Numbered checklist — tight rows, small mono index + em-dash + text. */
  .cb-gaps{display:flex;flex-direction:column;gap:0;max-width:660px}
  .cb-gap{display:flex;align-items:baseline;gap:12px;padding:12px 0;border-bottom:1px solid rgba(0,0,0,.1)}
  .cb-gap-n{font-family:"Space Mono",monospace;font-weight:700;font-size:clamp(14px,1.5vw,17px);color:var(--ink-soft);line-height:1.3;flex-shrink:0}
  .cb-gap-sep{color:var(--ink-soft);flex-shrink:0}
  .cb-gap-t{font-family:"Space Grotesk",sans-serif;font-weight:500;font-size:clamp(16px,1.8vw,21px);line-height:1.35;letter-spacing:-.01em}
  /* Biggest Risk — alert block + effect tags. */
  .cb-alert{border-left:5px solid var(--ink);padding:4px 0 4px 26px;max-width:640px}
  .cb-alert .sub{margin:0}
  .cb-tags{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
  .cb-tag{font-family:"Space Mono",monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;padding:10px 16px;border:1px solid var(--line);border-radius:0;background:transparent;color:var(--ink)}
  /* ── Pushed 30% harder — bigger type + bolder decoration (scoped to Creative
     Brief pages so the executive brief is untouched). ── */
  /* Doto is monospace, so long single-word lines ("Deliverables.",
     "Opportunity.") run off-screen at a large max. Clamp so the longest token
     fits the ~1100px content column and narrow screens; break only as a last
     resort rather than overflow the page. */
  .cb-page .headline{font-size:clamp(40px,10vw,132px);line-height:.88;overflow-wrap:break-word;hyphens:auto}
  .cb-page .sec-num{font-size:clamp(130px,22vw,340px);-webkit-text-stroke-width:2px;top:16px}
  .cb-page .sub{font-size:clamp(22px,2.9vw,40px);line-height:1.22}
  .cb-page .pull{font-size:clamp(34px,4.4vw,60px);border-left-width:6px;padding-left:30px;max-width:22ch;line-height:1.08}
  .cb-page .bento .tile.ink .word{font-size:clamp(34px,4.8vw,62px);line-height:1.04}
  /* Intro split — You're In (left) + Key Insight (right) on one page; oversized
     labels sit side by side on desktop and stack on mobile. Headline scoped down
     from the full-page size so two columns fit the content width. */
  #cb-intro-split .cb-split{display:grid;grid-template-columns:1fr 1fr;gap:clamp(28px,4vw,64px);align-items:start;width:100%}
  #cb-intro-split .cb-split--single{grid-template-columns:1fr}
  #cb-intro-split .cb-split-col{min-width:0}
  #cb-intro-split .headline{font-size:clamp(34px,6.4vw,92px)}
  #cb-intro-split .rule{max-width:none}
  /* Welcome description reads as supporting copy, not a headline-scale pull. */
  #cb-intro-split .pull{font-size:clamp(17px,2vw,26px);line-height:1.34;max-width:36ch;border-left-width:4px;padding-left:22px}
  /* Onboarded copy — a lead statement (ink bar) over spaced, marked points so
     the column reads cleanly and fills the space. */
  #cb-intro-split .cb-onboard-copy{display:flex;flex-direction:column;gap:clamp(15px,1.9vw,24px);max-width:56ch}
  #cb-intro-split .cb-onboard-lead{font-family:"Space Grotesk",sans-serif;font-weight:500;font-size:clamp(18px,1.9vw,24px);line-height:1.3;color:var(--ink);margin:0;border-left:4px solid var(--ink);padding-left:18px}
  #cb-intro-split .cb-onboard-line{position:relative;font-family:"Space Grotesk",sans-serif;font-weight:300;font-size:clamp(14px,1.45vw,17px);line-height:1.56;color:var(--ink-soft);margin:0;padding-left:18px}
  #cb-intro-split .cb-onboard-line::before{content:'';position:absolute;left:0;top:.6em;width:7px;height:7px;border:1.5px solid var(--ink);background:transparent}
  @media(max-width:760px){#cb-intro-split .cb-split{grid-template-columns:1fr;gap:10px}}
  /* You're In flow — connected hairline grid, straight edges, no fill (matches
     the deliverables grid for document-wide consistency). */
  .cb-page .flow{gap:0;border:1px solid var(--line);border-width:1px 0 0 1px}
  .cb-page .flow .node{padding:28px;border:1px solid var(--line);border-width:0 1px 1px 0;border-radius:0;background:transparent}
  .cb-page .flow .node .t{font-size:clamp(32px,3.8vw,46px)}
  /* The Opportunity grid — connected hairline cells, straight edges, no fill
     (matches the deliverables + flow grids). */
  .cb-page .meta-grid{gap:0;border:1px solid var(--line);border-width:1px 0 0 1px;margin-top:8px}
  .cb-page .meta-grid .meta-tile{padding:22px;background:transparent;border:1px solid var(--line);border-width:0 1px 1px 0;border-radius:0}
  .cb-page .meta-grid .meta-tile .v{font-size:clamp(18px,2.1vw,27px);font-weight:500;line-height:1.25}
  /* The trailing upside line drops to a readable body size with clear space
     above so it never collides with the grid (the giant .sub is for headlines). */
  #cb-opportunity .sub{font-size:clamp(15px,1.6vw,19px);line-height:1.55;font-weight:300;margin:clamp(40px,5vw,68px) 0 0;max-width:none}
  .cb-deco{width:188px;height:14px;background-size:18px 14px}
  .cb-gap-t{font-size:clamp(17px,1.9vw,22px)}
  .cb-alert{border-left-width:7px;padding-left:34px}
  .cb-tag{font-size:13px;padding:12px 20px;letter-spacing:.1em}
  /* Download buttons for deliverable assets. */
  .cb-dl-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
  .cb-dl{display:inline-flex;align-items:center;gap:6px;font-family:"Space Mono",monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink);text-decoration:none;padding:9px 16px;border:1px solid var(--line);border-radius:999px;background:var(--card)}
  .cb-dl:hover{background:var(--ink);color:#f6f3ea;border-color:var(--ink)}
  #onboarding-cover-mockup .cb-dl{margin-top:10px}
  .cb-verdict{font-family:"Space Grotesk",sans-serif;font-size:clamp(32px,6vw,72px);line-height:1.02;font-weight:500;letter-spacing:-.025em;color:var(--ink);margin:0;max-width:18ch;text-wrap:balance}
  .cb-sec{display:flex;flex-direction:column;gap:14px;max-width:60ch}
  .cb-eyebrow{font-family:"Space Mono",monospace;font-size:12px;letter-spacing:.26em;text-transform:uppercase;color:var(--ink-soft)}
  .cb-text{font-family:"Space Grotesk",sans-serif;font-size:clamp(18px,2vw,26px);line-height:1.42;font-weight:300;color:var(--ink);margin:0;text-wrap:pretty}
  .cb-decision{font-family:"Space Grotesk",sans-serif;font-size:clamp(28px,4vw,52px);line-height:1.06;font-weight:500;letter-spacing:-.02em;color:var(--ink);margin:0;max-width:20ch;text-wrap:balance}
  .cb-points{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
  .cb-points li{position:relative;padding-left:22px;font-family:"Space Grotesk",sans-serif;font-size:clamp(16px,1.6vw,19px);line-height:1.45;font-weight:300;color:var(--ink)}
  .cb-points li::before{content:'';position:absolute;left:0;top:0.62em;width:7px;height:7px;border-radius:50%;background:var(--ink)}
  .cb-proof{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 44px}
  .cb-proof-item{display:flex;flex-direction:column;gap:3px}
  .cb-proof-name{font-family:"Space Grotesk",sans-serif;font-size:clamp(17px,1.7vw,22px);font-weight:500;color:var(--ink);letter-spacing:-.01em}
  .cb-proof-desc{font-family:"Space Grotesk",sans-serif;font-size:clamp(14px,1.3vw,16px);line-height:1.45;font-weight:300;color:var(--ink-soft)}
  .cb-closer{font-family:"Space Mono",monospace;font-size:13px;line-height:1.6;letter-spacing:.02em;color:var(--ink-soft);margin:0;max-width:52ch}
  @media(max-width:760px){
    .cb-proof{grid-template-columns:1fr;gap:18px}
  }
  .cover .meta{margin-top:18px;padding-top:14px;gap:14px 32px}
  /* Brand band — one line, letters spread edge-to-edge across the full width
     (flex space-between), never wrapping or clipping. */
  .cover .marquee{
    margin-top:20px;
    display:flex;
    justify-content:space-between;
    align-items:center;
    white-space:nowrap;
    overflow:hidden;
  }
  .cover .marquee span{display:inline-block;flex:0 0 auto}
  /* Onboarding brief — multi-device mockup pinned to the cover's top-right,
     small, occupying the right half; cover text narrows to the left. */
  /* Mockup fills the right side: spans from 53% to the right gutter, so it
     grows with the page while the cover copy (capped at 48%) never reaches
     it — a clean ~5% gap regardless of --gutter. */
  #onboarding-cover-mockup{
    position:absolute;
    top:clamp(56px,10vh,130px);
    left:53%;
    right:var(--gutter);
    z-index:2;
    pointer-events:none;
  }
  #onboarding-cover-mockup img{
    display:block;width:100%;height:auto;
    filter:drop-shadow(0 18px 40px rgba(0,0,0,.16));
  }
  @media(min-width:760px){
    /* Only the title block stays in the left half beside the mockup; the
       summary and meta row below it span the full page width. */
    .cover--has-onboarding-mockup .title-stack{max-width:48%}
    /* Justify both lines so the weather block has flush left+right edges
       (no ragged end) while staying within the left-half column. */
    .cover--has-onboarding-mockup #brief-cover-weather{
      max-width:100%;line-height:1.6;
      text-align:justify;text-align-last:justify;
    }
  }
  @media(max-width:759px){
    /* Mobile: let it sit static under the headline instead of overlapping. */
    #onboarding-cover-mockup{position:static;left:auto;width:100%;margin:16px 0 4px}
    .cap-brief-email-cta-row{left:0;right:0;justify-content:center;}
    .cover .title-stack{margin-top:0}
  }
  @media(max-width:480px){
    /* Small phones: push mockup down to clear the fixed CTA button. */
    #onboarding-cover-mockup{margin-top:46px}
  }
  </style>
</head>
<body>
  <section class="page cover${isCoverMockup ? ' cover--has-onboarding-mockup' : ''}">
    <div class="sec-num">00</div>
    ${isCoverMockup ? `<div id="onboarding-cover-mockup" aria-hidden="true"><img src="${esc(mockupSrc)}" alt="Homepage device mockup" /></div>` : ''}
    <div class="title-stack">
      <div class="cap-brief-email-cta-row">
        <a id="brief-email-cta" class="cap-brief-email-cta" href="https://calendly.com/bballi/30min" target="_blank" rel="noopener noreferrer">
          <img src="/img/profile2_400x400.png?v=1774582808" alt="" aria-hidden="true" />
          Meet with a Human
          <span class="arrow" aria-hidden="true">↗</span>
        </a>
      </div>
      ${weather?.today ? `<div id="brief-cover-weather">${esc(`${weather.place || 'Local'} · ${weather.today.short} ${weather.today.temp}°${weather.today.unit}`)}${weather.days?.length > 1 ? esc(' · ' + weather.days.slice(1, 3).map((d) => `${d.name.slice(0, 3)} ${d.short.split(/\s+/).slice(0, 2).join(' ')} ${d.temp}°`).join(' · ')) : ''}</div>` : ''}
      <div class="cover-brief-name">${esc(briefLabel)}</div>
      <h1 class="headline">${headlineDateLines}</h1>
    </div>
    ${coverSubHtml}
    <div class="meta">
      <div><div class="k">Date</div><div class="v">${esc(dateLine)}</div></div>
      <div><div class="k">Site</div><div class="v">${esc(hostnameOf(websiteUrl) || '—')}</div></div>
      <div><div class="k">Brief Title</div><div class="v">${esc(briefLabel)}</div></div>
      <div><div class="k">Account</div><div class="v mono" style="font-size:13px">${esc(userEmail || '—')}</div></div>
    </div>
    <div class="marquee">${brandUpper.split('').map((ch) => `<span>${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('')}</div>
  </section>
${_creativeBrief ? _creativeBrief.pages : ''}
${bodySections}
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
  // Whole-handler guard: any uncaught throw surfaces its message in the
  // response (and full stack in the server log) instead of a blank 500.
  try {
    const wantsPdf = request.nextUrl?.searchParams?.get('format') === 'pdf';
    const res = await handleGet(request);
    // ?format=pdf — re-render the same brief HTML to PDF via Browserless
    // (same path the leadgen estimate uses). Only convert successful HTML;
    // error pages pass through so the client sees the real status/message.
    if (wantsPdf && res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
      const html = await res.text();
      const pdf = await renderPdfBuffer({ html, pdfMode: 'edge-to-edge' });
      if (!pdf.ok) {
        return new Response(pdf.warning?.message || 'Brief PDF render unavailable.', { status: 503 });
      }
      const key = request.nextUrl?.searchParams?.get('brief') || 'brief';
      const fileName = `${String(key).replace(/[^a-z0-9-_]+/gi, '-')}.pdf`;
      return new Response(pdf.buffer, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${fileName}"`,
          'cache-control': 'no-store',
        },
      });
    }
    return res;
  } catch (err) {
    console.error('[brief-preview] GET failed:', err);
    return errorPage(500, `brief-preview failed: ${err?.message || 'unknown error'}`);
  }
}

async function handleGet(request) {
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
  // Previous succeeded run timestamp — drives the "The Last N Hours" headline.
  let previousRunAt = null;
  try {
    const prevSnap = await fb.adminDb
      .collection('clients').doc(clientId)
      .collection('brief_runs')
      .orderBy('createdAt', 'desc')
      .limit(6)
      .get();
    const prior = prevSnap.docs
      .filter((d) => d.id !== dash.latestRunId)
      .map((d) => d.data())
      .find((r) => r?.status === 'succeeded' && (r.completedAt || r.createdAt));
    const ts = prior?.completedAt || prior?.createdAt;
    previousRunAt = ts?.toDate ? ts.toDate().toISOString() : (ts || null);
  } catch { /* non-fatal — section falls back to "Since Day One." */ }
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
  // Latest studio motion mockup (user-recorded/cloud-rendered from the Studio
  // card). Most-recent capture wins; absent on most first runs (the section
  // renders '' then). Feeds the Creative Brief 'creative-studio' section.
  const studioVideoUrl = (() => {
    const caps = Array.isArray(dash.studioCaptures) ? dash.studioCaptures : [];
    const vids = caps.filter((c) => c && c.type === 'studio_video' && c.downloadUrl);
    return vids.length ? vids[vids.length - 1].downloadUrl : null;
  })();
  const cardRollup = {
    moduleBriefs: dash.moduleBriefs?.items || [],
    auditMockupUrl: dash.artifacts?.homepageDeviceMockup?.downloadUrl || null,
    studioVideoUrl,
    // Social share preview (OG image) — feeds the Creative Brief social section.
    socialPreviewImageUrl: dash.siteMeta?.ogImage || null,
    // Full homepage meta — drives the Social Share capture checklist (what
    // social tags were/weren't found) + favicon fallback in Your Website Status.
    siteMeta: dash.siteMeta || null,
    // Full-page captures (same source as the Cross-Device Layouts card) so the
    // deliverables show full-page shots, not just the viewport homepage.
    fullPageScreenshots: dash.artifacts?.fullPageScreenshots || null,
    company: {
      brandOverview: dash.snapshot?.brandOverview || null,
      brandTone: dash.snapshot?.brandTone || null,
      onboardingSummary,
      knowledgeBaseSources: dash.knowledgeBase?.sources || [],
      conversationItemCount,
    },
    researchConfig,
    strategyData: {
      strategy30: dash.strategy30 || null,
      strategyBuilder: dash.strategyBuilder?.lastPlan || null,
      strategy: dash.strategy || null,
    },
    signalsCore: Array.isArray(dash.signals?.core) ? dash.signals.core : [],
    socialQueue: await readSocialQueue(clientId).catch(() => []),
  };

  const marketingBrief = dash.marketingBrief || null;
  // ?brief=<composition key> selects a named brief (onboarding, competitor,
  // strategy, …) assembled from the section registry. Unknown keys fall back
  // to the default executive-daily composition.
  const briefTypeParam = request.nextUrl?.searchParams?.get('brief') || null;
  const briefType = briefTypeParam || DEFAULT_BRIEF_TYPE;
  // Onboarding vs Executive label is by run sequence, not composition: the
  // client's first scout-brief is the Onboarding Brief, all later ones are
  // Executive. Only overrides the label for the default/main brief — named
  // agent briefs (Market/Creative/Strategy/Website) keep their own labels.
  const renderedRunId = dash?.modules?.['marketing-brief']?.lastRunId || dash?.latestRunId || null;
  const onboardingRunId = bootstrap?.onboardingRunId || null;
  // A creative-brief run (the narrow Creative Brief) ALWAYS renders the Creative
  // Brief format, even for existing clients re-running it — otherwise the
  // run-sequence check below falls back to the Executive layout.
  let renderedRunTrigger = null;
  try {
    if (renderedRunId) {
      const rrSnap = await fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(renderedRunId).get();
      renderedRunTrigger = rrSnap.exists ? (rrSnap.data()?.trigger || null) : null;
    }
  } catch { /* non-fatal — fall back to run-sequence detection */ }
  // A creative-brief OR signup run renders the Creative Brief format: signup now
  // ships only the Creative Brief deliverables (no scout/scribe data), so its
  // main brief is always the onboarding composition.
  const isCreativeBriefRun = renderedRunTrigger === 'creative-brief' || renderedRunTrigger === 'signup';
  const isMainBrief = ['executive-daily', 'onboarding'].includes(resolveBriefType(briefType)) && !briefTypeParam;
  const isOnboardingRun = isMainBrief && (isCreativeBriefRun || !onboardingRunId || renderedRunId === onboardingRunId);
  const mainBriefLabel = isOnboardingRun ? 'Creative Brief' : 'Executive Brief';

  // ── Per-run brief archiving + ?runId= resolution ──────────────────────────
  // The brief CONTENT only lives in dashboard_state (latest run, overwritten
  // each run). To make Past Briefs open the brief that was actually clicked:
  //   1. Archive the current (latest) brief onto its run doc on every render
  //      (cache-on-read) so future opens have the content.
  //   2. When ?runId= names an older run, render its archived snapshot instead
  //      of the latest.
  const requestedRunId = request.nextUrl?.searchParams?.get('runId') || null;
  // The run that actually OWNS dash.marketingBrief is the latest *succeeded*
  // scout-brief. modules['marketing-brief'].lastRunId / latestRunId can point at
  // a FAILED or module run — archiving onto those mis-attributes the content
  // (a failed run would then "open" showing the latest brief).
  let ownerRunId = renderedRunId;
  try {
    const sbSnap = await fb.adminDb.collection('clients').doc(clientId).collection('brief_runs')
      .orderBy('createdAt', 'desc').limit(10).get();
    const owner = sbSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .find((r) => r.pipelineType === 'scout-brief' && r.status === 'succeeded');
    if (owner) ownerRunId = owner.id;
  } catch { /* keep renderedRunId */ }
  let effectiveMarketingBrief = marketingBrief;
  let effectiveScribe = dash.scribe || null;
  let effectiveGeneratedAt = marketingBrief?.generatedAtIso || null;
  if (ownerRunId && marketingBrief) {
    // Fire-and-forget archive of the latest brief onto its owning run doc.
    fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(ownerRunId)
      .set({ briefSnapshot: { marketingBrief, scribe: dash.scribe || null, generatedAt: marketingBrief.generatedAtIso || null, archivedAt: new Date().toISOString() } }, { merge: true })
      .catch(() => { /* non-fatal: snapshot too large or transient */ });
  }
  if (requestedRunId && requestedRunId !== ownerRunId) {
    try {
      const reqSnap = (await fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(requestedRunId).get()).data()?.briefSnapshot || null;
      if (reqSnap?.marketingBrief) {
        effectiveMarketingBrief = reqSnap.marketingBrief;
        effectiveScribe = reqSnap.scribe || effectiveScribe;
        effectiveGeneratedAt = reqSnap.generatedAt || effectiveGeneratedAt;
      }
      // else: no archived snapshot (older run) — falls back to the latest brief.
    } catch { /* fall back to latest */ }
  }
  // Tier gate — named briefs follow BRIEF_TIER_ACCESS; admins bypass. The
  // admins lookup only runs when the tier alone would deny, so the common
  // path costs no extra read.
  if (briefTypeParam && !isBriefAllowed(dash.tier || 'free', briefType)) {
    let isAdminUser = false;
    try {
      const email = String(decoded.email || '').trim().toLowerCase();
      if (email) isAdminUser = (await fb.adminDb.collection('admins').doc(email).get()).exists;
    } catch { /* treat as non-admin */ }
    if (!isAdminUser) {
      return errorPage(403, 'This brief is part of the paid plan — upgrade to unlock it.');
    }
  }
  const preferMarketingBrief =
    Boolean(marketingBrief) &&
    (
      Boolean(briefTypeParam) ||
      request.nextUrl?.searchParams?.get('type') === 'marketing' ||
      dash?.modules?.['marketing-brief']?.lastRunId === dash.latestRunId
    );
  // Surface render failures with the real message — a bare 500 from a
  // template crash is undiagnosable from the dashboard overlay.
  const renderMarketing = () => renderMarketingBriefHtml({
    marketingBrief: effectiveMarketingBrief,
    watchlistKols,
    weather,
    ...cardRollup,
    clientName: bootstrap?.client?.companyName || dash.clientName || clientId,
    websiteUrl: bootstrap?.client?.websiteUrl || null,
    generatedAt: effectiveGeneratedAt,
    clientId,
    userEmail: bootstrap?.userProfile?.email || decoded?.email || null,
    tier: dash.tier || 'free',
    // First/main brief by run sequence renders the Creative Brief composition
    // ('onboarding' = 3 asset sections); later main briefs keep executive-daily.
    // Named briefs (?brief=) pass through unchanged.
    briefType: (isMainBrief && isOnboardingRun) ? 'onboarding' : briefType,
    // Per-brief cover paragraph (dashboard_state.briefSummaries, written by
    // brief-summary-runner after each scout-brief run). Falls back to the
    // run-level headline inside the renderer when absent.
    // Cover paragraph follows the same onboarding/executive split as the label:
    // the first brief shows the welcoming onboarding summary, later briefs the
    // JARVIS executive summary.
    coverSummary: dash.briefSummaries?.[
      isMainBrief ? (isOnboardingRun ? 'onboarding' : 'executive-daily') : resolveBriefType(briefType)
    ]?.summary || null,
    previousRunAt,
    // Override the cover/title label for the main brief by run sequence.
    displayLabel: isMainBrief ? mainBriefLabel : null,
  });

  if (preferMarketingBrief) {
    try {
      return htmlResponse(renderMarketing());
    } catch (err) {
      console.error('[brief-preview] marketing render failed:', err);
      return errorPage(500, `Brief render failed: ${err?.message || 'unknown error'}`);
    }
  }

  const scribe = effectiveScribe;
  if ((!scribe || !scribe.brief) && effectiveMarketingBrief) {
    try {
      return htmlResponse(renderMarketing());
    } catch (err) {
      console.error('[brief-preview] marketing render failed:', err);
      return errorPage(500, `Brief render failed: ${err?.message || 'unknown error'}`);
    }
  }

  // Creative Brief (onboarding) main brief: a signup / creative-brief run ships
  // only the asset deliverables + cover summary with NO scribe or marketing
  // data. Render the onboarding composition directly instead of 404ing.
  if (isMainBrief && isOnboardingRun) {
    try {
      return htmlResponse(renderMarketing());
    } catch (err) {
      console.error('[brief-preview] onboarding render failed:', err);
      return errorPage(500, `Brief render failed: ${err?.message || 'unknown error'}`);
    }
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

// Exported for offline rendering scripts (e.g. scripts/render-creative-brief.mjs).
export { renderMarketingBriefHtml };
