// The posting categories — the wells the daily calendar draws from.
//
// WHY THIS EXISTS: `build-calendar.js` can already decide *when* to post and
// *what type* of post goes in each slot. It emits `copy: null, asset: null`
// because nothing in the system knows what content exists. This module is the
// supply-side vocabulary: a fixed set of repeatable series, each one mapped to
// the slot type it can fill, the media it needs, and where it sends people.
//
// A series is a habit, not a campaign. The value is that "what do I post at
// 13:00" stops being a decision and becomes a draw from a named well.
//
// Pure data + pure helpers. No fs, no network, no clock.

/** The six pillars — the human-facing label. This is how Bryan thinks about
 * the archive, and it is deliberately NOT the same axis as the guard's lanes
 * (which police what a post is about) or the benchmark's topics (which measure
 * what earns reach). Three vocabularies, one mapping table, no drift. */
export const PILLARS = {
  'was-there': 'I was there — Housepit, Chicago, SF, flyers, parties, scene history',
  'made-this': 'I made this — records, tracks, performances, designs, systems',
  'found-this': 'I found this — rare records, forgotten mixes, producers, labels',
  'how-made': 'Here is how it was made — production, pressing, design, code, archival',
  'thirty-years': 'Here is what 30 years taught me — career, tech shifts, judgment',
  'building-now': 'Here is what I am building now — HITLOOP, EditTrax, releases',
};

/** pillar -> guard lane. Many-to-one on purpose: the guard's job is to catch a
 * post drifting into `casino`/`politics`, not to mirror this taxonomy. */
export const PILLAR_TO_LANE = {
  'was-there': 'music',
  'made-this': 'music',
  'found-this': 'music',
  'how-made': 'craft',
  'thirty-years': 'meta',
  'building-now': 'work',
};

/**
 * pillar -> topic labels from `features/x-benchmark/taxonomy.js`.
 *
 * ⚠️ THE GAP THIS EXPOSES: that vocabulary was derived from two design-Twitter
 * corpora and has exactly ONE label for everything musical (`music-audio`).
 * Records, Housepit, label history, DJ sets, event archives and 30 years of
 * Chicago house all collapse into it — so "which vein earns reach" is
 * currently uncomputable for the half of the archive that is most
 * differentiated.
 *
 * `PROPOSED_ARCHIVE_TOPICS` below is the fix. It is NOT applied here: adding
 * labels to `SHARED_TOPICS` re-tags the committed corpora and moves the
 * regression fixtures, so it is its own test-gated change.
 */
export const PILLAR_TO_TOPICS = {
  'was-there': ['music-audio', 'retro-analog-preinternet', 'personal-vulnerability'],
  'made-this': ['music-audio', 'own-work-process'],
  'found-this': ['music-audio', 'retro-analog-preinternet'],
  'how-made': ['craft-advice', 'own-work-process', 'tools-software'],
  'thirty-years': ['industry-hot-take', 'craft-advice', 'personal-vulnerability'],
  'building-now': ['own-work-process', 'ui-product-design', 'ai-tooling'],
};

/** Proposed additions to the shared topic vocabulary, so the measurement layer
 * can tell these veins apart instead of reading them all as `music-audio`.
 * Applying them is a separate change (see the warning above). */
export const PROPOSED_ARCHIVE_TOPICS = [
  'chicago-house-history',
  'record-digging',
  'label-catalog',
  'event-archive',
  'dj-performance',
  'hardware-performance',
  'career-history',
];

/**
 * The series.
 *
 * `slotTypes` are the post types from `features/x-benchmark/normalize-corpus.js`
 * — a series can only fill a slot whose type it appears in.
 *
 * `media` is what the post REQUIRES, not what it may have. Measured: a static
 * image reaches less than plain text, and video out-reaches image 3.4× within
 * the same post type, so a series whose artifacts are stills either routes
 * through a render step or posts as text with the still as support.
 *
 * `perDay` is the target draw rate at tier 2 (8 authored posts/day). Sum of
 * `perDay` across series is the daily plan; see DAILY_PLAN below.
 */
