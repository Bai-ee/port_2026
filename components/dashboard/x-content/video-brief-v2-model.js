// video-brief-v2-model.js — pure helpers for the Creative Brief v2 editor (VideoBriefV2Editor.jsx).
// Form state is all strings (inputs); toV2Body turns it into the object `video-brief-save` takes as `v2`.
// Caps and the readiness rule are the server's (features/brief-video/brief-v2.js): this file only mirrors them for live hints.

import { v2Missing, v2Warnings, CHAPTER_SECONDS_MAX, v2TotalSeconds, V2_TOTAL_SECONDS_MAX, V2_TREATMENTS, PROMO_BEATS_MAX, PROMO_SECONDS_MAX, PROMO_SECONDS_MIN, V2_BEATS_MAX, V2_BEAT_SECONDS_MAX, V2_TEXT_MAX, V2_CELL_MAX, V2_SHORT_MAX, V2_POST_COPY_MAX, V2_POSTER_HERO_MAX } from '../../../features/brief-video/brief-v2.js';

export { V2_TREATMENTS, PROMO_SECONDS_MIN, V2_TOTAL_SECONDS_MAX, V2_BEATS_MAX, V2_BEAT_SECONDS_MAX, V2_TEXT_MAX, V2_CELL_MAX, V2_SHORT_MAX, V2_POST_COPY_MAX, V2_POSTER_HERO_MAX };

/** Critters Quest client ids that may use the v2 brief (mirrors HOWTO_ALLOWED_CLIENTS; that module is server-only). */
export const V2_CLIENT_IDS = Object.freeze(['paradice-dbBQCHUX']);
export const canUseV2 = (row) => V2_CLIENT_IDS.includes(row?.clientId);
export const isV2Row = (row) => Number(row?.videoBriefMeta?.briefVersion) === 2 && Boolean(row?.videoBriefMeta?.v2);

export const STORYBOARD_LABEL = { pending: 'Storyboard pending', ready: 'Storyboard ready for review', approved: 'Storyboard approved', changes: 'Changes requested' };
export const BEAT_COLUMNS = [
  { key: 'purpose', label: 'Purpose' }, { key: 'screen', label: 'Screen + state' }, { key: 'camera', label: 'Camera' },
  { key: 'cursor', label: 'Cursor' }, { key: 'response', label: 'What happens' }, { key: 'caption', label: 'Caption' },
  { key: 'transition', label: 'Transition' },
];

export const emptyBeat = () => ({ purpose: '', screen: '', camera: '', cursor: '', response: '', caption: '', transition: '', seconds: '3' });
export const emptyForm = () => ({
  format: '', treatment: '', cast: '', bubbles: '', lesson: '', host: '', focus: '', angle: '',
  posterIdea: '', posterHero: '', posterBanner: '', posterDateLine: '', posterBubble: '',
  hero: '', theme: '', beats: [emptyBeat(), emptyBeat(), emptyBeat()],
  payoff: '', end: '', mustNot: '', voiceMode: '', voiceReason: '', narrationLines: '', needs: '', postCopy: '',
});

const s = (v) => (v == null ? '' : String(v));

/** Saved v2 object (or nothing) -> form state. */
export function formFromV2(v2) {
  if (!v2 || typeof v2 !== 'object') return emptyForm();
  return {
    format: s(v2.format), treatment: s(v2.treatment), cast: (v2.cast || []).join('\n'), bubbles: (v2.bubbles || []).join('\n'), lesson: s(v2.lesson), host: s(v2.host), focus: s(v2.focus), angle: s(v2.angle),
    posterIdea: s(v2.poster?.idea), posterHero: s(v2.poster?.hero), posterBanner: s(v2.poster?.banner), posterDateLine: s(v2.poster?.dateLine), posterBubble: s(v2.poster?.bubble),
    hero: s(v2.hero), theme: s(v2.theme),
    beats: (Array.isArray(v2.beats) && v2.beats.length ? v2.beats : [emptyBeat()]).map((b) => ({ ...emptyBeat(), ...Object.fromEntries(Object.entries(b || {}).map(([k, v]) => [k, s(v)])) })),
    payoff: s(v2.payoff), end: s(v2.end), mustNot: s(v2.mustNot), voiceMode: s(v2.voiceMode), voiceReason: s(v2.voiceReason),
    narrationLines: (v2.narrationLines || []).join('\n'), needs: (v2.needs || []).join('\n'), postCopy: s(v2.postCopy),
  };
}

