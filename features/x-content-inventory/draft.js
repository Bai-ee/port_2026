// Turn a matched slot into post copy.
//
// The model's job here is NARROW and worth stating, because getting it wrong
// is what makes AI content tools produce slop: it is not inventing anything.
// The owner's `story` carries the facts and the memory; the Client Brain
// carries the voice; the measured shape for the series carries the structure.
// The model only assembles those three into 280 characters.
//
// A package with an empty `story` therefore cannot be drafted well by any
// model, and `buildDraftPrompt` refuses rather than producing a caption that
// sounds right and says nothing.
//
// Pure: no fs, no network. The Anthropic call lives in the script that uses
// this, so every shape here stays testable for free.

import { SERIES } from './categories.js';

/**
 * The measured copy shape per series. Every one of these is a finding from
 * docs/audits/x-copy-patterns.md, not a style preference.
 */
export const SHAPES = {
  C1: {
    // @toshioueki's fixed template, 95 posts. The ID line is what makes the
    // post searchable and answers the question before it is asked.
    structure: '[why this record matters — label, remixer, what it did, one personal memory]\\n\\n[Artist - Title (\'YY)]',
    maxChars: 260,
    note: 'Measured: the winners are CANON with a story, not rarities. The reader should think "I know this one" and then learn something.',
  },
  C2: { structure: '[what the release was, who made it, one detail only you would know]\\n\\n[Label - Title (\'YY)]', maxChars: 260 },
  C3: {
    // Occasion first: a flyer without a reason to post today is a picture.
    structure: '[the occasion — N years ago today / what just happened]\\n\\n[what actually happened that night: who played, what it cost, what went wrong]',
    maxChars: 260,
    note: 'Open on the occasion, not on the artifact.',
  },
  C4: { structure: '[the production story — what it was made on, what broke, what you would do differently]\\n\\n[Artist - Title (\'YY)]', maxChars: 260 },
  C5: { structure: '[what you were trying to do, what actually happened]', maxChars: 200 },
  C6: {
    // Measured: "idk" + video earned 134 likes. Strong media wants weak copy.
    structure: '[one line. do not explain the video.]',
    maxChars: 120,
    note: 'When the media is strong the copy gets out of the way. Do not describe what is visible.',
  },
  C7: {
    // @moorhaus_'s engine and the differentiated move: everyone has opinions,
    // almost nobody has receipts.
    structure: '[the claim, stated flat, in line 1]\\n\\n[the receipt — the specific thing you personally saw that proves it]',
    maxChars: 270,
    note: 'A take without a receipt is the one thing here that anybody could have written.',
  },
  C8: {
    // Four of the benchmark's top five quote captions are the same sentence
    // with a different noun. Reaction, never analysis.
    structure: '[six-word reaction. no analysis, no explanation, no link.]',
    maxChars: 60,
    note: 'The borrowed post carries the reach; the caption only has to react.',
  },
  C9: {
    structure: '[name the reason you are re-surfacing it, then the part you left out the first time]',
    maxChars: 200,
    note: 'Real examples: "people liked this more than i expected, here is the part i left out".',
  },
};

/** Mechanical rules, checked in code rather than hoped for in a prompt. */
export const HARD_LIMITS = {
  maxChars: 280,
  quoteCaptionMax: 90,
};

/**
 * Check drafted copy against the mechanical rules. Runs on model output AND on
 * anything a human writes, because the rules are about the platform, not about
 * who typed it.
 */