export const SERIES = {
  C1: {
    id: 'record-of-the-day',
    label: 'Record of the Day',
    pillar: 'found-this',
    slotTypes: ['original-showcase'],
    media: 'video',
    perDay: 2,
    cta: 'archive / Bandcamp',
    monetizes: 'SME position, catalog interest',
    shape: 'one record, the label, why it matters, one memory, "Artist - Title" at the end',
    // Modelled on @toshioueki: 4.75 posts/day, ~0 gap days, and the format is
    // cheap enough to sustain — phone, turntable, a memory he already has.
    // His measured top bucket is 1992–2000 CANON (avg ~145 likes), not rarity;
    // 2000s peak-hour is his weakest record bucket (~54). Recognition beats
    // obscurity: the reader thinks "I know this one", then learns something.
    evidence: 'docs/audits/x-monetization-research.md §1',
  },
  C2: {
    id: 'label-vault',
    label: 'Label Vault',
    pillar: 'made-this',
    slotTypes: ['original-showcase'],
    media: 'video',
    perWeek: 3,
    cta: 'Bandcamp / direct',
    monetizes: 'record sales',
    shape: 'Secret Studio / AudioJazz release, test pressing, sleeve, collaborator',
  },
  C3: {
    id: 'event-archive',
    label: 'Event Archive',
    pillar: 'was-there',
    slotTypes: ['original-showcase', 'original-text'],
    media: 'still',
    perDay: 1,
    cta: 'archive site',
    monetizes: 'scene credibility, bookings',
    shape: 'Housepit / Hostility / Viva Acid flyer + what actually happened that night',
    // The anniversary trigger (T1) lives here: a dated flyer generates a post
    // on its own every year with no new production.
    trigger: 'anniversary',
  },
  C4: {
    id: 'own-productions',
    label: 'Own Productions',
    pillar: 'made-this',
    slotTypes: ['original-showcase'],
    media: 'video',
    perWeek: 3,
    cta: 'Bandcamp / streaming',
    monetizes: 'sales, bookings',
    shape: 'Bai-ee track, old vs new, unreleased version, the production story',
  },
  C5: {
    id: 'hardware-process',
    label: 'Hardware / Process',
    pillar: 'how-made',
    slotTypes: ['original-showcase'],
    media: 'video',
    perWeek: 3,
    cta: 'EditTrax / HITLOOP',
    monetizes: 'crossover audience, product credibility',
    shape: 'PA jam, SP-16 scene, loop built on camera, the mistake and the fix',
  },
  C6: {
    id: 'design-dev-artifacts',
    label: 'Design/Dev Artifacts',
    pillar: 'building-now',
    slotTypes: ['original-showcase'],
    media: 'video',
    perDay: 2,
    cta: 'HITLOOP',
    monetizes: 'design and dev leads',
    shape: 'Studio tool doing something satisfying, under 15s, no intro card',
  },
  C7: {
    id: 'takes-with-receipts',
    label: 'Takes with Receipts',
    pillar: 'thirty-years',
    slotTypes: ['original-text'],
    media: 'none',
    perDay: 1,
    cta: null,
    monetizes: 'SME position',
    shape: 'a specific claim about scene or craft, backed by something you personally saw',
    // This is @moorhaus_'s entire engine: his top post is a rant (1,622 likes)
    // and his scene-norm opinions beat his gig announcements ~20×. The edge
    // available here is that he has opinions and Bryan has opinions PLUS
    // receipts.
    evidence: 'docs/audits/x-monetization-research.md §2',
  },
  C8: {
    id: 'quote-react',
    label: 'Quote-react',
    pillar: null,
    slotTypes: ['quote-react'],
    media: 'none',
    perDay: 3,
    cta: null,
    monetizes: 'reach',
    shape: 'six-word reaction to someone else\'s object; optionally paired with an archive artifact (T2)',
    // Already automated: the 06:30 scan fills these. Listed so the daily plan
    // adds up and so T2 pairing has a home.
    automated: true,
  },
  C9: {
    id: 'self-quote',
    label: 'Self-quote Resurrection',
    pillar: null,
    slotTypes: ['self-quote'],
    media: 'inherited',
    perDay: 1,
    cta: null,
    monetizes: 'free reach',
    shape: 're-surface your own winner with a new line on top',
    // The benchmark's highest-performing type (60.8 avg likes). @bai_ee used it
    // once in 65 days. Needs the post ledger to pick a winner, so it is the
    // first series that depends on P2.
    requiresLedger: true,
  },
};

/** Not a post series — a separate daily quota, because replies are the only
 * mechanism that reaches people who do not already follow you, and they are
 * invisible to the calendar (X hides most of them on a profile timeline). */
export const REPLY_QUOTA_PER_DAY = 10;

/** What a full day looks like at tier 2. Sums to 11 authored posts. */
export const DAILY_PLAN = ['C1', 'C1', 'C3', 'C6', 'C6', 'C7', 'C8', 'C8', 'C8', 'C9'];

/** Series that can fill a given slot type, in draw order. */
export function seriesForSlotType(type) {
  return Object.values(SERIES).filter((s) => s.slotTypes.includes(type));
}

/** The label set a package inherits from its pillar. Returns `null` topics for
 * an unknown pillar rather than guessing — an unmapped package should show up
 * as a gap, not as silently mis-tagged data. */
export function resolveLabels(pillar) {
  if (!PILLARS[pillar]) return { pillar: null, lane: null, topics: [] };
  return {
    pillar,
    lane: PILLAR_TO_LANE[pillar] ?? null,
    topics: PILLAR_TO_TOPICS[pillar] ?? [],
  };
}
