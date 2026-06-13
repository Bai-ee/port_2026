'use strict';

// conversation-parser.js — Distill a pasted team conversation into tagged,
// brief-relevant items via a single LLM call.
//
// Input is a raw text dump (Discord/WhatsApp "export chat", Slack copy-paste).
// Output is a small set of items the daily brief can act on, each classified by
// how the Marketing Director would route it. Items judged irrelevant to the
// campaign/positioning are dropped by the model (type: 'ignore' is filtered).
//
// Phase 1: routing is brief-only — every kept item feeds the Executive Daily
// Brief as extra Scout-side context. The `type` field is retained so later
// phases can fan items into separate campaign/social buckets without a reparse.

const PARSE_MODEL = 'claude-sonnet-4-6';
const MAX_RAW_CHARS = 24000; // ~6k tokens of conversation; trim oversized dumps

const ITEM_TYPES = ['campaign', 'social', 'brief'];

function clampRaw(text) {
  const str = String(text || '').trim();
  return str.length > MAX_RAW_CHARS ? str.slice(0, MAX_RAW_CHARS) : str;
}

function buildSystemPrompt(relevanceContext) {
  return `You are the Marketing Director's intake analyst. You read a raw dump of a team conversation (exported chat / pasted messages) and extract only what is genuinely relevant to the brand's marketing, positioning, and campaign strategy.

RELEVANCE CONTEXT — what matters for this brand:
${relevanceContext || 'General brand marketing, competitor moves, content ideas, and campaign decisions.'}

Classify each kept item by how it should be routed:
- "campaign": a strategy decision, direction, or campaign idea worth carrying into planning.
- "social": a concrete post idea, hook, angle, or reaction worth turning into content.
- "brief": a market signal, competitor mention, customer insight, or fact the daily brief should surface.

RULES:
- Keep only items that a marketing lead would actually act on. Ignore logistics, banter, scheduling, and off-topic chatter.
- Do NOT invent. Every item must be grounded in the conversation text.
- "sourceQuote" must be a short verbatim snippet (<160 chars) from the dump.
- "relevance" is one short sentence on why it matters to this brand.
- If nothing is relevant, return an empty items array.

Return STRICT JSON only, no prose, no markdown fences:
{"items":[{"type":"campaign|social|brief","summary":"...","relevance":"...","sourceQuote":"..."}]}`;
}

function extractText(response) {
  return (response?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function parseJsonLoose(text) {
  if (!text) return null;
  // Strip accidental code fences, then grab the outermost JSON object.
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeItems(parsed) {
  const rows = Array.isArray(parsed?.items) ? parsed.items : [];
  return rows
    .map((row) => ({
      type: ITEM_TYPES.includes(String(row?.type || '').toLowerCase())
        ? String(row.type).toLowerCase()
        : 'brief',
      summary: String(row?.summary || '').trim(),
      relevance: String(row?.relevance || '').trim(),
      sourceQuote: String(row?.sourceQuote || '').trim().slice(0, 200),
    }))
    .filter((row) => row.summary);
}

/**
 * Parse a raw conversation dump into tagged items.
 *
 * @param {object}  options
 * @param {string}  options.rawText           - The pasted conversation text.
 * @param {string}  [options.relevanceContext] - Compact "what matters" string.
 * @param {object}  options.provider          - Provider adapter ({ messages }).
 * @returns {Promise<{ items: Array, rawCharCount: number }>}
 */
async function parseConversation({ rawText, relevanceContext = '', provider }) {
  const raw = clampRaw(rawText);
  if (!raw) return { items: [], rawCharCount: 0 };
  if (!provider?.messages?.create) {
    throw new Error('parseConversation: provider with messages.create required');
  }

  const response = await provider.messages.create({
    model: PARSE_MODEL,
    max_tokens: 2000,
    system: buildSystemPrompt(relevanceContext),
    messages: [{ role: 'user', content: `CONVERSATION DUMP:\n${raw}` }],
  });

  const text = extractText(response);
  const parsed = parseJsonLoose(text);
  if (!parsed) {
    throw new Error('parseConversation: model did not return parseable JSON');
  }

  return { items: normalizeItems(parsed), rawCharCount: raw.length };
}

module.exports = { parseConversation, ITEM_TYPES };