export function validateDraft(text, { series, slotType } = {}) {
  const t = String(text ?? '');
  const violations = [];

  if (!t.trim()) violations.push('empty');
  if (t.length > HARD_LIMITS.maxChars) violations.push(`over ${HARD_LIMITS.maxChars} chars (${t.length})`);
  if (/#\w/.test(t)) violations.push('hashtag — zero in 603 benchmark posts');

  // A trailing status URL is how X composes a quote tweet and is exempt. A
  // link anywhere else costs ~44% of engagement, measured.
  const trailingQuoteUrl = /https?:\/\/(x|twitter)\.com\/\w+\/status\/\d+\s*$/i.test(t);
  if (/https?:\/\//i.test(t) && !trailingQuoteUrl) violations.push('inline link — it belongs in the first self-reply');

  if (slotType === 'quote-react' && t.replace(/https?:\/\/\S+$/, '').trim().length > HARD_LIMITS.quoteCaptionMax) {
    violations.push(`quote caption over ${HARD_LIMITS.quoteCaptionMax} chars — that is commentary, which reaches less`);
  }

  const shape = SHAPES[series];
  if (shape && t.length > shape.maxChars) {
    violations.push(`over the ${series} shape's ${shape.maxChars} chars (${t.length}) — soft, but the shape was measured`);
  }

  if (/\b(like if|rt if|drop a like|follow for)\b/i.test(t)) violations.push('engagement bait — filtered pre-rank');

  return { ok: violations.length === 0, violations, chars: t.length };
}

/**
 * Build the drafting prompt for one matched slot.
 *
 * @returns {{ok: boolean, prompt?: string, system?: string, reason?: string}}
 *   `ok:false` when there is nothing real to write from — that is a refusal,
 *   not a failure, and the caller should surface it as a gap.
 */
export function buildDraftPrompt({ pkg, slot, voice = '', trigger = null } = {}) {
  const series = pkg?.series ?? slot?.series;
  const shape = SHAPES[series];
  if (!shape) return { ok: false, reason: `no measured copy shape for series ${series ?? '(none)'}` };

  const story = String(pkg?.story ?? '').trim();
  // ⚠️ THE REFUSAL THAT MATTERS. A model handed an empty story writes a
  // caption that sounds like a post and contains nothing — which is exactly
  // the failure mode that makes automated content read as slop. The story is
  // the post; the artifact is the attachment.
  if (story.length < 40) {
    return { ok: false, reason: 'story is empty or too thin to draft from — the model would be inventing, not assembling' };
  }

  const seriesDef = SERIES[series];

  const prompt = [
    `Write ONE X (Twitter) post.`,
    ``,
    `You are assembling, not inventing. Every fact must come from the material below. Do not add detail that is not there. Do not invent names, dates, labels or places.`,
    ``,
    `## The material (the author's own words)`,
    story,
    ``,
    pkg?.title ? `## What this is\n${pkg.title}\n` : '',
    trigger ? `## Why it is being posted today\n${trigger}\n` : '',
    `## The shape this kind of post takes`,
    shape.structure.replace(/\\n/g, '\n'),
    shape.note ? `\nWhy: ${shape.note}` : '',
    seriesDef?.shape ? `\nSeries intent: ${seriesDef.shape}` : '',
    ``,
    `## Voice`,
    voice ? voice : '(no approved brand voice available — write plainly and specifically, first person, lowercase start is fine)',
    ``,
    `## Rules, all measured`,
    `- ${shape.maxChars} characters maximum. Hard cap 280.`,
    `- No hashtags.`,
    `- No links. Anything that needs a URL goes in a separate self-reply, which you are not writing.`,
    `- No engagement bait, no questions to the audience, no "thread below".`,
    `- Do not explain the artifact or describe what is visible in the media.`,
    `- Lead with the claim or the occasion, never with throat-clearing.`,
    ``,
    `Return ONLY minified JSON: {"post":"...","selfReply":"..."}`,
    `"selfReply" is the follow-up carrying any link or credit, or "" if none is needed.`,
  ].filter(Boolean).join('\n');

  return {
    ok: true,
    system: 'You write short, specific social posts from material the author supplies. You never invent facts. Return only valid minified JSON.',
    prompt,
  };
}

/**
 * A deterministic draft, used when no model is available or as the dry-run
 * preview. It is intentionally dumb — it truncates the author's own story
 * rather than paraphrasing it, so what you see is what the author wrote.
 */
export function fallbackDraft({ pkg, slot } = {}) {
  const shape = SHAPES[pkg?.series ?? slot?.series] ?? { maxChars: 200 };
  const story = String(pkg?.story ?? '').trim();
  if (!story) return '';
  const firstSentence = story.split(/(?<=[.!?])\s/)[0] ?? story;
  return firstSentence.slice(0, Math.min(shape.maxChars, HARD_LIMITS.maxChars));
}
