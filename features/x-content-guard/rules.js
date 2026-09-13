// Rule tables for the X content guard.
//
// The governing distinction is "the work" vs "the casino": design output for a
// web3/music client is the best-performing content on @bai_ee (web3-gaming =
// 764 avg views, the account's top vein), while speculation chatter is dead
// (crypto-speculation residue: 104/97/54 views at 0 likes).
//
// ⚠️ Why HARD_BLOCK is deliberately narrow. A first pass used a broad crypto
// regex (`price|token|\$\w+|collection|drop|mint|ct`) and produced ~50% false
// positives against the real corpus — it flagged a freelance-pricing retweet
// and, worse, the account's 1,870-view Critters Quest design post. The
// vocabulary of the work and the casino overlaps almost completely. Only
// unambiguous markers belong here; the "is the subject the artifact or the
// asset?" judgment is a model call (see guard.js `needsLaneReview`).

/** Unambiguous speculation markers. Nothing here has a legitimate design reading. */
export const CASINO_TERMS = [
  { re: /\brug(?:ged|ging|\s*pull)\b/i, code: 'casino-rug' },
  { re: /\bup\s*only\b/i, code: 'casino-uponly' },
  { re: /\b(?:moon(?:ing|ed)?|to the moon)\b/i, code: 'casino-moon' },
  { re: /\bdegen\b/i, code: 'casino-degen' },
  { re: /\bpnl\b/i, code: 'casino-pnl' },
  { re: /\bbag(?:holder|holding)\b/i, code: 'casino-bags' },
  { re: /\bape[ds]?\s+(?:in|into)\b/i, code: 'casino-ape' },
  { re: /\bpump(?:ing|ed)?\b(?!\s*(?:app|\.fun))/i, code: 'casino-pump' },
  { re: /\bpump\s*(?:app|\.fun)\b/i, code: 'casino-pumpapp' },
  { re: /\b(?:floor|entry)\s*price\b/i, code: 'casino-floor' },
  { re: /\b\d+\s*x\b\s*(?:gain|return|from here)/i, code: 'casino-multiple' },
];

/**
 * Mechanism names that read as speculation to an outsider but are simply
 * feature names to the person who built them.
 *
 * ⚠️ Learned from a real false positive: the 1,870-view post — the account's
 * second best — is a list of things shipped over two years, one line of which
 * is "$QUEST Pre-mine". Hard-blocking `pre-mine` would have stopped a portfolio
 * post. These force a review instead, and the genuinely promotional versions
 * ("the Pre-Mine is OPEN, everyone fills at the same price") are still caught
 * by the ticker + price-context rule below.
 */
export const AMBIGUOUS_CASINO = [
  { re: /\bpre-?mine\b/i, code: 'ambiguous-premine' },
  { re: /\btokenomics\b/i, code: 'ambiguous-tokenomics' },
  { re: /\bmarket\s*cap\b/i, code: 'ambiguous-mcap' },
  { re: /\bstaking\b/i, code: 'ambiguous-staking' },
  { re: /\bairdrop\b/i, code: 'ambiguous-airdrop' },
];

/**
 * A ticker alone is not speculation — `$QUEST` appears inside legitimate posts
 * about the game's economy. It only blocks when paired with price/performance
 * framing in the same post.
 */
export const TICKER_RE = /\$[A-Z]{2,6}\b/;

/**
 * ⚠️ Must require actual price framing, not merely finance-adjacent words. An
 * earlier version allowed bare `long|short|up|down` with an optional digit, so
 * "2 years is a **long** time to be in dev" matched — and combined with a
 * `$QUEST` mention it hard-blocked a portfolio post. Every branch here needs a
 * number, a percentage, or an unambiguous trading phrase.
 */
export const PRICE_CONTEXT_RE = new RegExp(
  [
    '\\b(?:ath|all[-\\s]time\\s+high|floor\\s*price|entry\\s*price|market\\s*cap)\\b',
    '\\bprices?\\s+(?:is|are|at|action|target|per|went|jumped|dropped)\\b',
    '\\b(?:up|down|gained?|lost|pumped|dumped)\\s+\\d+(?:\\.\\d+)?\\s*%',
    '\\b\\d+(?:\\.\\d+)?\\s*x\\s*(?:gain|return|from\\s+here)\\b',
    '\\bbuy\\s+(?:the\\s+)?dip\\b',
    '\\bfills?\\s+at\\b',
    '\\b(?:long|short)(?:ing|ed)?\\s+(?:\\$[A-Z]{2,6}|the\\s+(?:market|token|coin))\\b',
  ].join('|'),
  'i',
);

/** Politics. Small, specific, and safe: proper nouns plus institutional verbs. */
export const POLITICS_TERMS = [
  { re: /\b(?:trump|biden|kamala|harris|booker|ted\s*cruz|pelosi|obama|maga)\b/i, code: 'politics-figure' },
  { re: /\b(?:senator|congress(?:man|woman)?|president|election|republican|democrat)\b/i, code: 'politics-institution' },
  { re: /\bvote\s+(?:for|against|them|him|her)\b/i, code: 'politics-call' },
];

