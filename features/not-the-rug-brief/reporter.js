// reporter.js — Daily briefing markdown generator
//
// Runs after every Scout → Scribe → Guardian cycle.
// Reads scribeOutput (guardianFlags already attached) + loads Scout brief
// for agentData (categoryTrends, competitorIntel, brandMentions, kolActivity).
//
// Two files written per run:
//   data/briefs/{clientId}/brief-mar-09-2026-10:03pm.md   (archive)
//   data/briefs/{clientId}/latest-brief.md                 (overwrite each run)

const fs   = require('fs').promises;
const path = require('path');
const { DATA_DIR, ensureDir, generateFilename, getLatestBrief, getLatestInstagram } = require('./store');
const { requireClientConfig } = require('./clients');
const { getIntelligenceConfig, normalizeIntelligence } = require('./intelligence');
const { loadBrandVoice } = require('./knowledge');
const { getContentSchema } = require('./content-schema');
const { buildInstagramReviewInsight } = require('./services/instagram');

// --- Date / time formatting ---

const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August',
                     'September','October','November','December'];

function humanDate(date) {
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;
}

function humanTime(date) {
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

function buildDatedReportFilename(prefix, date, extension) {
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const mon = months[date.getMonth()];
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  let hours = date.getHours();
  const mins = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${prefix}-${mon}-${dd}-${yyyy}-${hours}:${mins}${ampm}.${extension}`;
}

function getDailyBriefVoice(config) {
  return loadBrandVoice(config.clientId)?.daily_brief_voice || null;
}

function buildBriefRoleNote(config) {
  const dailyBriefVoice = getDailyBriefVoice(config);
  if (!dailyBriefVoice?.role) return null;
  return `_${dailyBriefVoice.role}_`;
}

function buildSectionToneNote(config, sectionKey) {
  const dailyBriefVoice = getDailyBriefVoice(config);
  const note = dailyBriefVoice?.sections_tone?.[sectionKey];
  return note ? `_${note}_` : null;
}

// --- Section builders ---

/**
 * Section 3 — Operational Context
 */
function buildOperationalContext(normalized, config) {
  const intelligence = getIntelligenceConfig(config);
  const events = normalized.localEvents || [];
  const redditSignals = normalized.redditSignals || [];
  const competitorIntel = normalized.competitorIntel || [];
  const relationshipSignals = normalized.relationshipSignals || [];
  const signals = (normalized.primarySignals || []).slice(0, 3);
  const opportunities = (normalized.contentOpportunities || []).slice(0, 3);
  const eventsLabel = intelligence.localEventsLabel || 'Local Events';

  let competitorLines;
  if (competitorIntel.length === 0) {
    competitorLines = 'No competitor activity detected.';
  } else {
    const sorted = [...competitorIntel].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.impact] ?? 3) - (order[b.impact] ?? 3);
    });
    competitorLines = sorted
      .slice(0, 5)
      .map((c) => {
        const finding = (c.finding || '').replace(/^\[(LIVE|BACKGROUND)\]\s*/i, '');
        const label = c.url ? `[${c.competitor}](${c.url})` : c.competitor;
        return `  - **${label}** — ${finding}`;
      })
      .join('\n');
  }

  let relationshipLines;
  const activeSignals = relationshipSignals.filter(
    (signal) => !/no .* mention detected/i.test(signal.summary) && !/no mention/i.test(signal.summary)
  );
  if (activeSignals.length === 0) {
    relationshipLines = intelligence.relationshipSignalsFallback || 'No relationship signals detected this cycle.';
  } else {
    relationshipLines = activeSignals
      .map((signal) => {
        const label = signal.url ? `[${signal.name}](${signal.url})` : signal.name;
        return `  - **${label}** — ${signal.summary.slice(0, 120).trimEnd()}${signal.summary.length > 120 ? '...' : ''}`;
      })
      .join('\n');
  }

  const eventLines = events.length === 0
    ? (intelligence.localEventsFallback || 'No local events or holiday hooks surfaced this cycle.')
    : events.slice(0, 5).map((event) => {
        const label = event.event;
        const date = event.date ? ` (${event.date})` : '';
        const impact = event.impact ? ` — ${event.impact}` : '';
        const opportunity = event.opportunity ? ` Opportunity: ${event.opportunity}` : '';
        return `- **${label}**${date}${impact}${opportunity}`;
      }).join('\n');

  const redditLines = redditSignals.length === 0
    ? (intelligence.redditSignalsFallback || 'No Reddit signals surfaced this cycle.')
    : redditSignals.slice(0, 5).map((signal) => {
        const label = signal.url ? `[${signal.title}](${signal.url})` : signal.title;
        const subreddit = signal.subreddit ? ` (${signal.subreddit})` : '';
        const summary = signal.summary ? ` — ${signal.summary}` : '';
        const takeaway = signal.actionableTakeaway ? ` Takeaway: ${signal.actionableTakeaway}` : '';
        return `- **${label}**${subreddit}${summary}${takeaway}`;
      }).join('\n');

  const signalLines = signals.length === 0
    ? (intelligence.primarySignalsFallback || 'No local demand signals detected this cycle.')
    : signals.map((signal) => {
        const detail = signal.detail ? ` — ${signal.detail}` : '';
        return `- **${signal.title}**${detail}`;
      }).join('\n');

  const opportunityLines = opportunities.length === 0
    ? (intelligence.contentOpportunitiesFallback || 'No content opportunities identified this cycle.')
    : opportunities.map((opp) => {
        const name = opp.title || 'Opportunity';
        const label = opp.url ? `[${name}](${opp.url})` : name;
        const angle = opp.summary ? ` — ${opp.summary}` : '';
        const window = opp.windowHours ? ` (${opp.windowHours}h window)` : '';
        return `- **${label}**${window}${angle}`;
      }).join('\n');

  return `## 3. Operational Context
**Competitors**
${competitorLines}

**${intelligence.relationshipSignalsLabel || 'Relationship Signals'}**
${relationshipLines}

**${eventsLabel}**
${eventLines}

**${intelligence.redditSignalsLabel || 'Reddit Signals'}**
${redditLines}

**${intelligence.primarySignalsLabel || 'Local Demand Signals'}**
${signalLines}

**${intelligence.contentOpportunitiesLabel || 'Content Opportunities'}**
${opportunityLines}`;
}

/**
 * Section 1 — Our World: Weather, Competitors, Reviews, Relationship signals
 */
function buildOurWorld(normalized, config) {
  const intelligence = getIntelligenceConfig(config);
  const weather = normalized.weatherImpact;
  const reviewInsights = normalized.reviewInsights || [];
  const weatherLine = weather
    ? `${weather.summary}${weather.operationalTakeaway ? ` ${weather.operationalTakeaway}` : ''}${weather.url ? ` [Source](${weather.url})` : ''}`
    : (intelligence.weatherFallback || 'No weather impact surfaced this cycle.');

  let reviewLines;
  if (reviewInsights.length === 0) {
    reviewLines = 'No review insights detected this cycle.';
  } else {
    reviewLines = reviewInsights
      .slice(0, 5)
      .map((review) => {
        const label = review.url ? `[${review.source}](${review.url})` : review.source;
        const takeaway = review.actionableTakeaway ? ` Takeaway: ${review.actionableTakeaway}` : '';
        return `  - **${label}** — ${review.insight.slice(0, 120).trimEnd()}${review.insight.length > 120 ? '...' : ''}${takeaway}`;
      })
      .join('\n');
  }

  return `## 1. Our World

**${intelligence.weatherLabel || 'Weather Impact'}** — ${weatherLine}

**${intelligence.reviewInsightsLabel || 'Review Insights'}**
${reviewLines}`;
}

/**
 * Section 2 — Today's Content
 * Each piece quoted, with inline Guardian flags for that specific field only.
 */
function buildTodaysContent(content, flags, config) {
  const schema = getContentSchema(config);

  function piece(num, label, note, text, fieldKey) {
    if (!text) return null;
    const fieldFlags = (flags || []).filter((f) => f.field === fieldKey);
      let block = `**${num} ${label}** *(${note})*\n> ${text.replace(/\n/g, '\n> ')}`;
    if (fieldFlags.length > 0) {
      block += '\n' + fieldFlags.map((f) => `⚠ ${f.issue}`).join('\n');
    }
    return block;
  }

  const blocks = schema
    .map((field, index) => piece(`2.${index + 1}`, field.displayLabel, field.note, content[field.key], field.key))
    .filter(Boolean);

  return `## 2. Today's Content\n\n${blocks.join('\n\n')}`;
}

/**
 * Section 4 — Quality Score
 */
function buildQualityScore(guardianFlags) {
  if (!guardianFlags) return `## 4. Quality Score\nGuardian data unavailable.`;

  const { overallScore, reviewRequired, hardBlock, flags = [] } = guardianFlags;

  let headline;
  if (hardBlock) {
    headline = `🚫 HARD BLOCK — do not publish`;
  } else if (reviewRequired) {
    headline = `⚠ Review required — ${overallScore}/100`;
  } else {
    headline = `✅ Ready to publish — ${overallScore}/100`;
  }

  const showMinor = (overallScore || 100) < 80;
  const surfaced  = flags.filter((f) => f.severity === 'major' || (showMinor && f.severity === 'minor'));

  let section = `## 4. Quality Score\n${headline}`;
  if (surfaced.length > 0) {
    section += '\n' + surfaced.map((f) =>
      `- [${f.severity.toUpperCase()}][${f.type}] ${f.field}: ${f.issue}`
    ).join('\n');
  }

  return section;
}

function collectReportSources(normalized, contentOpportunities, config) {
  const intelligence = getIntelligenceConfig(config);
  const sources = [];
  const seen = new Set();

  function pushSource(url, label, section) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    sources.push({ url, label, section });
  }

  if (normalized.weatherImpact?.url) {
    pushSource(normalized.weatherImpact.url, intelligence.weatherLabel || 'Weather Impact', 'Our World');
  }

  (normalized.reviewInsights || []).slice(0, 5).forEach((review) => {
    pushSource(review.url, review.source || 'Review Insight', intelligence.reviewInsightsLabel || 'Review Insights');
  });

  (normalized.competitorIntel || []).slice(0, 5).forEach((entry) => {
    pushSource(entry.url, entry.competitor || 'Competitor', 'Competitors');
  });

  (normalized.redditSignals || []).slice(0, 5).forEach((signal) => {
    pushSource(signal.url, signal.title || 'Reddit Signal', intelligence.redditSignalsLabel || 'Reddit Signals');
  });

  (normalized.relationshipSignals || [])
    .filter((signal) => !/no .* mention detected/i.test(signal.summary) && !/no mention/i.test(signal.summary))
    .forEach((signal) => {
      pushSource(signal.url, signal.name || 'Relationship Signal', intelligence.relationshipSignalsLabel || 'Partnership / Referral Opportunities');
    });

  (contentOpportunities || normalized.contentOpportunities || []).slice(0, 3).forEach((opp) => {
    pushSource(opp.url, opp.title || 'Content Opportunity', intelligence.contentOpportunitiesLabel || 'Content Opportunities');
  });

  return sources;
}

