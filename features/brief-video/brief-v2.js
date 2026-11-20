// brief-v2.js — Creative Brief v2 (structured) and its Storyboard gate, for Critters Quest calendar videos.
//
// A v2 brief lives in videoBriefMeta.v2 (briefVersion 2) next to the v1 fields; `creative` is a deterministic plain-text
// rendering of it, so everything that reads `creative` keeps working. A v2 brief NEVER goes through the old clip author and
// never starts a render here: approving it only marks the brief approved and asks for a storyboard (the owner's gate).
// Storyboard: videoBriefMeta.storyboard {status pending|ready|approved|changes, outline?, frames[], notes?, updatedAt, updatedBy}.
// Spec: hitloop-video-director clients/critters-quest/docs/calendar/CREATIVE_BRIEF_V2.md. Pure: no Firestore, no network.

import { createRequire } from 'node:module';

const requireJson = createRequire(import.meta.url);
const LIBRARY = requireJson('./howto-catalog/cq-library.json');

export const V2_FORMATS = ['feature', 'guide', 'promo'];
// promo = a short animated poster built from an approved live treatment (see the template doc for what each means).
export const V2_TREATMENTS = ['faceOff', 'mapConverge', 'hostPoster', 'heroRise', 'statCard'];
export const PROMO_BEATS_MAX = 3;
export const PROMO_SECONDS_MIN = 15;
export const PROMO_SECONDS_MAX = 23;
export const V2_CAST_MAX = 6;
export const V2_BUBBLES_MAX = 3;
export const V2_VOICE_MODES = ['narrated', 'caption-only', 'music'];
export const V2_TEXT_MAX = 400;
export const V2_CELL_MAX = 160;
export const V2_SHORT_MAX = 120;
export const V2_POST_COPY_MAX = 280;
export const V2_BEATS_MAX = 6;
export const V2_BEATS_READY_MIN = 3;
export const V2_BEAT_SECONDS_MAX = 15;
export const V2_TOTAL_SECONDS_MAX = 30;
export const V2_NARRATION_MAX = 8;
export const V2_NARRATION_LINE_MAX = 200;
export const V2_NEEDS_MAX = 10;
export const STORYBOARD_STATUSES = ['pending', 'ready', 'approved', 'changes'];
export const STORYBOARD_OUTLINE_MAX = 6000;
export const STORYBOARD_FRAMES_MAX = 8;
export const STORYBOARD_NOTE_MAX = 400;
export const STORYBOARD_NOTES_MAX = 2000;
export const BEAT_KEYS = ['purpose', 'screen', 'camera', 'cursor', 'response', 'caption', 'transition'];

