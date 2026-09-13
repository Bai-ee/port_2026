// One topic vocabulary, applied to every corpus.
//
// The first two corpora were tagged by two hand-written taggers, one per
// account, and shared 1 label out of 28. Cross-account topic comparison was
// therefore impossible: every benchmark topic read as "0% of your output",
// which described the taggers and not the accounts.
//
// The fix is that a shared taxonomy must be ACCOUNT-AGNOSTIC. These labels
// describe a kind of creative post, never a particular client's projects. A
// client's own project vocabulary ("crittersquest", "edittrax", "hitloop") is
// real and useful, but it belongs in their profile `lanes`, which are tagged
// separately and never used for cross-account comparison — by construction a
// benchmark account will score 0% on them, which is the artifact this module
// exists to prevent.
//
// Pure: no fs, no network, no clock.

/** Applied to a post's own text plus the text of anything it quotes, because a
 * quote-react's subject usually lives in the quoted post, not the caption. */
export const SHARED_TOPICS = [
  ['japanese-asian-design', /japan|japanese|asian|korea|korean|chinese|타이포|tokyo|kanji|kana/i],
  ['retro-analog-preinternet', /pre.?internet|analog|vintage|retro|\b(?:70s|80s|90s|y2k)\b|flea market|windows (?:95|98|xp)|obsolete|archival|archive|old ?school|nostalg/i],
  ['editorial-typography', /editorial|typograph|typeface|font|zine|magazine|layout|swiss|poster|print(?:ed|ing)?\b|kerning|serif|lettering/i],
  ['motion-animation-web', /animation|animate|motion|scroll(?:ing|y)?|slider|easing|transition|parallax|micro-?interaction|after ?effects/i],
  ['3d-spatial', /blender|webgl|three\.?js|shader|render(?:ing|er)?\b|\b3d\b|cinema ?4d|houdini|ray ?trac|mesh\b|volumetric/i],
  ['brand-identity', /brand(?:ing|mark)?\b|identity|logo(?:type)?|visual system|style guide|rebrand|wordmark/i],
  ['ui-product-design', /\bui\b|\bux\b|product design|interface|dashboard|app design|design system|component|figma file|wireframe/i],
  ['own-work-process', /\bi (?:made|built|designed|created|shipped|drew|coded)|my (?:latest|newest|new) (?:project|work|site)|work in progress|\bwip\b|behind the scenes|process (?:shot|video|section)|unreleased/i],
  ['client-work-credit', /dev by @|design by @|illus(?:tration)? by @|built (?:for|with) @|client work|for my client|shipped for|launched for/i],
  ['freelance-business', /freelanc|invoice|\brates?\b|pricing|retainer|discovery call|contract|9 to 5|full.?time|agency life|booking/i],
  ['craft-advice', /i recommend|if you'?re starting out|plateau|here'?s (?:how|what|why)|you'?ll learn|go back and|\btips?\b|lesson|advice|how i\b/i],
  ['industry-hot-take', /hot take|unpopular opinion|most designers|is a scam|fight me|controversial|overrated|underrated|stop (?:using|doing)/i],
  ['personal-vulnerability', /fallen off|hard truth|when i first started|my journey|struggl|burn(?:t|ed) out|i miss|honestly,|imposter/i],
  ['growth-milestone', /\b\d{3,5}\s*(?:followers?|subs)|holy number|let'?s goo+|thanks (?:everyone|to all|for the support)|milestone|hit \d+k/i],
  ['platform-meta', /linkedin|\balgo(?:rithm)?\b|notifications|chronically online|\bon x\b|this (?:app|platform)|twitter\b|the feed\b/i],
  ['tools-software', /figma|framer|photoshop|illustrator|webflow|cursor\b|\bnpm\b|plugin|vscode|procreate|spline/i],
  ['ai-tooling', /\bai\b|\bllm\b|claude|chatgpt|gpt-?\d|midjourney|prompt(?:ing|s)?\b|generative|copilot|veo|sora/i],
  ['anti-ai-slop', /ai slop|\bslop\b|ai.?free|made by (?:a )?human|mediocre ai|just use ai|soulless/i],
  ['audience-question', /\?\s*$|would (?:you|u)\b|am i the only|anyone else|thoughts\?|which (?:one|version)/i],
  ['music-audio', /\bdj\b|mixtape|mix-?tape|vinyl|\bwav\b|\bbpm\b|synth|ableton|sampler|track\b|\bset\b|festival|label\b/i],
  ['web3-crypto', /\bnft\b|web3|on-?chain|mint(?:ing|ed)?\b|wallet|token|blockchain|arweave|ipfs|decentraliz|ethereum|solana/i],
];

/** What a post gets when nothing matches — a real label, not an empty array,
 * and not a defect.
 *
 * Measured on the two real corpora, the shared taxonomy leaves 48.9% of the
 * benchmark's authored posts and 46.4% of the client's untagged, against 54.7%
 * for the benchmark's own hand-written tagger. Roughly half of an active
 * account's output genuinely has no subject — "i am listening", "wait for
 * it....", thanking followers — and it is a post CLASS, not a gap in the
 * vocabulary. The name matches the label already stored in the existing
 * corpora, so previously tagged data stays comparable.
 *
 * A client's own project vocabulary recovers some of this; that is what
 * `tagLanes` is for, and it is deliberately not part of the shared taxonomy. */
export const UNTAGGED = 'untagged-riff';

export const SHARED_TOPIC_LABELS = SHARED_TOPICS.map(([name]) => name);

/**
 * Tag one post against the shared taxonomy.
 *
 * @param {string} text - the post's own text
 * @param {object} [opts]
 * @param {string} [opts.quotedText] - text of the post it quotes, if any
 * @returns {string[]} matching labels, or [UNTAGGED]
 */
export function tagTopics(text, opts = {}) {
  const hay = [String(text ?? ''), String(opts.quotedText ?? '')].join(' \n ');
  if (!hay.trim()) return [UNTAGGED];
  const hits = SHARED_TOPICS.filter(([, re]) => re.test(hay)).map(([name]) => name);
  return hits.length ? hits : [UNTAGGED];
}

/**
 * Tag a post against a client's own lane vocabulary.
 *
 * Separate from the shared taxonomy on purpose: these labels are private to one
 * account, so a benchmark account scoring 0% on them means nothing. They are
 * for the client's own reporting, never for comparison.
 *
 * @param {string} text
 * @param {string[]} lanes - plain words/phrases from the client profile
 * @returns {string[]}
 */
export function tagLanes(text, lanes = []) {
  const hay = String(text ?? '').toLowerCase();
  if (!hay.trim() || !Array.isArray(lanes)) return [];
  return lanes
    .map((lane) => String(lane ?? '').trim().toLowerCase())
    .filter((lane) => lane.length >= 3 && hay.includes(lane));
}

/** Share of a corpus that matched nothing. The measured normal range is
 * 45–55%; above ~70% the taxonomy is genuinely missing the account's subject
 * matter and its topic figures should not be trusted. */
export function untaggedShare(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const untagged = list.filter((r) => Array.isArray(r?.topics) && r.topics.length === 1 && r.topics[0] === UNTAGGED);
  return untagged.length / list.length;
}