function buildSourcesSection(sources) {
  if (!sources || sources.length === 0) return `## 5. Sources\nNo linked sources surfaced in this cycle.`;

  const lines = sources.map((source) =>
    `- **${source.section}: ${source.label}** — ${source.url}`
  );

  return `## 5. Sources\n${lines.join('\n')}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTextBlock(text) {
  const safe = escapeHtml(text || '');
  return safe
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function renderToneNote(note) {
  return note ? `<p class="tone-note">${escapeHtml(note.replace(/^_+|_+$/g, ''))}</p>` : '';
}

function renderQualityHeadline(guardianFlags) {
  if (!guardianFlags) return { label: 'Guardian data unavailable.', tone: 'neutral' };
  const { overallScore, reviewRequired, hardBlock } = guardianFlags;
  if (hardBlock) return { label: 'Hard block — do not publish', tone: 'blocked' };
  if (reviewRequired) return { label: `Review required — ${overallScore}/100`, tone: 'review' };
  return { label: `Ready to publish — ${overallScore}/100`, tone: 'ready' };
}

function buildHtmlReport({ runDate, config, normalized, content, contentOpportunities, guardianFlags }) {
  const intelligence = getIntelligenceConfig(config);
  const schema = getContentSchema(config);
  const flags = guardianFlags?.flags || [];

  const weather = normalized.weatherImpact;
  const events = normalized.localEvents || [];
  const redditSignals = normalized.redditSignals || [];
  const signals = (normalized.primarySignals || []).slice(0, 3);
  const opportunities = (contentOpportunities || normalized.contentOpportunities || []).slice(0, 3);
  const competitorIntel = normalized.competitorIntel || [];
  const reviewInsights = normalized.reviewInsights || [];
  const relationshipSignals = normalized.relationshipSignals || [];
  const quality = renderQualityHeadline(guardianFlags);
  const sources = collectReportSources(normalized, contentOpportunities, config);

  const relationshipItems = relationshipSignals.filter(
    (signal) => !/no .* mention detected/i.test(signal.summary) && !/no mention/i.test(signal.summary)
  );
  const qualityFlags = (guardianFlags?.flags || []).filter((flag) => {
    const showMinor = (guardianFlags?.overallScore || 100) < 80;
    return flag.severity === 'major' || (showMinor && flag.severity === 'minor');
  });

  const qualityClass = quality.tone === 'ready' ? 'quality-ready'
    : quality.tone === 'blocked' ? 'quality-blocked'
    : quality.tone === 'review' ? 'quality-review'
    : 'quality-neutral';

  const contentBlocks = schema
    .map((field) => {
      const text = content[field.key];
      if (!text) return '';
      const fieldFlags = flags.filter((flag) => flag.field === field.key);
      return `
        <div class="content-piece">
          <div class="content-piece-header">
            <span class="piece-label">${escapeHtml(field.displayLabel)}</span>
            <span class="piece-note">${escapeHtml(field.note)}</span>
          </div>
          <div class="content-body">${renderTextBlock(text)}</div>
          ${fieldFlags.length > 0 ? `<div class="piece-flags">${fieldFlags.map((f) => `<div class="piece-flag">&#9888; ${escapeHtml(f.issue)}</div>`).join('')}</div>` : ''}
        </div>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(config.clientName)} \u2014 Daily Brief</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Outfit:wght@300;400;500;600&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet">
  <style>
    /* === NTR DESIGN TOKENS === */
    :root {
      --cream:            #EEF4DB;
      --warm-white:       #F5F9EE;
      --charcoal:         #1F2318;
      --mid-gray:         #5C6455;
      --light-gray:       #D5E0BE;
      --sage:             #7A9068;
      --sage-light:       #B4C89E;
      --sage-dark:        #4E5A42;
      --terracotta:       #C4674B;
      --gold-light:       #E8D4A8;
      --font-display:     'Fraunces', 'DM Serif Display', serif;
      --font-body:        'Outfit', sans-serif;
      --font-italic:      'Fraunces', serif;
      --radius:           12px;
      --radius-lg:        24px;
    }

    /* === RESET === */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: var(--font-body);
      background: var(--cream);
      color: var(--charcoal);
      line-height: 1.65;
      font-size: 16px;
      -webkit-font-smoothing: antialiased;
    }
    ul { list-style: none; }
    a {
      color: var(--sage-dark);
      text-decoration: underline;
      text-decoration-thickness: 1.5px;
      text-underline-offset: 3px;
    }
    a:hover { color: var(--charcoal); }

    /* === LAYOUT === */
    .brief-wrap { max-width: 680px; margin: 0 auto; }

    /* === HERO === */
    .brief-hero {
      background: var(--sage-dark);
      padding: 52px 28px 44px;
      position: relative;
      overflow: hidden;
    }
    .brief-hero::after {
      content: '';
      position: absolute; top: 0; right: 0;
      width: 220px; height: 220px;
      background: radial-gradient(circle at top right, rgba(180,200,158,0.18) 0%, transparent 65%);
      pointer-events: none;
    }
    .hero-eyebrow {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 22px;
    }
    .hero-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--sage-light); flex-shrink: 0;
    }
    .hero-eyebrow-text {
      font-family: var(--font-italic);
      font-style: italic; font-size: 13px; font-weight: 300;
      color: var(--gold-light); letter-spacing: 0.02em;
    }
    .brief-title {
      font-family: 'Playfair Display', serif;
      font-size: clamp(36px, 9vw, 56px); font-weight: 700;
      color: white; line-height: 1.05; margin-bottom: 4px;
    }
    .brief-subtitle {
      font-family: var(--font-italic);
      font-style: italic; font-size: clamp(16px, 4vw, 20px); font-weight: 300;
      color: var(--sage-light); margin-bottom: 28px;
    }
    .brief-greeting {
      font-size: 16px; font-weight: 500;
      color: rgba(255,255,255,0.88); margin-bottom: 6px;
    }
    .brief-date {
      font-family: var(--font-italic);
      font-style: italic; font-size: 14px; font-weight: 300;
      color: rgba(255,255,255,0.5);
    }

    /* === SECTIONS === */
    .brief-section { padding: 44px 28px; }
    .bg-warm  { background: var(--warm-white); }
    .bg-cream { background: var(--cream); }
    .sep { height: 1px; background: var(--light-gray); }

    /* === SECTION HEADER === */
    .section-eyebrow {
      font-family: var(--font-italic);
      font-size: 13px; font-weight: 300; font-style: italic;
      color: var(--mid-gray); margin-bottom: 6px;
    }
    .section-title {
      font-family: var(--font-display);
      font-weight: 400; font-size: clamp(26px, 6vw, 38px);
      color: var(--charcoal); line-height: 1.1;
    }
    .section-rule {
      width: 32px; height: 2px;
      background: var(--sage); border-radius: 1px;
      margin: 16px 0 28px;
    }

    /* === SUB-HEADING === */
    .sub-head {
      display: flex; align-items: center; gap: 8px;
      font-family: var(--font-display);
      font-size: 16px; font-weight: 400;
      color: var(--charcoal); margin-bottom: 12px;
    }
    .sub-head::before {
      content: ''; display: inline-block;
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--sage); flex-shrink: 0;
    }

    /* === ITEM LIST === */
    .item-list { display: grid; gap: 10px; margin-bottom: 28px; }
    .item-list:last-child { margin-bottom: 0; }
    .item-row {
      padding: 14px 16px;
      background: var(--warm-white);
      border: 1px solid rgba(0,0,0,0.07);
      border-radius: var(--radius);
    }
    .bg-warm .item-row { background: var(--cream); }
    .item-title {
      font-size: 15px; font-weight: 600; color: var(--charcoal);
      margin-bottom: 4px;
    }
    .item-title a { font-weight: 600; }
    .item-body { font-size: 14px; color: var(--mid-gray); line-height: 1.55; }
    .item-meta { font-size: 13px; color: var(--mid-gray); font-style: italic; margin-top: 4px; }
    .item-takeaway { font-size: 13px; color: var(--charcoal); font-weight: 500; margin-top: 6px; }

    /* === WEATHER CALLOUT === */
    .weather-box {
      background: var(--light-gray);
      border-radius: var(--radius-lg);
      padding: 20px 22px;
      font-size: 16px; color: var(--charcoal);
      line-height: 1.65; margin-bottom: 28px;
    }

    /* === CONTENT PIECE === */
    .content-piece { margin-bottom: 28px; }
    .content-piece:last-child { margin-bottom: 0; }
    .content-piece-header {
      display: flex; align-items: flex-start;
      justify-content: space-between; gap: 12px;
      margin-bottom: 10px;
    }
    .piece-label {
      font-family: var(--font-display);
      font-size: 19px; font-weight: 400; color: var(--charcoal);
    }
    .piece-note {
      flex-shrink: 0; align-self: center;
      font-size: 11px; font-weight: 500;
      text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--mid-gray);
      background: var(--light-gray);
      padding: 5px 10px; border-radius: 4px;
      white-space: nowrap;
    }
    .content-body {
      font-size: 16px; color: var(--charcoal); line-height: 1.7;
      background: var(--warm-white);
      border-left: 3px solid var(--light-gray);
      padding: 16px 20px;
      border-radius: 0 var(--radius) var(--radius) 0;
    }
    .content-body p { margin: 0 0 10px; }
    .content-body p:last-child { margin-bottom: 0; }
    .piece-flags { margin-top: 12px; display: grid; gap: 8px; }
    .piece-flag {
      font-size: 14px; font-weight: 500; color: var(--terracotta);
      background: rgba(196,103,75,0.08);
      border: 1px solid rgba(196,103,75,0.2);
      border-radius: var(--radius); padding: 10px 14px;
    }

    /* === QUALITY === */
    .quality-banner {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 13px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.05em;
      padding: 10px 16px; border-radius: 6px; margin-bottom: 16px;
    }
    .quality-ready   { background: rgba(78,90,66,0.12); color: var(--sage-dark); }
    .quality-review  { background: rgba(196,103,75,0.12); color: var(--terracotta); }
    .quality-blocked { background: rgba(196,103,75,0.18); color: var(--terracotta); border: 1px solid rgba(196,103,75,0.3); }
    .quality-neutral { background: rgba(92,100,85,0.10); color: var(--mid-gray); }
    .flag-list { display: grid; gap: 8px; }
    .flag-item {
      font-size: 14px; color: var(--terracotta);
      background: rgba(196,103,75,0.07);
      border: 1px solid rgba(196,103,75,0.18);
      border-radius: var(--radius); padding: 11px 14px; line-height: 1.5;
    }

    /* === MISC === */
    .fallback { font-size: 15px; color: var(--mid-gray); font-style: italic; margin-bottom: 28px; }

    /* === MOBILE === */
    @media (max-width: 480px) {
      .brief-hero { padding: 40px 20px 36px; }
      .brief-section { padding: 36px 20px; }
      .content-piece-header { flex-direction: column; }
      .piece-note { align-self: flex-start; }
    }
  </style>
