'use strict';

// events-search.js — One-shot event discovery via web search.
//
// Two modes:
//   local  — upcoming events near a ZIP code (neighborhood/community use case,
//            e.g. a dog walker wanting to know what's happening locally).
//   global — upcoming events/conferences/launches matching keywords (industry
//            use case, e.g. a digital product brand tracking happenings).
//
// Returns a small, structured list the dashboard renders and (later) the brief
// can fold in alongside weather + local signals.

const SEARCH_MODEL = 'claude-sonnet-4-6'; // web_search tool needs Sonnet

function buildPrompt({ mode, zip, keywords }) {
  if (mode === 'local') {
    return `Find upcoming LOCAL events near ZIP code ${zip} over roughly the next 30 days.
Look for community happenings, markets, festivals, fairs, sports, music, food, and neighborhood events a local small business could tie into.
Use web search. Return ONLY events you can ground in a real source.`;
  }
  return `Find upcoming events, conferences, launches, and notable happenings related to: ${keywords}.
Focus on the next 60 days where possible. Include industry conferences, product launches, awareness days, and online events relevant to this topic.
Use web search. Return ONLY events you can ground in a real source.`;
}

const OUTPUT_INSTRUCTION = `
After searching, return STRICT JSON only — no prose, no markdown fences:
{"events":[{"title":"...","date":"...","location":"...","summary":"...","url":"<source permalink>","relevance":"why a brand should care"}]}
Cap at 8 events. Omit any field you cannot ground; never invent a date or URL.`;

function extractText(response) {
  return (response?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function parseJsonLoose(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function normalizeEvents(parsed) {
  const rows = Array.isArray(parsed?.events) ? parsed.events : [];
  return rows
    .map((row) => ({
      title: String(row?.title || '').trim(),
      date: String(row?.date || '').trim(),
      location: String(row?.location || '').trim(),
      summary: String(row?.summary || '').trim(),
      url: String(row?.url || '').trim(),
      relevance: String(row?.relevance || '').trim(),
    }))
    .filter((row) => row.title)
    .slice(0, 8);
}

/**
 * Search for events.
 *
 * @param {object} options
 * @param {'local'|'global'} options.mode
 * @param {string} [options.zip]      - required for local mode
 * @param {string} [options.keywords] - required for global mode
 * @param {object} options.provider   - provider adapter ({ messages })
 * @returns {Promise<{ events: Array }>}
 */
async function searchEvents({ mode, zip = '', keywords = '', provider }) {
  if (!provider?.messages?.create) {
    throw new Error('searchEvents: provider with messages.create required');
  }
  if (mode === 'local' && !String(zip).trim()) throw new Error('A ZIP code is required for local events.');
  if (mode === 'global' && !String(keywords).trim()) throw new Error('Keywords are required for global events.');

  const response = await provider.messages.create({
    model: SEARCH_MODEL,
    max_tokens: 2500,
    messages: [{ role: 'user', content: `${buildPrompt({ mode, zip, keywords })}\n${OUTPUT_INSTRUCTION}` }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
  });

  const parsed = parseJsonLoose(extractText(response));
  if (!parsed) throw new Error('searchEvents: model did not return parseable JSON');
  return { events: normalizeEvents(parsed) };
}

module.exports = { searchEvents };
