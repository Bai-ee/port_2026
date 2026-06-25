// voice-resolver.js — Single read path for client tone/voice.
//
// One source of truth for voice across the post pipeline: the Client Brain
// (Firestore, editable, versioned). This resolver projects an approved brain's
// voice/content into the exact `brand-voice.json` shape that Scribe and
// Guardian already consume, so neither downstream consumer changes its input
// contract — only WHERE the voice is sourced.
//
// Resolution order (brain wins entirely — no per-field file merge):
//   1. Approved brain with voice content  -> project brain -> voiceProfile
//   2. Otherwise                          -> on-disk brand-voice.json (legacy/no-brain clients)
//
// The projection guarantees every field Scribe/Guardian hard-access
// (voice_pillars[], avoid[], few_shot_examples[], formatting_rules{}) is
// present, so an under-populated brain degrades gracefully instead of throwing.

const { loadBrandVoice } = require('./knowledge');

/* ---------------------------------------------------------------- helpers */

function arr(value) {
  return Array.isArray(value) ? value.filter((v) => v != null) : [];
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Short tone line for `core_tone`: first sentence of the full tone summary.
function deriveCoreTone(toneSummary) {
  const text = str(toneSummary);
  if (!text) return '';
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return firstSentence.length > 120 ? `${firstSentence.slice(0, 117).trim()}...` : firstSentence;
}

// formatting_rules contract = keyed object. Accept the new keyed brain shape
// (camelCase), an already-snake_case object, or a legacy flat array/string.
const FORMATTING_KEY_MAP = {
  short: 'short_posts',
  medium: 'medium_posts',
  long: 'long_posts',
  caps: 'caps_usage',
  emojis: 'emojis',
  threadOpener: 'thread_opener',
};

function normalizeFormattingRules(fr) {
  if (fr && !Array.isArray(fr) && typeof fr === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(fr)) {
      const val = str(v);
      if (!val) continue;
      out[FORMATTING_KEY_MAP[k] || k] = val;
    }
    return out;
  }
  // Legacy: flat array or string of generic rules -> single keyed slot.
  const list = Array.isArray(fr) ? fr.map(str).filter(Boolean) : (str(fr) ? [str(fr)] : []);
  return list.length ? { short_posts: list.join(' ') } : {};
}

// voice_pillars contract = [{name, description, do, dont}].
function normalizeVoicePillars(pillars) {
  return arr(pillars)
    .map((p) => (typeof p === 'string'
      ? { name: '', description: p, do: '', dont: '' }
      : { name: str(p.name), description: str(p.description), do: str(p.do), dont: str(p.dont) }))
    .filter((p) => p.name || p.description || p.do);
}

// content_pillars contract = [{type, description, pattern}].
function normalizeContentPillars(pillars) {
  return arr(pillars)
    .map((p) => (typeof p === 'string'
      ? { type: '', description: p, pattern: '' }
      : { type: str(p.type), description: str(p.description), pattern: str(p.pattern) }))
    .filter((p) => p.description);
}

// few_shot_examples contract = [{type, label, post}].
function normalizePostExamples(examples) {
  return arr(examples)
    .map((e) => ({ type: str(e.type) || 'example', label: str(e.label), post: str(e.post) }))
    .filter((e) => e.post);
}

function normalizeInstagramFormatting(ig) {
  if (!ig || typeof ig !== 'object') return null;
  const out = {};
  if (str(ig.captionLength) || str(ig.caption_length)) out.caption_length = str(ig.captionLength) || str(ig.caption_length);
  if (str(ig.hashtagStrategy) || str(ig.hashtag_strategy)) out.hashtag_strategy = str(ig.hashtagStrategy) || str(ig.hashtag_strategy);
  if (str(ig.ctaStyle) || str(ig.cta_style)) out.cta_style = str(ig.ctaStyle) || str(ig.cta_style);
  if (str(ig.reelsGuidance) || str(ig.reels_guidance)) out.reels_guidance = str(ig.reelsGuidance) || str(ig.reels_guidance);
  return Object.keys(out).length ? out : null;
}

function normalizeDailyBriefVoice(dbv) {
  if (!dbv || typeof dbv !== 'object') return null;
  const sectionsIn = dbv.sectionsTone || dbv.sections_tone || {};
  const keyMap = {
    weatherImpact: 'weather_impact',
    competitorWatch: 'competitor_watch',
    holidaysAndEvents: 'holidays_and_events',
    influencerTrends: 'influencer_trends',
    suggestedPosts: 'suggested_posts',
  };
  const sections_tone = {};
  for (const [k, v] of Object.entries(sectionsIn)) {
    const val = str(v);
    if (val) sections_tone[keyMap[k] || k] = val;
  }
  const role = str(dbv.role);
  if (!role && !Object.keys(sections_tone).length) return null;
  return { role, sections_tone };
}