</head>
<body>

<header class="brief-hero" id="brief-hero-header">
  <div class="brief-wrap">
    <div class="hero-eyebrow">
      <div class="hero-dot"></div>
      <span class="hero-eyebrow-text">Founder Intelligence \u00b7 Brooklyn Dog Walking</span>
    </div>
    <div class="brief-title">${escapeHtml(config.clientName)}</div>
    <div class="brief-subtitle">Daily Brief</div>
    <div class="brief-greeting">Hello Team</div>
    <div class="brief-date">It\u2019s ${escapeHtml(humanDate(runDate))} \u2014 ${escapeHtml(humanTime(runDate))}</div>
  </div>
</header>

<div class="sep"></div>

<section class="brief-section bg-warm" id="section-our-world">
  <div class="brief-wrap">
    <h2 class="section-title">Our World</h2>
    <div class="section-rule"></div>

    <div class="sub-head">${escapeHtml(intelligence.weatherLabel || 'Weather Impact')}</div>
    <div class="weather-box">
      ${weather
        ? `${escapeHtml(weather.summary)}${weather.operationalTakeaway ? ` ${escapeHtml(weather.operationalTakeaway)}` : ''}${weather.url ? ` <a href="${escapeHtml(weather.url)}" target="_blank" rel="noreferrer">Source \u2192</a>` : ''}`
        : `<span class="fallback">${escapeHtml(intelligence.weatherFallback || 'No weather impact surfaced this cycle.')}</span>`
      }
    </div>

    <div class="sub-head">${escapeHtml(intelligence.reviewInsightsLabel || 'Review Insights')}</div>
    ${reviewInsights.length === 0
      ? `<p class="fallback">No review insights detected this cycle.</p>`
      : `<ul class="item-list">
          ${reviewInsights.slice(0, 5).map((review) => `
            <li class="item-row">
              <div class="item-title">${review.url ? `<a href="${escapeHtml(review.url)}" target="_blank" rel="noreferrer">${escapeHtml(review.source)}</a>` : escapeHtml(review.source)}</div>
              <div class="item-body">${escapeHtml(review.insight)}</div>
              ${review.actionableTakeaway ? `<div class="item-takeaway">Takeaway: ${escapeHtml(review.actionableTakeaway)}</div>` : ''}
            </li>`).join('')}
        </ul>`}
  </div>
