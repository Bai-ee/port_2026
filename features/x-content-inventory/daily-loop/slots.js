// Strategy slots: turns a buildDayPlan result into today's slots in strategy order.
// Each slot gets a real UTC start, a pillar (P1-P6) and a priority; the daily reply
// minimum is added as its own slot so the third cap position is never silently empty.
// Pure; buildDayPlan is injected so the strategy decider stays in plan-day.js.
// Depends on config and time-ids only.

import { DEFAULT_TIMEZONE } from './config.js';
import { zonedTimeToIso } from './time-ids.js';

/** docs/plans/X-STRATEGY-SEB-MODEL.md §6: Tier 1 is the under-8-posts-a-day cadence.
 * buildDayPlan reads the tier from the `posts` it is asked for, not from history. */
export const TIER_1_MAX_POSTS = 7;

/** Lower fills first. The cap of 3 walks this order: quote-react, showcase, then text/reply. */
export const STRATEGY_PRIORITY = {
  'quote-react': 1,
  'quote-commentary': 1,
  'original-showcase': 2,
  'original-text': 3,
  reply: 4,
  'self-quote': 5,
  retweet: 6,
};

/** Types nothing in the loop writes; shown, never filled. */
const MANUAL_TYPES = new Set(['retweet']);

/**
 * Type + lane -> pillar (strategy doc §5). buildCalendar rotates lanes through the
 * day and gives every slot of a type the same brief, so lane is only a default for
 * the text and showcase pillars; a filler may overwrite it once it sees the real item.
 * Replies, self-quotes and retweets are not content pillars, so they return null.
 */
export function pillarFor({ type, lane }) {
  if (type === 'quote-react' || type === 'quote-commentary') return 'P1';
  if (type === 'original-showcase') return lane === 'music' ? 'P6' : 'P2';
  if (type === 'original-text') {
    if (lane === 'craft') return 'P4';
    if (lane === 'meta') return 'P5';
    return 'P3';
  }
  return null;
}

/** The daily reply minimum is a quota, not a calendar slot, so it has no clock time. */
function replyMinimumSlot(minPerDay) {
  return {
    letter: 'R', timeCT: null, startsAt: null, hoursFromNow: null,
    type: 'reply', lane: null, pillar: null, engine: null,
    dynamic: true, manual: false, adopted: false,
    priority: STRATEGY_PRIORITY.reply, source: 'daily-minimum', minPerDay, fillReason: null,
  };
}

/**
 * @param {object} plan  buildDayPlan() output
 * @param {{timezone?:string, replyMinPerDay?:number}} [opts]
 * @returns {object[]} slots sorted by priority, then clock time
 */
export function slotsFromPlan(plan, { timezone = DEFAULT_TIMEZONE, replyMinPerDay = 1 } = {}) {
  const calendar = (plan?.slots ?? []).map((s) => ({
    letter: s.slot,
    timeCT: s.timeCT,
    startsAt: zonedTimeToIso(plan.date, s.timeCT, timezone),
    hoursFromNow: s.hoursFromNow ?? null,
    type: s.type,
    lane: s.lane ?? null,
    pillar: pillarFor(s),
    engine: s.engine ?? null,
    dynamic: !!s.dynamic,
    manual: MANUAL_TYPES.has(s.type),
    adopted: !!s.adopted,
    priority: STRATEGY_PRIORITY[s.type] ?? 9,
    source: 'calendar',
    fillReason: null,
  }));
  const all = [...calendar, replyMinimumSlot(replyMinPerDay)];
  return all.sort((a, b) => a.priority - b.priority || String(a.startsAt ?? '~').localeCompare(String(b.startsAt ?? '~')));
}

/**
 * Ask buildDayPlan for the Tier 1 day and adapt it.
 * `input` is whatever buildDayPlan takes (corpora, packages, date, now); any `posts`
 * is clamped into Tier 1 so a caller cannot silently switch tiers.
 *
 * @returns {{slots:object[], strategySource:object, plan:object}}
 */
export function planSlots({ buildDayPlan, input, timezone = DEFAULT_TIMEZONE }) {
  // No `posts` means buildDayPlan's own default (the engine config target, 4).
  const asked = Number(input.posts);
  const posts = Number.isFinite(asked) && asked >= 1 ? Math.min(asked, TIER_1_MAX_POSTS) : undefined;
  const plan = buildDayPlan({ ...input, posts });
  const slots = slotsFromPlan(plan, { timezone });
  return {
    plan,
    slots,
    // Shown in the inputs panel so the owner can see what decided today's slots.
    strategySource: {
      date: plan.date,
      tier: 1,
      authoredPerDay: plan.slots.length,
      mixSource: plan.report ? 'gap-report' : 'own-mix',
      slotLetters: slots.map((s) => s.letter),
    },
  };
}
