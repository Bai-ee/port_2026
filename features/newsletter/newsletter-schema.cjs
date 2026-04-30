// newsletter-schema.js — Client-specific newsletter section schemas
//
// Mirrors content-schema.js from not-the-rug-brief, but defines
// newsletter-format sections instead of social post types.
// Each section is a block in the rendered newsletter email.
//
// Clients override via config.newsletter.outputSchema in clients.js
// or Firestore client_configs.

const DEFAULT_SCHEMA = [
  {
    key: 'hero_story',
    label: 'HERO_STORY',
    displayLabel: 'Hero Story',
    note: 'lead narrative block',
    prompt: `[2-3 paragraphs. Turn the top escalation or content opportunity into a narrative lead.
Write like a sharp editorial — hook in the first sentence, context in the middle, payoff at the end.
Must feel like news, not marketing. Ground every claim in Scout data.]`,
    maxLength: 600,
  },
  {
    key: 'quick_hits',
    label: 'QUICK_HITS',
    displayLabel: 'Quick Hits',
    note: '3-5 signal bullets',
    prompt: `[3-5 bullet items. Each bullet is one sentence — a signal, mention, or trend from Scout.
Format: bold lead phrase + context. Example: "Competitor launched X — here's what it means for us."
Pull from brandMentions, categoryTrends, competitorIntel, and redditSignals.
No filler — every bullet must be sourced from Scout data.]`,
    maxLength: 400,
  },
  {
    key: 'metrics_snapshot',
    label: 'METRICS_SNAPSHOT',
    displayLabel: 'Metrics Snapshot',
    note: 'data-driven section',
    prompt: `[Short data block. Surface quantitative signals: review sentiment, engagement trends,
weather impact on operations, or any numeric data Scout collected.
Format as 2-4 compact stat lines. If Scout has no numeric data this cycle,
write a brief qualitative summary of the operational landscape instead.
Never fabricate numbers — only use what Scout surfaced.]`,
    maxLength: 300,
  },
  {
    key: 'upcoming',
    label: 'UPCOMING',
    displayLabel: 'On the Radar',
    note: 'forward-looking section',
    prompt: `[1-3 items. Upcoming events, launches, awareness dates, or windows of opportunity
that fall within the next 14 days. Include exact dates when known.
If Scout surfaced no upcoming events, highlight one forward-looking content opportunity
or strategic angle worth preparing for. Keep each item to 1-2 sentences.]`,
    maxLength: 300,
  },
  {
    key: 'cta',
    label: 'CTA',
    displayLabel: 'This Week\'s Move',
    note: 'strategic action item',
    prompt: `[1 paragraph. One clear, actionable recommendation for the team this week.
Derived from Scout's priority action and content opportunities.
Be specific — name the platform, the angle, and the window.
End with a concrete next step, not a vague encouragement.]`,
    maxLength: 200,
  },
];

/**
 * Resolve the newsletter section schema for a given client.
 * Falls back to DEFAULT_SCHEMA if the client hasn't defined overrides.
 */
function getNewsletterSchema(config = {}) {
  const schema = config.newsletter?.outputSchema;
  return Array.isArray(schema) && schema.length > 0 ? schema : DEFAULT_SCHEMA;
}

module.exports = {
  DEFAULT_SCHEMA,
  getNewsletterSchema,
};