/** Pre-rank filtered or negative-signal patterns (repo profile: engagementBaitPenalty, high confidence). */
export const BAIT_TERMS = [
  { re: /\b(?:like|rt|retweet)\s+if\b/i, code: 'bait-likeif' },
  { re: /\bdrop\s+a\s+(?:like|follow)\b/i, code: 'bait-droplike' },
  { re: /\bfollow\s+(?:me\s+)?for\s+more\b/i, code: 'bait-followfor' },
  { re: /\btag\s+(?:a|someone)\b/i, code: 'bait-tag' },
];

/** Hard-sell patterns (repo profile: hardSellPenalty, medium confidence). Flag, not block. */
export const HARD_SELL_TERMS = [
  { re: /\bbuy\s+now\b/i, code: 'sell-buynow' },
  { re: /\blimited\s+time\b/i, code: 'sell-limited' },
  { re: /\bact\s+now\b/i, code: 'sell-actnow' },
  { re: /\bdm\s+me\b/i, code: 'sell-dm' },
];

/**
 * Positive lane signals. Order matters only for reporting; a post can match
 * several and the strongest count wins (see guard.js `classifyLane`).
 */
export const LANE_SIGNALS = {
  work: [
    /\b(?:marketplace|art\s*direction|identity|brand(?:ing)?\s*system|visual\s*identity)\b/i,
    /\b(?:ui|ux|interface|layout|grid|wireframe|prototype)\b/i,
    /\b(?:client|shipped|delivered|launch(?:ed)?|redesign|onboarding flow)\b/i,
    /\b(?:trait|collection\s*(?:page|grid|view)|game\s*economy)\b/i,
  ],
  craft: [
    /\b(?:three\.?js|webgl|webgpu|tsl|shader|glsl|gsap|verlet|cloth\s*sim)\b/i,
    /\b(?:blender|figma|after\s*effects|houdini)\b/i,
    /\b(?:easing|keyframe|pagination|typography|kerning|leading|render(?:er|ing)?)\b/i,
    /\b(?:css|svg|canvas|frontend|component|animation)\b/i,
    // Era tooling. Added after a real post — "flash on one monitor, this psd on
    // the other" — classified as `unknown`, which is squarely the craft lane.
    // Design-history nostalgia is one of the highest-performing veins (the model
    // account's retro/pre-internet vein averages 65.7 likes), so it must classify.
    /\b(?:psd|photoshop|illustrator|fireworks|dreamweaver|indesign|quark|freehand)\b/i,
    /\b(?:flash|actionscript|swf|macromedia|director)\b/i,
    /\b(?:comps?|mocks?|mock-?ups?|gui\s*kit|ui\s*kit|asset\s*kit|style\s*guide)\b/i,
    /\b(?:skeuomorph(?:ic|ism)?|retina|pixel[-\s]?perfect|@2x)\b/i,
  ],
  music: [
    /\b(?:sp-?16|mpc|sampler|drum\s*machine|synth|modular|eurorack)\b/i,
    /\b(?:sleeve|flyer|mix\s*tape|mixtape|record|vinyl|label|bpm|loop|slice[rd]?)\b/i,
    /\b(?:edittrax|dj\b|set\b|b2b|live\s*show)\b/i,
  ],
  infra: [
    /\b(?:arweave|ipfs|permaweb|decentrali[sz]ed\s*(?:hosting|storage)|self-?host)\b/i,
    /\b(?:permanent|permanence|forever|archive|outlive)\b/i,
  ],
  meta: [
    /\b(?:the\s*algo(?:rithm)?|\bfyp\b|impressions|engagement\s*rate|shadowban)\b/i,
    /\b(?:linkedin|squarespace|this\s*platform)\b/i,
  ],
};

/**
 * Mechanical rules, all measured on the model account (@seb__design, 603
 * authored posts) or on @bai_ee's own corpus.
 */
export const MECHANICS = {
  /** 0 of 603 of the model's authored posts used a hashtag. */
  hashtag: { re: /#\w/, code: 'mech-hashtag', severity: 'major' },
  /** Inline links cost 44% of engagement (20.5 vs 36.5 avg likes). Trailing media t.co is not a link. */
  inlineLink: { code: 'mech-inline-link', severity: 'major' },
  /** Video out-reaches image 3.4x inside the same post type (95.6 vs 28.4 avg likes). */
  imageOnShowcase: { code: 'mech-image-not-video', severity: 'minor' },
  /** A showcase post with no media is not a showcase. */
  showcaseNoMedia: { code: 'mech-showcase-no-media', severity: 'major' },
  /** Retweets are removed by OONRetweetReplyFilter before scoring — they cannot reach non-followers. */
  retweet: { code: 'mech-retweet-unreachable', severity: 'major' },
};

/** Median character targets per type, from the model account's top performers. */
export const LENGTH_TARGETS = {
  'quote-react': { min: 10, max: 90, ideal: 46 },
  'quote-commentary': { min: 60, max: 400, ideal: 148 },
  'original-showcase': { min: 8, max: 220, ideal: 90 },
  'original-text': { min: 80, max: 1200, ideal: 657 },
  'self-quote': { min: 20, max: 220, ideal: 96 },
  reply: { min: 10, max: 400, ideal: 120 },
};

/** Lanes that must never publish. */
export const BLOCKED_LANES = new Set(['casino', 'politics']);
