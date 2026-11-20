// brief-v2.js — Creative Brief v2 (structured) and its Storyboard gate, for Critters Quest calendar videos.
//
// A v2 brief lives in videoBriefMeta.v2 (briefVersion 2) next to the v1 fields; `creative` is a deterministic plain-text
// rendering of it, so everything that reads `creative` keeps working. A v2 brief NEVER goes through the old clip author and
// never starts a render here: approving it only marks the brief approved and asks for a storyboard (the owner's gate).
// Storyboard: videoBriefMeta.storyboard {status pending|ready|approved|changes, outline?, frames[], notes?, updatedAt, updatedBy}.
// Spec: hitloop-video-director clients/critters-quest/docs/calendar/CREATIVE_BRIEF_V2.md. Pure: no Firestore, no network.

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

/** Required-field names still empty (empty list = ready to be marked ready). Promo has its own, shorter list. */
export function v2Missing(v2) {
  const m = [];
  if (!v2 || !isObj(v2)) return ['v2'];
  const beats = Array.isArray(v2.beats) ? v2.beats : [];
  if (!v2.format) m.push('format');
  if (v2.format === 'promo') {
    if (!v2.treatment) m.push('treatment');
    if (!(v2.cast || []).length) m.push('cast');
    if (!str(v2.poster?.banner).trim()) m.push('poster.banner');
    if (!(v2.bubbles || []).length && !str(v2.hero).trim()) m.push('bubbles or hero');
    if (!str(v2.theme).trim()) m.push('theme');
    if (beats.length < 1) m.push('beats (at least 1)');
    beats.forEach((b, i) => {
      const n = i + 1;
      if (!str(b.screen).trim()) m.push(`beats[${n}].screen`);
      if (!str(b.response).trim() && !str(b.cursor).trim()) m.push(`beats[${n}].response (something must happen)`);
      if (!str(b.caption).trim()) m.push(`beats[${n}].caption (write "none" if no caption)`);
    });
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
  if (!str(v2.hero).trim()) m.push('hero');
  if (!str(v2.theme).trim()) m.push('theme');
  if (beats.length < V2_BEATS_READY_MIN) m.push(`beats (at least ${V2_BEATS_READY_MIN}, ${beats.length} given)`);
  beats.forEach((b, i) => {
    const n = i + 1;
    if (!str(b.screen).trim()) m.push(`beats[${n}].screen`);
    if (!str(b.cursor).trim() && !str(b.response).trim()) m.push(`beats[${n}].cursor or response`);
    if (!str(b.caption).trim()) m.push(`beats[${n}].caption (write "none" if no caption)`);
  });
  if (!str(v2.payoff).trim()) m.push('payoff');
  if (!str(v2.end).trim()) m.push('end');
  if (!v2.voiceMode) m.push('voiceMode');
  if (v2.voiceMode === 'narrated' && !(v2.narrationLines || []).length) m.push('narrationLines (voiceMode is narrated)');
  return m;
}

/** Throws a 400 listing the missing fields when a v2 brief is not complete enough for 'ready' / 'approved'. */
export function assertV2Ready(v2) {
  const missing = v2Missing(v2);
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
