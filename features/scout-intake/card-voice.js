'use strict';

// card-voice.js — Brand tone + per-role priority rules consumed by scribe.js.
//
// ONE global brand tone applies to every card. Per-role rules describe what
// each card's description should PRIORITIZE when there's analyzer data to
// summarize. Scribe reads these and injects the right guidance per card.
//
// When a specific card needs tone or priority that can't be captured at the
// role level, upgrade that card to a dedicated .md file (pattern mirrors
// features/scout-intake/skills/). This module stays the default.

// ── Global brand tone — Bballi voice ──────────────────────────────────────────

const GLOBAL_BRAND_TONE = `
BRAND TONE (Bballi voice — applies to every card)
- Direct, not salesy — name the problem plainly, don't hedge.
- Specific over generic — cite the thing, not "some issues" or "opportunities exist."
- Results-framed — every sentence should touch rankings, trust, conversion, or revenue. If it doesn't, cut it.
- Warm but no filler — acknowledge the reader's situation without pleasantries, empty praise, or throat-clearing.
- Use second person ("your site", "your homepage") — this is about them, not us.
`.trim();

// ── Description structure — applies to short + expanded for all cards ────────

const DESCRIPTION_STRUCTURE = `
DESCRIPTION STRUCTURE (short + expanded copy for every card)
Three beats, in order:
  1. OPENING — one phrase on the state of the card for THIS site. Not a number, not a score, not a severity count. What's actually happening.
  2. PRIORITY POINTER — name the top problem + what fixes it, in plain language. Use the card's role-specific voice note below.
  3. SOLUTION HANDOFF — one phrase pointing to where the fix lives ("See the Solutions tab", "The fix is straightforward", "I can handle this"). Omit if readiness is healthy.

DO NOT:
- Repeat raw metrics (scores, LCP numbers, severity counts) — those already show on the card's ring visual and DATA tab.
- Describe what the card IS ("this card shows your SEO performance"). Describe what's happening on THIS site.
- Pad weak signals into long copy. If readiness is partial with thin findings, the short and expanded can be near the MIN length.
`.trim();

// ── Per-action-class priority rules ───────────────────────────────────────────
//
// Keys match card.actionClass values from card-contract.js:
//   runtime | describe | diagnose | recommend | service-offer
//
// NOTE: card.role holds card-specific semantic labels ('brand-voice',
// 'technical-health', etc.) and is NOT the right keying field. Voice logic
// keys on actionClass, which is the generic 5-value enum.
//
// Each string becomes the `voice` line in the per-card digest section Scribe sees.

const VOICE_BY_ACTION_CLASS = {
  diagnose: [
    'Lead with the most severe problem using the exact wording from analyzer_findings[0].label (critical severity first, then warning).',
    'Frame the top fix as plain English — not "implement JSON-LD schema" but "add structured data so search engines know what you are."',
    'Close by pointing to the Solutions tab if any critical/warning findings exist.',
  ].join(' '),

  'service-offer': [
    'Frame the current gap as an opportunity, not a failure.',
    'Name what would change if the gap closed (more trust, better conversions, cleaner first impression).',
    'The close is subtle — "I can rebuild this" or "the Solutions tab has the plan" — not a hard sell.',
  ].join(' '),

  describe: [
    'State what IS on this site, not what should be. No judgment, no urgency.',
    'If the data is strong, say so plainly. If thin, describe what IS thin without hedging.',
    'No Solutions tab pointer — this role is informational.',
  ].join(' '),

  recommend: [
    'Name the single top action in one sentence.',
    'No caveats, no hedging, no "consider." Use active voice.',
    'Point to the Solutions tab only if analyzer signals back up the recommendation.',
  ].join(' '),

  runtime: 'Minimal — this role is chrome only, typically no copy needed.',
};

function getVoiceForActionClass(actionClass) {
  return VOICE_BY_ACTION_CLASS[actionClass] || VOICE_BY_ACTION_CLASS.describe;
}

module.exports = {
  GLOBAL_BRAND_TONE,
  DESCRIPTION_STRUCTURE,
  VOICE_BY_ACTION_CLASS,
  getVoiceForActionClass,
};