</section>

<div class="sep"></div>

<section class="brief-section bg-cream" id="section-todays-content">
  <div class="brief-wrap">
    <div class="section-eyebrow">content ready to post</div>
    <h2 class="section-title">Today\u2019s Content</h2>
    <div class="section-rule"></div>
    ${contentBlocks || `<p class="fallback">No content generated this cycle.</p>`}
  </div>
</section>

<div class="sep"></div>

<section class="brief-section bg-warm" id="section-operational-context">
  <div class="brief-wrap">
    <div class="section-eyebrow">context</div>
    <h2 class="section-title">Operational Context</h2>
    <div class="section-rule"></div>

    <div class="sub-head">Competitors</div>
    ${competitorIntel.length === 0
      ? `<p class="fallback">No competitor activity detected.</p>`
      : `<ul class="item-list">
          ${[...competitorIntel]
            .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.impact] ?? 3) - ({ high: 0, medium: 1, low: 2 }[b.impact] ?? 3))
            .slice(0, 5)
            .map((c) => `
              <li class="item-row">
                <div class="item-title">${c.url ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noreferrer">${escapeHtml(c.competitor)}</a>` : escapeHtml(c.competitor)}</div>
                <div class="item-body">${escapeHtml((c.finding || '').replace(/^\[(LIVE|BACKGROUND)\]\s*/i, ''))}</div>
              </li>`).join('')}
        </ul>`}

    <div class="sub-head">${escapeHtml(intelligence.relationshipSignalsLabel || 'Partnership / Referral Opportunities')}</div>
    ${relationshipItems.length === 0
      ? `<p class="fallback">${escapeHtml(intelligence.relationshipSignalsFallback || 'No relationship signals detected this cycle.')}</p>`
      : `<ul class="item-list">
          ${relationshipItems.map((signal) => `
            <li class="item-row">
              <div class="item-title">${signal.url ? `<a href="${escapeHtml(signal.url)}" target="_blank" rel="noreferrer">${escapeHtml(signal.name)}</a>` : escapeHtml(signal.name)}</div>
              <div class="item-body">${escapeHtml(signal.summary)}</div>
            </li>`).join('')}
        </ul>`}

    <div class="sub-head">${escapeHtml(intelligence.localEventsLabel || 'Local Events')}</div>
    ${events.length === 0
      ? `<p class="fallback">${escapeHtml(intelligence.localEventsFallback || 'No local events or holiday hooks surfaced this cycle.')}</p>`
      : `<ul class="item-list">
          ${events.slice(0, 5).map((event) => `
            <li class="item-row">
              <div class="item-title">${escapeHtml(event.event)}</div>
              ${event.date ? `<div class="item-meta">${escapeHtml(event.date)}</div>` : ''}
              ${event.impact ? `<div class="item-body">${escapeHtml(event.impact)}</div>` : ''}
              ${event.opportunity ? `<div class="item-takeaway">Opportunity: ${escapeHtml(event.opportunity)}</div>` : ''}
            </li>`).join('')}
        </ul>`}

    <div class="sub-head">${escapeHtml(intelligence.redditSignalsLabel || 'Reddit Signals')}</div>
    ${redditSignals.length === 0
      ? `<p class="fallback">${escapeHtml(intelligence.redditSignalsFallback || 'No Reddit signals surfaced this cycle.')}</p>`
      : `<ul class="item-list">
          ${redditSignals.slice(0, 5).map((signal) => `
            <li class="item-row">
              <div class="item-title">${signal.url ? `<a href="${escapeHtml(signal.url)}" target="_blank" rel="noreferrer">${escapeHtml(signal.title)}</a>` : escapeHtml(signal.title)}</div>
              ${signal.subreddit ? `<div class="item-meta">${escapeHtml(signal.subreddit)}</div>` : ''}
              ${signal.summary ? `<div class="item-body">${escapeHtml(signal.summary)}</div>` : ''}
              ${signal.actionableTakeaway ? `<div class="item-takeaway">Takeaway: ${escapeHtml(signal.actionableTakeaway)}</div>` : ''}
            </li>`).join('')}
        </ul>`}

    <div class="sub-head">${escapeHtml(intelligence.primarySignalsLabel || 'Local Demand Signals')}</div>
    ${signals.length === 0
      ? `<p class="fallback">${escapeHtml(intelligence.primarySignalsFallback || 'No local demand signals detected this cycle.')}</p>`
      : `<ul class="item-list">
          ${signals.map((signal) => `
            <li class="item-row">
              <div class="item-title">${escapeHtml(signal.title)}</div>
              ${signal.detail ? `<div class="item-body">${escapeHtml(signal.detail)}</div>` : ''}
            </li>`).join('')}
        </ul>`}

    <div class="sub-head">${escapeHtml(intelligence.contentOpportunitiesLabel || 'Content Opportunities')}</div>
    ${opportunities.length === 0
      ? `<p class="fallback">${escapeHtml(intelligence.contentOpportunitiesFallback || 'No content opportunities identified this cycle.')}</p>`
      : `<ul class="item-list">
          ${opportunities.map((opp) => `
            <li class="item-row">
              <div class="item-title">${opp.url ? `<a href="${escapeHtml(opp.url)}" target="_blank" rel="noreferrer">${escapeHtml(opp.title || 'Opportunity')}</a>` : escapeHtml(opp.title || 'Opportunity')}</div>
              ${opp.windowHours ? `<div class="item-meta">${escapeHtml(String(opp.windowHours))}h window</div>` : ''}
              ${opp.summary ? `<div class="item-body">${escapeHtml(opp.summary)}</div>` : ''}
            </li>`).join('')}
        </ul>`}
  </div>
</section>

<div class="sep"></div>

<section class="brief-section bg-warm" id="section-quality-score">
  <div class="brief-wrap">
    <div class="section-eyebrow">guardian review</div>
    <h2 class="section-title">Quality Score</h2>
    <div class="section-rule"></div>
    <div class="quality-banner ${qualityClass}">${escapeHtml(quality.label)}</div>
    ${qualityFlags.length === 0
      ? `<p class="fallback">No surfaced issues.</p>`
      : `<div class="flag-list">
          ${qualityFlags.map((flag) => `<div class="flag-item">[${escapeHtml(flag.severity.toUpperCase())}][${escapeHtml(flag.type)}] ${escapeHtml(flag.field)}: ${escapeHtml(flag.issue)}</div>`).join('')}
        </div>`}
  </div>
</section>

<div class="sep"></div>

<section class="brief-section bg-cream" id="section-sources">
  <div class="brief-wrap">
    <div class="section-eyebrow">references</div>
    <h2 class="section-title">Sources</h2>
    <div class="section-rule"></div>
    ${sources.length === 0
      ? `<p class="fallback">No linked sources surfaced in this cycle.</p>`
      : `<ul class="item-list">
          ${sources.map((source) => `
            <li class="item-row">
              <div class="item-title">${escapeHtml(source.section)}: ${escapeHtml(source.label)}</div>
              <div class="item-body"><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.url)}</a></div>
            </li>`).join('')}
        </ul>`}
  </div>
