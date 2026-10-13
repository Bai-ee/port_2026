// strategy-doc-seed.js - the starting DRAFT of the Strategy document, shown until the owner saves once.
// Distilled from docs/plans/X-STRATEGY-SEB-MODEL.md and docs/source-of-truth/X-STRATEGY-SESSION-PROTOCOL.md §4
// ("Already decided"). It is a draft on purpose: nothing acts on it until the owner confirms it.
// Client-safe: plain data.

export const SEED_STRATEGY_SECTIONS = Object.freeze({
  thesis: [
    'Show the work, not the casino.',
    'The account grows on proof of what I build and make (client design work, tools, music), not on market talk.',
    'Reach comes first: at double-digit median views followers cannot move, so the first job is consistent reach.',
  ].join('\n'),
  audience: [
    'People who hire or collaborate with a designer/builder: founders, web3 teams, creative technologists.',
    'People who follow underground electronic music and the scene around it.',
    'They come for the thing itself (the build, the mix, the flyer), not for commentary about it.',
  ].join('\n'),
  tracks: [
    '- Design: client and personal design/build work. Benchmark: @seb__design.',
    '- Music: mixes, sets, archive material from the scene. Benchmark: none yet (gap).',
    'Each track is measured only against its own benchmarks.',
  ].join('\n'),
  formats: [
    '- Quote-react = reach engine: a striking object from someone else + a very short reaction. No explaining, no own link.',
    '- Original showcase = conversion engine: short screen-captured video of something built, no intro; credits and links in the first self-reply.',
    '- Self-quote winners: re-surface posts that already worked.',
    '- Replies daily, as a floor.',
    '- Originals can be longer and structured (claim, line break, substance). Quote captions stay short.',
  ].join('\n'),
  rules: [
    '- No hashtags.',
    '- No link in the main post; link and credits go in the first self-reply.',
    '- Video over image; a static image reaches less than plain text.',
    '- Quote-react, never retweet (a retweet earns no impression).',
    '- No speculation, price, politics or rug chatter.',
    '- No audience questions, platform meta or generic hot takes.',
  ].join('\n'),
  algorithm: [
    'Active ranking profile: x-2026-10-03 (weights public in xai-org/x-algorithm).',
    '- Earned actions outrank likes: copy-link share 20, reply 5, quote 5, DM share 5, follow 4 vs like 0.5.',
    '- Negatives are brutal: one report = -234 (468 likes), mute -58.8, not-interested -47.5. Never bait.',
    '- Mutual follows get +15 on the reply weight for originals: replying daily builds the base that boosts originals.',
    '- Out-of-network reach is weighted 0.75x; author diversity decays same-author posts within one ranked session (0.5 decay, 0.25 floor), so density is not a lever; volume is.',
    '- No hard-coded link penalty, but links are a learned negative: keep them in the self-reply.',
    '- Video needs 10s+ to count as video.',
    '- The post scorer models originals only; it undervalues quote-reacts (borrowed reach).',
  ].join('\n'),
  decisions: [
    '- "The work" vs "the casino" is about subject matter, not industry: web3 client design work is the best lane (514 avg views); speculation is dead (49).',
    '- Cadence tiers: 5/day sustainable -> 8/day competitive -> 12/day full. Start at tier 1 and hold it before moving up.',
    '- The five fixes, in order: stop retweeting, fix quote targets, reply daily, cut politics/rug content, post video.',
    '- Act only on benchmark gaps marked increase/decrease; copying the benchmark\'s raw type mix scored 0.84x.',
  ].join('\n'),
  open: [
    '- Music track has no benchmark: which account represents the music lane?',
    '- What converts (follows, inquiries) vs what only reaches? The data measures reach, not conversion.',
  ].join('\n'),
});