const lines = (t) => s(t).split('\n').map((x) => x.trim()).filter(Boolean);

/** Form state -> the `v2` argument of video-brief-save (the server validates and trims). */
export function toV2Body(f) {
  const n = (v) => { const x = Number(v); return Number.isFinite(x) && s(v).trim() !== '' ? x : v; };
  return {
    format: f.format, treatment: f.treatment, cast: lines(f.cast), bubbles: lines(f.bubbles), lesson: f.lesson, host: f.host, focus: f.focus, angle: f.angle,
    poster: { idea: f.posterIdea, hero: f.posterHero, banner: f.posterBanner, dateLine: f.posterDateLine, bubble: f.posterBubble },
    hero: f.hero, theme: f.theme,
    beats: f.beats.map((b) => ({ purpose: b.purpose, screen: b.screen, camera: b.camera, cursor: b.cursor, response: b.response, caption: b.caption, transition: b.transition, seconds: n(b.seconds) })),
    payoff: f.payoff, end: f.end, mustNot: f.mustNot, voiceMode: f.voiceMode, voiceReason: f.voiceReason,
    narrationLines: lines(f.narrationLines), needs: lines(f.needs), postCopy: f.postCopy,
  };
}

export const formTotalSeconds = (f) => Math.round(f.beats.reduce((a, b) => a + (Number(b.seconds) || 0), 0) * 10) / 10;
/** Longest allowed total for the form's format (promo 23 s, others 30 s) and the beat cap. */
export const secondsCap = (f) => (f.format === 'promo' ? PROMO_SECONDS_MAX : f.format === 'chapter' ? CHAPTER_SECONDS_MAX : V2_TOTAL_SECONDS_MAX);
export const beatsCap = (f) => (f.format === 'promo' ? PROMO_BEATS_MAX : V2_BEATS_MAX);
export const overBudget = (f) => formTotalSeconds(f) > secondsCap(f);
/** Fields still empty for 'ready' (same rule as the server, shown live). */
export const formMissing = (f) => v2Missing({
  format: f.format, treatment: f.treatment, cast: lines(f.cast), bubbles: lines(f.bubbles), lesson: f.lesson, angle: f.angle, poster: { banner: f.posterBanner, idea: f.posterIdea, hero: f.posterHero }, hero: f.hero, theme: f.theme,
  beats: f.beats, payoff: f.payoff, end: f.end, voiceMode: f.voiceMode, voiceReason: f.voiceReason, needs: lines(f.needs), narrationLines: lines(f.narrationLines),
});
/** Soft warnings for the form (same rule as the server's v2Warnings). */
export const formWarnings = (f) => v2Warnings({ format: f.format, poster: { hero: f.posterHero }, beats: f.beats, voiceMode: f.voiceMode, narrationLines: lines(f.narrationLines) });
export { v2TotalSeconds };

export const addBeat = (beats, max = V2_BEATS_MAX) => (beats.length >= max ? beats : [...beats, emptyBeat()]);
export const removeBeat = (beats, i) => (beats.length <= 1 ? beats : beats.filter((_, k) => k !== i));
export function moveBeat(beats, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= beats.length) return beats;
  const next = beats.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
export const setBeatCell = (beats, i, key, value) => beats.map((b, k) => (k === i ? { ...b, [key]: value } : b));