</section>

</body>
</html>`;
}

// --- Main generator ---

/**
 * Generate and save the daily briefing markdown.
 *
 * @param {object} scribeOutput - Full Scribe output (guardianFlags already attached)
 * @param {string} clientId
 * @returns {string|null} Archive file path on success, null on failure
 */
async function generateReport(scribeOutput, clientId) {
  try {
    const runDate = new Date(scribeOutput.timestamp || Date.now());
    const config = requireClientConfig(clientId);

    const clientLabel = config.clientName;
    // Load Scout brief for agentData, then normalize client-specific section names.
    const scoutBrief = await getLatestBrief(clientId);
    const normalized = normalizeIntelligence(scoutBrief?.agentData || {}, config);
    const instagramReport = await getLatestInstagram(clientId);
    const instagramReviewInsight = buildInstagramReviewInsight(instagramReport);
    if (instagramReviewInsight) {
      normalized.reviewInsights = [instagramReviewInsight, ...(normalized.reviewInsights || [])];
    }

    const { content = {}, contentOpportunities, guardianFlags } = scribeOutput;
    const flags = guardianFlags?.flags || [];
    const sources = collectReportSources(normalized, contentOpportunities, config);

    // --- Build all sections ---
    const sections = [
      `# ${clientLabel} — Daily Brief`,
      `Hello Team 👋`,
      `**It's ${humanDate(runDate)} — ${humanTime(runDate)}**`,
      '---',
      buildOurWorld(normalized, config),
      '---',
      buildTodaysContent(content, flags, config),
      '---',
      buildOperationalContext(normalized, config),
      '---',
      buildQualityScore(guardianFlags),
      '---',
      buildSourcesSection(sources),
    ].join('\n\n');

    const html = buildHtmlReport({
      runDate,
      config,
      normalized,
      content,
      contentOpportunities,
      guardianFlags,
    });

    // --- Write files ---
    const dir = path.join(DATA_DIR, 'briefs', clientId);
    await ensureDir(dir);

    const archiveName = generateFilename('brief').replace(/\.json$/, '.md');
    const archivePath = path.join(dir, archiveName);
    const latestPath  = path.join(dir, 'latest-brief.md');
    const htmlArchiveName = buildDatedReportFilename('NotTheRug', runDate, 'html');
    const htmlArchivePath = path.join(dir, htmlArchiveName);
    const htmlLatestPath = path.join(dir, 'latest-brief.html');

    await fs.writeFile(archivePath, sections, 'utf-8');
    await fs.writeFile(latestPath,  sections, 'utf-8');
    await fs.writeFile(htmlArchivePath, html, 'utf-8');
    await fs.writeFile(htmlLatestPath, html, 'utf-8');

    console.log(`[REPORTER] Brief saved: ${archiveName}, ${htmlArchiveName}`);
    return { markdownPath: archivePath, htmlPath: htmlArchivePath };

  } catch (err) {
    console.error(`[REPORTER] Failed to generate brief: ${err.message}`);
    return null;
  }
}

module.exports = { generateReport };
