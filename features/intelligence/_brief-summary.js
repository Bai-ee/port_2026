'use strict';

// _brief-summary.js — LLM executive summary for the daily digest.
// Takes already-collected digest data + recent knowledge-base document text and
// produces a single prose paragraph: what's new/important today, the day's
// schedule, and what's coming up. Network I/O (one Anthropic call) only.

const { callAnthropic, extractAnthropicUsage } = require('../scout-intake/_anthropic-client.js');

const SUMMARY_MODEL = process.env.DIGEST_SUMMARY_MODEL || 'claude-haiku-4-5-20251001';
const MAX_OUTPUT_TOKENS = 600;

/** Flatten collected digest data into a compact, model-readable data block. */
function compactData({ dateStr, agenda, ga4, firebase, homepage }) {
  const lines = [`Date: ${dateStr}`];

  if (agenda?.events?.length) {
    lines.push("Today's calendar:");
    agenda.events.forEach((e) => {
      lines.push(`- ${e.timeLabel}: ${e.summary}${e.location ? ` @ ${e.location}` : ''}`);
    });
  } else {
    lines.push("Today's calendar: nothing scheduled.");
  }

  if (ga4?.overview) {
    const o = ga4.overview;
    lines.push(
      `Site traffic (24h): ${o.sessions} sessions, ${o.totalUsers} visitors, ` +
        `${o.pageViews} pageviews, ${o.newUsers} new, bounce ${o.bounceRate}%.`
    );
  }
  if (ga4?.topPages?.length) {
    lines.push('Top pages: ' + ga4.topPages.slice(0, 5).map((p) => `${p.path} (${p.views})`).join(', '));
  }

  lines.push(
    `Platform (24h): ${firebase?.newUsers || 0} new sign-ups, ${firebase?.recentRuns || 0} dashboards created. ` +
      `Totals: ${firebase?.totalUsers || 0} users, ${firebase?.totalClients || 0} clients.`
  );
  if (firebase?.newUsersList?.length) {
    lines.push('New users: ' + firebase.newUsersList.slice(0, 8).map((u) => u.email).join(', '));
  }

  if (homepage?.totalEvents) {
    const top = (homepage.topTargets || []).slice(0, 5).map((t) => `${t.name} (${t.count})`).join(', ');
    lines.push(`Homepage interactions (24h): ${homepage.totalEvents} events${top ? `. Top: ${top}` : ''}`);
  }

  return lines.join('\n');
}

/**
 * Generate the executive-summary paragraph.
 * @returns {Promise<{ paragraph: string, model: string, usage: object }>}
 */
