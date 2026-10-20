// Hot quote scan configuration: ONE place for every tunable (quotas, windows, thresholds, query sets, judge budget).
// Query sets are per lane and use `{since}` (YYYY-MM-DD, UTC) so a later Brain field can replace them wholesale.

/** Daily quote allowance: 2 baseline slots (07:00 / 11:00 CT) + up to 2 extra. Every refresh returns this many NEW picks. */
export const QUOTE_BASELINE_SLOTS = 2;
export const QUOTE_EXTRA_MAX = 2;
export const QUOTES_PER_DAY = QUOTE_BASELINE_SLOTS + QUOTE_EXTRA_MAX;
export const HOT_PICKS_PER_REFRESH = QUOTES_PER_DAY;

/** Default lane mix of one refresh (sums to HOT_PICKS_PER_REFRESH). An empty lane is filled from the other. */
export const LANE_MIX = Object.freeze({ design: 3, music: 1 });

export const OWNER_TIMEZONE = 'America/Chicago';
/** Baseline quote slots (CT) used when the confirmed Strategy doc names none: 07:00 and 11:00. */
export const DEFAULT_QUOTE_SLOT_TIMES = Object.freeze(['07:00', '11:00']);

/** Quote while the original is still climbing (design: measured median target age 17.8h, p90 36.7h; music: slower feeds). */
export const LANE_WINDOW_HOURS = Object.freeze({ design: 36, music: 72 });

/** Engagement (likes + reposts + replies) floors. Design: a quote must borrow a real audience. */
export const DESIGN_MIN_ENGAGEMENT = 200;
export const MUSIC_MIN_ENGAGEMENT = 40;
/** Music relative breakout: post engagement >= this many times the account's recent median. */
export const MUSIC_BREAKOUT_MULTIPLE = 5;
/** A music search hit has no account median to compare with; it must clear this absolute floor instead. */
export const MUSIC_SEARCH_MIN_ENGAGEMENT = 100;

/** Fetch budget per run (bird 429s after a handful of back-to-back calls): accounts rotate through the lane graph. */
export const HOT_ACCOUNTS_PER_RUN = Object.freeze({ design: 7, music: 8 });
export const ROTATION_POOL = 100; // rotate within the top N graph accounts of each lane
export const POSTS_PER_ACCOUNT = 20;
export const POSTS_PER_SEARCH = 20;
export const MOMENTUM_READS = 10;
export const BIRD_DELAY_MS = 6000;

/** Shown-history and momentum-snapshot retention. */
export const SHOWN_HISTORY_DAYS = 7;
export const SNAPSHOT_MAX_AGE_HOURS = 72;
export const SNAPSHOT_MAX = 200;

export const HOT_QUERIES = Object.freeze({
  design: Object.freeze([
    // the reference breakout (2026-10-19 "DESIGN IS DEAD" pitch film was result #1)
    '(designer OR design) (AI OR hiring OR portfolio OR dead OR craft) min_faves:2000 filter:videos since:{since} -filter:replies lang:en',
    '(UI OR UX OR "product design" OR "design system" OR Figma OR typography OR branding) min_faves:800 filter:videos since:{since} -filter:replies lang:en',
    '(designer OR "design engineer" OR "web design") ("vibe coding" OR Claude OR Cursor OR shipped OR "I built") min_faves:500 filter:media since:{since} -filter:replies lang:en',
  ]),
  music: Object.freeze([
    '("chicago house" OR "house music" OR "deep house" OR "ghetto house") min_faves:100 filter:media since:{since} -filter:replies lang:en',
    '("old school rave" OR "90s rave" OR "oldskool" OR "rave flyer" OR "rave flyers") min_faves:100 filter:media since:{since} -filter:replies lang:en',
    '("Frankie Knuckles" OR "Larry Heard" OR "Ron Hardy" OR "Marshall Jefferson" OR "Derrick Carter" OR "Kerri Chandler" OR "Masters at Work") min_faves:50 filter:media since:{since} -filter:replies lang:en',
  ]),
});

/** Relevance judge: small Claude model, one batched call per scan. Price lookup: claude-api skill model table (2026-10), <=100K-token prompts. */
export const JUDGE = Object.freeze({
  model: 'claude-haiku-5-5',
  inputUsdPerMTok: 0.10,
  outputUsdPerMTok: 0.50,
  maxCandidates: 24,
  maxCostUsd: 0.04,
  maxOutputTokens: 3000,
  threshold: 0.65,
});

export const ANGLES = Object.freeze(['credit', 'craft', 'i-was-there', 'builder', 'record', 'none']);
