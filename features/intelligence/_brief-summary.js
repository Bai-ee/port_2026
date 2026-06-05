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
async function generateBriefSummary({ dateStr, agenda, ga4, firebase, homepage, docsText = '', config = {} }) {
  const tone = config.tone || 'concise, professional, direct';
  const extra = config.extraInstructions ? `\nAdditional instructions: ${config.extraInstructions}` : '';
  const dataBlock = compactData({ dateStr, agenda, ga4, firebase, homepage });
  const docBlock = docsText
    ? `\n\nReference documents the user uploaded (context on what's important/upcoming):\n${docsText}`
    : '';

  const system =
    `You write the opening executive summary for a daily briefing email. ` +
    `Output ONE single paragraph — no headings, no bullet points, no markdown, 80–140 words. ` +
    `Tone: ${tone}. In flowing prose cover: what is new and important today, the day's schedule, and what's coming up. ` +
    `Ground every claim in the supplied data and documents — never invent numbers or events. ` +
    `If a topic has no data, omit it gracefully rather than noting its absence.${extra}`;

  const userContent = `Here is today's data:\n\n${dataBlock}${docBlock}`;

  const response = await callAnthropic({
    model: SUMMARY_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user', content: userContent }],
  });

  const paragraph = (response?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return {
    paragraph,
    model: SUMMARY_MODEL,
    usage: extractAnthropicUsage(response, { model: SUMMARY_MODEL }),
  };
}

module.exports = { generateBriefSummary, SUMMARY_MODEL };