async function generateBriefSummary({ dateStr, agenda, ga4, firebase, homepage, docsText = '', briefText = '', clientBrainContext = '', config = {} }) {
  const tone = config.tone || 'concise, professional, direct';
  const extra = config.extraInstructions ? `\nAdditional instructions: ${config.extraInstructions}` : '';
  const dataBlock = compactData({ dateStr, agenda, ga4, firebase, homepage });
  const briefBlock = briefText ? `\n\n${briefText}` : '';
  const brainBlock = clientBrainContext
    ? `\n\nClient brand context (the approved Client Brain — match this voice/positioning and honor its do-not-use language):\n${clientBrainContext}`
    : '';
  const docBlock = docsText
    ? `\n\nReference documents the user uploaded (context on what's important/upcoming):\n${docsText}`
    : '';

  const system =
    `You write the executive summary for a daily briefing email as SCOPED CALLOUTS — the email is a short tease; all detail lives in the linked brief. ` +
    `Output ONLY valid JSON. No markdown fences, no prose outside the JSON. ` +
    `Shape: {"lead": string, "callouts": [{"category": string, "headline": string, "line": string}]}. ` +
    `"lead" = one sentence (≤22 words): the single most important thing today. ` +
    `"callouts" = 3–5 items, ordered by importance, ONLY for categories that have real data. ` +
    `"category" MUST be one of: Platform, Traffic, Calendar, Strategy, Engagement, Pipeline. ` +
    `"headline" = 2–5 word title. "line" = one tight sentence (≤24 words). ` +
    `Tone: ${tone}. Each callout covers exactly one domain so a reader can scan 1-2-3-4. ` +
    `Map the data: sign-ups/users/dashboards → Platform; GA4 sessions/pages/sources → Traffic; calendar events → Calendar; ` +
    `post ideas/KOLs/competitors/narratives from the brief → Strategy; homepage clicks/scroll/vitals → Engagement; run/deploy status → Pipeline. ` +
    `Ground every claim in the supplied data, brief, and documents — never invent numbers, posts, or events. Omit categories with no data.` +
    `${clientBrainContext ? ' When client brand context is supplied, match its voice and positioning and avoid its do-not-use language.' : ''}${extra}`;

  const userContent = `Here is today's data:\n\n${dataBlock}${briefBlock}${brainBlock}${docBlock}`;

  const response = await callAnthropic({
    model: SUMMARY_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user', content: userContent }],
  });

  const raw = (response?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  const { lead, callouts } = parseCallouts(raw);
  // Back-compat: consumers (response payload, template field, any non-callout
  // renderer) still get a flat paragraph built from the structured callouts.
  const paragraph = callouts.length
    ? [lead, ...callouts.map((c) => `${c.headline}: ${c.line}`)].filter(Boolean).join(' ')
    : raw;

  return {
    paragraph,
    lead,
    callouts,
    model: SUMMARY_MODEL,
    usage: extractAnthropicUsage(response, { model: SUMMARY_MODEL }),
  };
}

const ALLOWED_CATEGORIES = ['Platform', 'Traffic', 'Calendar', 'Strategy', 'Engagement', 'Pipeline'];

/** Parse the model's JSON callout output, tolerating ```json fences / stray
 *  prose. Returns { lead, callouts } — callouts [] when parsing fails so the
 *  renderer falls back to the flat paragraph. */
function parseCallouts(text) {
  if (!text || typeof text !== 'string') return { lead: '', callouts: [] };
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return { lead: '', callouts: [] };
  let obj = null;
  try { obj = JSON.parse(text.slice(start, end + 1)); } catch { return { lead: '', callouts: [] }; }
  if (!obj || typeof obj !== 'object') return { lead: '', callouts: [] };
  const lead = typeof obj.lead === 'string' ? obj.lead.trim() : '';
  const callouts = (Array.isArray(obj.callouts) ? obj.callouts : [])
    .map((c) => ({
      category: ALLOWED_CATEGORIES.includes(c?.category) ? c.category : 'Strategy',
      headline: String(c?.headline || '').trim(),
      line: String(c?.line || '').trim(),
    }))
    .filter((c) => c.headline || c.line)
    .slice(0, 5);
  return { lead, callouts };
}

/**
 * Generate short X (Twitter) promo posts for a set of brand videos — one per
 * video, in order. Used by the daily digest's "Post content" block.
 * @returns {Promise<string[]>} captions (may be shorter than `videos` on error)
 */
async function generateVideoPromoPosts({ videos = [], clientBrainContext = '', config = {} } = {}) {
  if (!Array.isArray(videos) || !videos.length) return [];
  const tone = config.tone || 'concise, professional, direct';
  const list = videos
    .map((v, i) => `Video ${i + 1}: ${v.durationSeconds || 30}s clip${Array.isArray(v.sourceFolders) && v.sourceFolders.length ? `, scenes: ${v.sourceFolders.join(', ')}` : ''}.`)
    .join('\n');
  const system =
    `You write short promo posts for X (Twitter) advertising a brand's short videos. ` +
    `Output ONLY valid JSON: {"posts":[{"caption": string}]} — one entry per video, in order. ` +
    `Each caption ≤ 200 characters, hook-first, punchy, at most 2 hashtags, no markdown, no quotes around it. ` +
    `Tone: ${tone}.` +
    `${clientBrainContext ? ' Match the brand voice/positioning in the supplied context and avoid its do-not-use language.' : ''}`;
  const user = `Write one X promo post per video below.\n\n${list}${clientBrainContext ? `\n\nBrand context:\n${clientBrainContext}` : ''}`;

  const response = await callAnthropic({
    model: SUMMARY_MODEL,
    max_tokens: 500,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const raw = (response?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return [];
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    return (Array.isArray(obj.posts) ? obj.posts : []).map((p) => String(p?.caption || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { generateBriefSummary, generateVideoPromoPosts, SUMMARY_MODEL };
