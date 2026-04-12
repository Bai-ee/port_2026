// content-schema.js — client-specific Scribe output schemas

const DEFAULT_SCHEMA = [
  {
    key: 'x_post',
    label: 'X_POST',
    displayLabel: 'X Post',
    note: 'ready to post',
    prompt: '[One post, max 280 characters. Hook in first 5 words. No hashtag spam — max 2 relevant tags.]',
  },
  {
    key: 'x_thread_opener',
    label: 'X_THREAD_OPENER',
    displayLabel: 'X Thread Opener',
    note: 'post first, build thread after',
    prompt: '[First tweet of a thread, max 280 characters. Must stand alone. Makes people want to read on. Label as "1/"]',
  },
  {
    key: 'discord_announcement',
    label: 'DISCORD_ANNOUNCEMENT',
    displayLabel: 'Discord Announcement',
    note: 'post in #announcements',
    prompt: '[2-3 sentences. Casual, community voice. Team talking, not broadcasting.]',
  },
  {
    key: 'content_angle',
    label: 'CONTENT_ANGLE',
    displayLabel: 'Content Angle',
    note: 'strategist review',
    prompt: '[One paragraph. Strategic angle behind this content. What narrative are we building toward? For the human strategist to review.]',
  },
];

function getContentSchema(config = {}) {
  const schema = config.scribe?.outputSchema;
  return Array.isArray(schema) && schema.length > 0 ? schema : DEFAULT_SCHEMA;
}

module.exports = {
  DEFAULT_SCHEMA,
  getContentSchema,
};