const bad = (message, extra = {}) => Object.assign(new Error(message), { status: 400, code: 'invalid-video-brief', ...extra });
const str = (v) => (v == null ? '' : String(v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function text(label, v, max) {
  const s = str(v).replace(/\r\n?/g, '\n').trim();
  if (s.length > max) throw bad(`${label} must be ${max} characters or fewer.`);
  return s;
}

function textList(label, v, maxItems, maxLen) {
  if (v == null || v === '') return [];
  if (!Array.isArray(v)) throw bad(`${label} must be a list.`);
  const out = v.map((x) => str(x).replace(/\r\n?/g, '\n').trim()).filter(Boolean);
  if (out.length > maxItems) throw bad(`${label} can have at most ${maxItems} entries.`);
  out.forEach((x, i) => { if (x.length > maxLen) throw bad(`${label}[${i + 1}] must be ${maxLen} characters or fewer.`); });
  return out;
}

function beatSeconds(i, v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1 || n > V2_BEAT_SECONDS_MAX) throw bad(`beats[${i + 1}].seconds must be a number from 1 to ${V2_BEAT_SECONDS_MAX}.`);
  return Math.round(n * 10) / 10;
}

export const v2TotalSeconds = (v2) => Math.round((v2?.beats || []).reduce((a, b) => a + (Number(b.seconds) || 0), 0) * 10) / 10;

/**
 * Validate and normalise a v2 brief. Structure, enums, caps and the 30 s total are enforced always; EMPTY required fields are
 * allowed here (a draft may be incomplete) and listed by v2Missing, which gates 'ready' / 'approved'.
 */
export function normalizeV2(input) {
  if (!isObj(input)) throw bad('v2 must be an object.');
  const format = str(input.format).trim();
  if (format && !V2_FORMATS.includes(format)) throw bad(`format must be one of ${V2_FORMATS.join(', ')}.`);
  const voiceMode = str(input.voiceMode).trim();
  if (voiceMode && !V2_VOICE_MODES.includes(voiceMode)) throw bad(`voiceMode must be one of ${V2_VOICE_MODES.join(', ')}.`);
  const poster = isObj(input.poster) ? input.poster : {};
  if (input.poster != null && !isObj(input.poster)) throw bad('poster must be an object.');
  if (input.beats != null && !Array.isArray(input.beats)) throw bad('beats must be a list.');
  const rawBeats = Array.isArray(input.beats) ? input.beats : [];
  const promo = format === 'promo';
  const beatsMax = promo ? PROMO_BEATS_MAX : V2_BEATS_MAX;
  if (rawBeats.length < 1 || rawBeats.length > beatsMax) throw bad(`beats must have 1 to ${beatsMax} entries${promo ? ' for a promo' : ''}.`);
  const treatment = str(input.treatment).trim();
  if (treatment && !V2_TREATMENTS.includes(treatment)) throw bad(`treatment must be one of ${V2_TREATMENTS.join(', ')}.`);
  const beats = rawBeats.map((b, i) => {
    if (!isObj(b)) throw bad(`beats[${i + 1}] must be an object.`);
    const out = {};
    for (const k of BEAT_KEYS) out[k] = text(`beats[${i + 1}].${k}`, b[k], V2_CELL_MAX);
    out.seconds = beatSeconds(i, b.seconds);
    return out;
  });
  const total = beats.reduce((a, b) => a + b.seconds, 0);
  const totalMax = promo ? PROMO_SECONDS_MAX : V2_TOTAL_SECONDS_MAX;
  if (total > totalMax + 1e-9) throw bad(`The beats add up to ${Math.round(total * 10) / 10} s; ${promo ? 'a promo' : 'the video'} is ${totalMax} s at most.`);
  const lesson = text('lesson', input.lesson, V2_SHORT_MAX);
  const host = text('host', input.host, V2_SHORT_MAX);
  const focus = text('focus', input.focus, V2_TEXT_MAX);
  const dateLine = text('poster.dateLine', poster.dateLine, V2_SHORT_MAX);
  const bubble = text('poster.bubble', poster.bubble, V2_SHORT_MAX);
  const cast = textList('cast', input.cast, V2_CAST_MAX, V2_SHORT_MAX);
  const bubbles = textList('bubbles', input.bubbles, V2_BUBBLES_MAX, V2_SHORT_MAX);
  const postCopy = text('postCopy', input.postCopy, V2_POST_COPY_MAX);
  return {
    format,
    ...(treatment ? { treatment } : {}),
    ...(cast.length ? { cast } : {}), ...(bubbles.length ? { bubbles } : {}),
    ...(lesson ? { lesson } : {}), ...(host ? { host } : {}), ...(focus ? { focus } : {}),
    angle: text('angle', input.angle, V2_TEXT_MAX),
    poster: { idea: text('poster.idea', poster.idea, V2_TEXT_MAX), banner: text('poster.banner', poster.banner, V2_SHORT_MAX), ...(dateLine ? { dateLine } : {}), ...(bubble ? { bubble } : {}) },
    hero: text('hero', input.hero, V2_TEXT_MAX),
    theme: text('theme', input.theme, V2_TEXT_MAX),
    beats,
    payoff: text('payoff', input.payoff, V2_TEXT_MAX),
    end: text('end', input.end, V2_TEXT_MAX),
    mustNot: text('mustNot', input.mustNot, V2_TEXT_MAX),
    voiceMode,
    narrationLines: textList('narrationLines', input.narrationLines, V2_NARRATION_MAX, V2_NARRATION_LINE_MAX),
    needs: textList('needs', input.needs, V2_NEEDS_MAX, V2_CELL_MAX),
    ...(postCopy ? { postCopy } : {}),
  };
}

// ── READY gate rules (drafts may stay incomplete; only 'ready' / 'approved' run these) ───────────────────────────────────
// Each rule appends a teaching message to the v2Missing list, so the API returns exactly what to fix to the brief writer.
export const FEATURE_SECONDS_MIN = 20;
export const CURSOR_ACTIONS_MIN = 2;
export const PROMO_MAP_TARGET = 'World Bank'; // the only landmark mapConverge supports today (the library has no field for it)
// Characters a promo cast may name: library hosts + the seven Titans + Gravitax + Mayor/Banker/Mandryll. Anything else (a building, "Vault") is not a character.
export const TITAN_NAMES = ['Floranix', 'Terravus', 'Axiom', 'Aquaris', 'Chronos', 'Solus', 'Necrothis'];
export const CHARACTERS = [...new Set([...(LIBRARY.hosts || []).map((h) => h.id), ...TITAN_NAMES, 'Gravitax', 'Mayor', 'Banker', 'Mandryll'].map((x) => String(x).toLowerCase()))];
const CHARACTERS_LABEL = ['Mayor', 'Banker', 'Mandryll', 'Gravitax', ...TITAN_NAMES].join(', ');
const castKey = (x) => str(x).replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
export const isCharacter = (x) => CHARACTERS.includes(castKey(x));
export const PROMO_TREATMENT_IDS = (LIBRARY.promoTreatments || []).map((t) => t.id);
// Scenes the library lists for feature/guide episodes (kit is not "promo"); a promo must not name one.
const EPISODE_SCENES = (LIBRARY.scenes || []).filter((sc) => sc.kit !== 'promo');
const NEEDS_BUILD_SCENES = (LIBRARY.scenes || []).filter((sc) => sc.status === 'needs-build');
// A cursor that names a real action; "none" / "no cursor" / "n/a" do not count.
export const isRealCursor = (c) => { const t = str(c).trim().toLowerCase(); return Boolean(t) && !/^(none|no cursor|n\/a|-|no)$/.test(t) && !/^no (cursor|click)/.test(t); };
// A response that is only a hold or a glide: has hold/glide words and none of these action verbs (kept simple on purpose).
const HOLD_WORDS = /\b(hold|holds|glide|glides|pan|pans|linger)\b/i;
const ACTION_VERBS = /\b(open|opens|click|clicks|tap|taps|pick|picks|select|selects|press|presses|set|sets|rise|rises|wake|wakes|swing|swings|drop|drops|march|marches|claim|claims|upgrade|upgrades|start|starts|complete|completes|fill|fills|send|sends|appear|appears)\b/i;
export const isHoldOnly = (response) => HOLD_WORDS.test(str(response)) && !ACTION_VERBS.test(str(response));
// Post copy that reads as a how-to / explainer must be a guide or feature, never a promo.
const HOWTO_RE = /\b(how|here's how|before and after|what changed|tour|step|guide|learn)\b/i;
const wordsOf = (t) => new Set(str(t).toLowerCase().match(/[a-z0-9']+/g) || []);

/** Soft warning (never a block): the brief's postCopy no longer matches the post's own copy. '' when fine or not comparable. */
export function postCopyDrift(v2, postContent) {
  const a = wordsOf(v2?.postCopy); const b = wordsOf(postContent);
  if (!a.size || !b.size) return '';
  let both = 0; for (const w of a) if (b.has(w)) both += 1;
  const jaccard = both / (a.size + b.size - both);
  return jaccard < 0.5 ? "postCopy differs from the post; the post's topic is fixed - don't change it. Write the post's own topic into the brief and put anything the video can't show in needs." : '';
}

// The rules above in one block of text: served in the context tool's `use` and the MCP save description (keep in step with v2Missing).
export const READY_RULES = 'READY rules (status ready is refused with the exact list to fix): '
  + '(1) EVERY beat of every format needs camera, transition, and a cursor or response; poster.idea is required. '
  + '(2) feature/guide: at least 3 beats, 20-30 s in total, at least 2 beats whose cursor is a real action (not "none"), and no beat that is only a hold/glide (give it an action: open, click, pick, send, claim, rise, swing). '
  + '(3) promo: treatment from the library promoTreatments; heroRise/hostPoster/faceOff cast must be characters (Mayor, Banker, Mandryll, Gravitax, the seven Titans; never a building such as Vault), faceOff exactly 2, mapConverge target is World Bank; a promo beat never uses a feature/guide scene id. '
  + '(4) A beat screen that names a needs-build scene is refused: keep the topic and put it in needs, or choose a ready scene. '
  + '(5) The format must fit the post: a how-to / what-changed / tour / step / guide post is guide or feature, never promo. The post\'s topic and copy are fixed: never rewrite the post; postCopy must match it. '
  + 'Promo is for announcements/hype only; how-to and "what changed" posts are guide or feature episodes. '
  + 'The town upgrade panel (town.upgrade-panel), the incoming-raid warning (raids.incoming-warning) and the Town Defense screen (raids.defense-tab) are REAL, owner-approved game UI rebuilt from the game code, not fake UI.';

function beatRules(v2, beats, m) {
  const promo = v2.format === 'promo';
  beats.forEach((b, i) => {
    const n = i + 1;
    if (!str(b.camera).trim()) m.push(`beats[${n}].camera is empty: say how the camera moves (e.g. "slow push onto the castle", "pull back to the map")`);
    if (!str(b.transition).trim()) m.push(`beats[${n}].transition is empty: say how it moves into the next beat (e.g. "continuous push", "cut on the click"; "end" for the last beat)`);
    if (!str(b.cursor).trim() && !str(b.response).trim()) m.push(`beats[${n}] needs a cursor or a response: write what the player clicks and/or what the game does`);
    if (!promo && !isRealCursor(b.cursor) && isHoldOnly(b.response)) m.push(`beats[${n}] is only a hold or glide ("${str(b.response).slice(0, 60)}"): every beat must show something HAPPENING (a click, a window opening, a bar moving, a unit walking). Give it a cursor action or a response with an action (open, click, pick, send, claim, rise, swing, appears...)`);
  });
  // Scenes the library says are not built: keep the topic, put the gap in needs.
  const seen = new Set();
  beats.forEach((b, i) => {
    const screen = str(b.screen).toLowerCase();
    for (const sc of NEEDS_BUILD_SCENES) {
      const words = [...String(sc.id).toLowerCase().split(/[.\-]/), ...(sc.title ? [] : [])].filter(Boolean);
      const byId = screen.includes(String(sc.id).toLowerCase());
      const byTitle = sc.title && screen.includes(String(sc.title).toLowerCase());
      const byWords = words.length > 1 && words.every((w) => new RegExp(`\\b${w}`, 'i').test(screen));
      if ((byId || byTitle || byWords) && !seen.has(`${i}:${sc.id}`)) { seen.add(`${i}:${sc.id}`); m.push(`beats[${i + 1}].screen names "${sc.id}": this scene isn't built yet: keep the topic and put it in needs, or choose a ready scene`); }
    }
  });
}

/** Required-field names still empty / rules still broken (empty list = ready to be marked ready). `opts.postContent` = the post's own copy. */
export function v2Missing(v2, opts = {}) {
  const m = [];
  if (!v2 || !isObj(v2)) return ['v2'];
  const beats = Array.isArray(v2.beats) ? v2.beats : [];
  if (!v2.format) m.push('format');
  const postContent = str(opts.postContent);
  if (v2.format === 'promo' && HOWTO_RE.test(postContent)) {
    m.push(`format "promo" does not fit this post: its copy reads as a how-to / "what changed" post ("${postContent.replace(/\s+/g, ' ').trim().slice(0, 80)}"). Promo is for announcements/hype only; how-to and "what changed" posts are guide or feature episodes. Change format to "guide" (a host walks one lesson) or "feature" (a story around the feature), keep the post's topic`);
  }
  if (v2.format === 'promo') {
    if (!v2.treatment) m.push('treatment');
    else if (!PROMO_TREATMENT_IDS.includes(v2.treatment)) m.push(`treatment "${v2.treatment}" is not a library promo treatment (${PROMO_TREATMENT_IDS.join(', ')})`);
    if (!(v2.cast || []).length) m.push('cast');
    else {
      const cast = v2.cast;
      const chars = ['heroRise', 'hostPoster', 'faceOff'];
      if (chars.includes(v2.treatment)) {
        const notChars = cast.filter((c) => !isCharacter(c));
        if (notChars.length) m.push(`cast for ${v2.treatment} must be game characters (${CHARACTERS_LABEL}); "${notChars.join('", "')}" is not a character (a building or place can't be the cast). Pick a character, or choose another treatment`);
      }
      if (v2.treatment === 'faceOff' && cast.length !== 2) m.push(`faceOff needs exactly 2 characters in cast (${cast.length} given)`);
      if (v2.treatment === 'mapConverge') {
        const ok = cast.some((c) => castKey(c) === PROMO_MAP_TARGET.toLowerCase());
        if (!ok) m.push(`mapConverge target must be "${PROMO_MAP_TARGET}" (the only landmark supported today): put "${PROMO_MAP_TARGET}" in cast, or choose another treatment`);
        const other = cast.filter((c) => castKey(c) !== PROMO_MAP_TARGET.toLowerCase() && !isCharacter(c));
        if (other.length) m.push(`cast for mapConverge may only hold "${PROMO_MAP_TARGET}" and game characters; "${other.join('", "')}" is neither`);
      }
    }
    if (!str(v2.poster?.banner).trim()) m.push('poster.banner');
    if (!str(v2.poster?.idea).trim()) m.push('poster.idea (the designed first frame: who is on it, the world/theme)');
    if (!(v2.bubbles || []).length && !str(v2.hero).trim()) m.push('bubbles or hero');
    if (!str(v2.theme).trim()) m.push('theme');
    if (beats.length < 1) m.push('beats (at least 1)');
    beats.forEach((b, i) => {
      const n = i + 1;
      if (!str(b.screen).trim()) m.push(`beats[${n}].screen`);
      if (!str(b.caption).trim()) m.push(`beats[${n}].caption (write "none" if no caption)`);
      const hit = EPISODE_SCENES.find((sc) => str(b.screen).toLowerCase().includes(String(sc.id).toLowerCase()));
      if (hit) m.push(`beats[${n}].screen uses the feature/guide scene "${hit.id}": a promo is an animated poster from its treatment, not a gameplay episode. Describe the poster art instead, or make this a feature/guide episode`);
    });
    beatRules(v2, beats, m);
    const total = v2TotalSeconds(v2);
    if (beats.length && total < PROMO_SECONDS_MIN) m.push(`beats seconds (a promo is ${PROMO_SECONDS_MIN}-${PROMO_SECONDS_MAX} s, ${total} s given)`);
    if (!str(v2.end).trim()) m.push('end (write "none" if the treatment has no end card)');
    if (!v2.voiceMode) m.push('voiceMode');
    if (v2.voiceMode === 'narrated' && !(v2.narrationLines || []).length) m.push('narrationLines (voiceMode is narrated)');
    return m;
  }
  if (v2.format === 'guide' && !v2.lesson) m.push('lesson');
  if (!str(v2.angle).trim()) m.push('angle');
  if (!str(v2.poster?.banner).trim()) m.push('poster.banner');
  if (!str(v2.poster?.idea).trim()) m.push('poster.idea (the designed first frame: who is on it, the world/theme)');
  if (!str(v2.hero).trim()) m.push('hero');
  if (!str(v2.theme).trim()) m.push('theme');
  if (beats.length < V2_BEATS_READY_MIN) m.push(`beats (at least ${V2_BEATS_READY_MIN}, ${beats.length} given)`);
  beats.forEach((b, i) => {
    const n = i + 1;
    if (!str(b.screen).trim()) m.push(`beats[${n}].screen`);
    if (!str(b.caption).trim()) m.push(`beats[${n}].caption (write "none" if no caption)`);
  });
  beatRules(v2, beats, m);
  if (v2.format === 'feature' || v2.format === 'guide') {
    const total = v2TotalSeconds(v2);
    if (beats.length && (total < FEATURE_SECONDS_MIN || total > V2_TOTAL_SECONDS_MAX)) m.push(`beats seconds (a ${v2.format} is ${FEATURE_SECONDS_MIN}-${V2_TOTAL_SECONDS_MAX} s in total, ${total} s given)`);
    const actions = beats.filter((b) => isRealCursor(b.cursor)).length;
    if (beats.length && actions < CURSOR_ACTIONS_MIN) m.push(`a ${v2.format} needs at least ${CURSOR_ACTIONS_MIN} beats with a real cursor action ("click the castle", "pick the ready squad"); ${actions} given. "none" does not count: show the player acting in the game`);
  }
  if (!str(v2.payoff).trim()) m.push('payoff');
  if (!str(v2.end).trim()) m.push('end');
  if (!v2.voiceMode) m.push('voiceMode');
  if (v2.voiceMode === 'narrated' && !(v2.narrationLines || []).length) m.push('narrationLines (voiceMode is narrated)');
  return m;
}

/** Throws a 400 listing the missing fields when a v2 brief is not complete enough for 'ready' / 'approved'. */
export function assertV2Ready(v2, opts = {}) {
  const missing = v2Missing(v2, opts);
  if (missing.length) throw bad(`Creative Brief v2 is not complete. Missing: ${missing.join('; ')}.`, { missing, details: { missing } });
}

/** Deterministic plain-text rendering of a v2 brief (labelled sections, one line per beat). Goes to videoBriefMeta.creative. */
export function renderV2Text(v2) {
  const L = [];
  const add = (label, v) => L.push(`${label}: ${str(v).trim() || 'none'}`);
  L.push('CREATIVE BRIEF v2');
  add('FORMAT', v2.format);
  if (v2.format === 'promo') { add('TREATMENT', v2.treatment); add('CAST', (v2.cast || []).join(', ')); if ((v2.bubbles || []).length) add('BUBBLES', v2.bubbles.join(' | ')); }
  if (v2.format === 'guide') { add('LESSON', v2.lesson); add('HOST', v2.host || 'mayor'); add('FOCUS', v2.focus); }
  add('ANGLE / FRESHNESS', v2.angle);
  add('POSTER', v2.poster?.idea);
  add('POSTER BANNER', v2.poster?.banner);
  if (v2.poster?.dateLine) add('POSTER DATE LINE', v2.poster.dateLine);
  if (v2.poster?.bubble) add('POSTER BUBBLE', v2.poster.bubble);
  add('HERO MOMENT', v2.hero);
  add('THEME', v2.theme);
  L.push(`BEATS (${v2TotalSeconds(v2)} s):`);
  (v2.beats || []).forEach((b, i) => {
    L.push(`${i + 1}. ${b.purpose || 'beat'} | screen: ${b.screen || 'none'} | camera: ${b.camera || 'none'} | cursor: ${b.cursor || 'none'} | game: ${b.response || 'none'} | caption: ${b.caption || 'none'} | transition: ${b.transition || 'none'} | ${b.seconds} s`);
  });
  add('PAYOFF', v2.payoff);
  add('END', v2.end);
  add('MUST NOT', v2.mustNot);
  add('VOICE MODE', v2.voiceMode);
  if ((v2.narrationLines || []).length) { L.push('NARRATION:'); v2.narrationLines.forEach((x, i) => L.push(`${i + 1}. ${x}`)); }
  if ((v2.needs || []).length) { L.push('NEEDS:'); v2.needs.forEach((x) => L.push(`- ${x}`)); }
  if (v2.postCopy) add('POST COPY', v2.postCopy);
  return L.join('\n');
}

export const sameV2 = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The brief is a v2 brief (structured data present and flagged). */
export const isV2Meta = (meta) => Boolean(meta && typeof meta === 'object' && Number(meta.briefVersion) === 2 && isObj(meta.v2));
export const isV2Brief = (post) => isV2Meta(post?.videoBriefMeta);

// ── Storyboard ────────────────────────────────────────────────────────────────────────────────────────────────────────

const httpsUrl = (label, v) => {
  const s = str(v).trim();
  let u = null;
  try { u = new URL(s); } catch { /* handled below */ }
  if (!u || u.protocol !== 'https:' || s.length > 2000) throw bad(`${label} must be an https URL.`);
  return s;
};

export const newStoryboard = ({ now, by = null } = {}) => ({ status: 'pending', frames: [], updatedAt: now || new Date().toISOString(), updatedBy: by ? String(by).slice(0, 200) : null });

function storyboardError(message, status = 409, code = 'storyboard-state') { return Object.assign(new Error(message), { status, code }); }

/** Director / owner writes the outline + frames. Status becomes 'ready' (waiting for the owner's review). v2 briefs that are approved only. */
export function applyStoryboardSet(meta, input = {}, { by = null, now = new Date().toISOString() } = {}) {
  if (!isV2Meta(meta)) throw storyboardError('A storyboard can only be set on a v2 Creative Brief.', 409, 'not-v2');
  if (meta.status !== 'approved') throw storyboardError('Approve the Creative Brief first; the storyboard follows the approval.', 409, 'brief-not-approved');
  const outline = text('outline', input.outline, STORYBOARD_OUTLINE_MAX);
  const notes = text('notes', input.notes, STORYBOARD_NOTES_MAX);
  if (input.frames != null && !Array.isArray(input.frames)) throw bad('frames must be a list.');
  const rawFrames = Array.isArray(input.frames) ? input.frames : [];
  if (rawFrames.length > STORYBOARD_FRAMES_MAX) throw bad(`A storyboard has at most ${STORYBOARD_FRAMES_MAX} frames.`);
  const frames = rawFrames.map((f, i) => {
    if (!isObj(f)) throw bad(`frames[${i + 1}] must be an object.`);
    const label = text(`frames[${i + 1}].label`, f.label, V2_SHORT_MAX);
    if (!label) throw bad(`frames[${i + 1}].label is required.`);
    const note = text(`frames[${i + 1}].note`, f.note, STORYBOARD_NOTE_MAX);
    return { label, url: httpsUrl(`frames[${i + 1}].url`, f.url), ...(note ? { note } : {}) };
  });
  if (!outline && !frames.length) throw bad('A storyboard needs an outline or at least one frame.');
  return { ...meta, storyboard: { status: 'ready', ...(outline ? { outline } : {}), frames, ...(notes ? { notes } : {}), updatedAt: now, updatedBy: by ? String(by).slice(0, 200) : null } };
}

/** Owner decision on a ready storyboard: approve, or request changes (notes and/or per-frame notes by 0-based index). */
export function applyStoryboardReview(meta, input = {}, { by = null, now = new Date().toISOString() } = {}) {
  const sb = meta?.storyboard;
  if (!isV2Meta(meta) || !sb) throw storyboardError('There is no storyboard to review.', 409, 'no-storyboard');
  if (sb.status !== 'ready') throw storyboardError(`The storyboard is ${sb.status}; it can be reviewed once it is ready.`, 409, 'storyboard-not-ready');
  const decision = str(input.decision).trim();
  if (!['approve', 'changes'].includes(decision)) throw bad('decision must be approve or changes.');
  const notes = text('notes', input.notes, STORYBOARD_NOTES_MAX);
  const fn = isObj(input.frameNotes) ? input.frameNotes : {};
  const frames = (sb.frames || []).map((f) => ({ ...f }));
  for (const [k, v] of Object.entries(fn)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= frames.length) throw bad(`frameNotes has no frame ${k}.`);
    const n = text(`frameNotes[${k}]`, v, STORYBOARD_NOTE_MAX);
    if (n) frames[i].note = n; else delete frames[i].note;
  }
  if (decision === 'changes' && !notes && !Object.values(fn).some((v) => str(v).trim())) throw bad('Say what should change (notes or a frame note).');
  return { ...meta, storyboard: { ...sb, status: decision === 'approve' ? 'approved' : 'changes', frames, ...(notes ? { notes } : {}), updatedAt: now, updatedBy: by ? String(by).slice(0, 200) : null } };
}