// Synthesize a Scribe instruction when the brain has no explicit one, so the
// Scribe prompt never injects a blank override.
function deriveScribeInstructions(voice) {
  const tone = str(voice.toneSummary);
  const doLines = normalizeVoicePillars(voice.pillars)
    .map((p) => p.do)
    .filter(Boolean)
    .slice(0, 3);
  const parts = [];
  if (tone) parts.push(`Write in this voice: ${tone}`);
  if (doLines.length) parts.push(doLines.join(' '));
  return parts.join(' ');
}

/* ----------------------------------------------------------- projection */

// True when an approved brain actually carries voice content worth using.
// Guards against a blank/half-built brain regressing a client that has a
// rich on-disk brand-voice.json.
function hasVoiceContent(brain) {
  const v = brain && brain.voice;
  if (!v || typeof v !== 'object') return false;
  return Boolean(
    str(v.toneSummary) ||
    arr(v.pillars).length ||
    arr(v.writingRules).length ||
    arr(v.preferredWords).length ||
    arr(v.bannedWords).length
  );
}

// Pure: Client Brain -> brand-voice.json-shaped voiceProfile.
// No Firestore, no filesystem — unit-testable in isolation.
function projectBrainToVoiceProfile(brain, clientId) {
  const voice = (brain && brain.voice) || {};
  const content = (brain && brain.content) || {};
  const positioning = (brain && brain.positioning) || {};

  const avoid = [...arr(voice.avoidPatterns).map(str), ...arr(voice.bannedWords).map(str)].filter(Boolean);

  const profile = {
    client: clientId,
    version: brain && brain.version != null ? String(brain.version) : 'brain',
    source: `client_brain:v${brain && brain.version != null ? brain.version : '0'}`,
    one_liner: str(positioning.oneLiner) || str(voice.toneSummary),
    core_tone: deriveCoreTone(voice.toneSummary),
    tone_description: str(voice.toneSummary),
    voice_pillars: normalizeVoicePillars(voice.pillars),
    avoid,
    formatting_rules: normalizeFormattingRules(voice.formattingRules),
    content_pillars: normalizeContentPillars(content.pillars),
    few_shot_examples: normalizePostExamples(content.postExamples),
    scribe_instructions: str(voice.scribeInstructions) || deriveScribeInstructions(voice),
  };

  const instagram = normalizeInstagramFormatting(voice.instagramFormatting);
  if (instagram) profile.instagram_formatting = instagram;

  const dailyBrief = normalizeDailyBriefVoice(voice.dailyBriefVoice);
  if (dailyBrief) profile.daily_brief_voice = dailyBrief;

  return profile;
}

/* ------------------------------------------------------------- resolver */

// Default brain reader — lazy-requires the Firestore store so unit tests of the
// pure projector (and the file-fallback path) never boot firebase-admin.
async function defaultReadBrain(clientId) {
  const { readClientBrainDoc } = require('../client-brain/store.cjs');
  return readClientBrainDoc(clientId);
}

// Returns a voiceProfile in brand-voice.json shape, or null when neither a
// usable brain nor an on-disk file exists (callers treat null as "use fallback
// tone", exactly as before this resolver existed).
//
//   requireApproved: only an approved brain overrides the file (approval
//                    precedence — drafts never regress live Scribe output).
//   readBrain:       injectable for tests; defaults to the Firestore reader.
async function resolveVoiceProfile(clientId, { requireApproved = true, readBrain = defaultReadBrain } = {}) {
  const file = () => loadBrandVoice(clientId);
  if (!clientId) return file();

  let brain = null;
  try {
    brain = await readBrain(clientId);
  } catch {
    brain = null; // firebase/read failure -> degrade to file, never throw the pipeline
  }

  if (!brain) return file();
  if (requireApproved && brain.status !== 'approved') return file();
  if (!hasVoiceContent(brain)) return file();

  return projectBrainToVoiceProfile(brain, clientId);
}

module.exports = {
  resolveVoiceProfile,
  projectBrainToVoiceProfile,
  hasVoiceContent,
  // exported for tests
  normalizeFormattingRules,
  normalizeVoicePillars,
  normalizeContentPillars,
};
