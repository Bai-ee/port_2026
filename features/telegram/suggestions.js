// Daily-loop suggestions as the Telegram bot sees them: tolerant normalisation of a run doc's suggestions plus the
// pure presentation helpers (grouping line, card bundle, media decision). No I/O.
// Source shape (Agent C / daily-loop): { id, track, promotion:{id,label,url}, package:{id, media:{kind,ref}},
// draft:{text, selfReply}, edit?:{text}, why, kind, reviewState|status, socialPostId } — every field optional here.
import { createHash } from 'node:crypto';
import { escapeHtml } from './handoff.js';

export const MEDIA_URL_MAX_BYTES = 20 * 1024 * 1024; // Telegram bots fetch-by-URL up to 20MB
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const SAVED = new Set(['saved']);
const GONE = new Set(['dismissed']);

const trackOf = (s) => {
  const t = s?.track;
  if (t && typeof t === 'object') return { id: str(t.id) || 'general', label: str(t.label) || str(t.id) || 'general' };
  return { id: str(t) || 'general', label: str(t) || 'general' };
};

const urlOf = (v) => (/^https?:\/\//i.test(str(v)) ? str(v) : null);

const needsStagingOf = (s) => (s?.package?.media || s?.media)?.status === 'needs-staging';

function mediaOf(s) {
  const m = s?.package?.media || s?.media;
  if (!m || typeof m !== 'object') return null;
  const url = urlOf(m.url) || urlOf(m.signedUrl) || urlOf(m.ref) || urlOf(m.ref?.url) || urlOf(m.ref?.signedUrl);
  if (!url) return null;
  const kind = /video/i.test(String(m.kind || m.type || '')) ? 'video' : 'photo';
  const bytes = Number(m.bytes ?? m.size ?? m.sizeBytes ?? m.ref?.bytes ?? m.ref?.size);
  return { kind, url, posterUrl: urlOf(m.posterUrl) || urlOf(m.poster) || urlOf(m.thumbnailUrl) || null, bytes: Number.isFinite(bytes) ? bytes : null };
}

/** Stable short fingerprint of what the user is looking at; a regenerate or edit changes it. */
export function suggestionRev(run, s) {
  const text = str(s?.edit?.text) || str(s?.draft?.text);
  const runVer = run?.inputFingerprint || run?.generatedAt || '';
  return createHash('sha1').update(`${runVer}|${s?.id}|${text}|${s?.package?.id || ''}`).digest('base64url').slice(0, 8);
}

export function normalizeSuggestion(run, s) {
  if (!s || !s.id) return null;
  const reviewState = str(s.reviewState) || str(s.status);
  const postId = s.socialPostId || null;
  const state = GONE.has(reviewState) ? 'dismissed' : (SAVED.has(reviewState) || postId ? 'saved' : 'open');
  const track = trackOf(s);
  const p = s.promotion && typeof s.promotion === 'object' ? s.promotion : null;
  return {
    id: String(s.id),
    track: track.id, trackLabel: track.label,
    promotion: p && (p.label || p.id || p.url) ? { id: p.id || null, label: str(p.label) || str(p.id) || null, url: str(p.url) || null } : null,
    media: mediaOf(s),
    needsStaging: needsStagingOf(s),
    text: str(s.edit?.text) || str(s.draft?.text),
    selfReply: str(s.draft?.selfReply),
    why: str(s.why) || str(s.reason) || str(s.match?.reason),
    kind: str(s.kind) || str(s.type) || null,
    state, postId,
    rev: suggestionRev(run, s),
  };
}

/** "design 2 · music 1" (insertion order of first appearance). */
export function groupLine(open) {
  const by = new Map();
  for (const s of open) by.set(s.trackLabel, (by.get(s.trackLabel) || 0) + 1);
  return [...by].map(([label, n]) => `${label} ${n}`).join(' · ');
}

/** Ready (saveable) suggestions are counted apart from NAS items that still need staging. */
export function readySummary(open) {
  const ready = open.filter((x) => !x.needsStaging);
  const staging = open.filter((x) => x.needsStaging);
  const parts = [];
  if (ready.length) parts.push(`${ready.length} suggestion${ready.length === 1 ? '' : 's'} ready — ${groupLine(ready)}`);
  if (staging.length) parts.push(`${staging.length} needs staging`);
  return parts.join(' · ');
}

/**
 * Card parts: media decision, exact copy and the meta line.
 * media.mode: 'url' (send by URL), 'poster' (>20MB: poster + link), 'link' (>20MB, no poster), or null.
 */
export function buildSuggestionBundle(s) {
  const m = s.media;
  let media = null;
  let linkLine = null;
  if (m) {
    const big = m.bytes != null && m.bytes > MEDIA_URL_MAX_BYTES;
    if (!big) media = { type: m.kind, url: m.url, mode: 'url' };
    else {
      if (m.posterUrl) media = { type: 'photo', url: m.posterUrl, mode: 'poster' };
      linkLine = `${m.kind === 'video' ? 'Open video' : 'Open media'}: ${m.url}`;
    }
  }
  const metaLine = [s.trackLabel, s.promotion?.label || 'no promotion', s.why || 'no reason given'].join(' · ');
  const lines = [`<b>Suggestion</b>`, escapeHtml(metaLine)];
  if (s.kind) lines.push(`Type: ${escapeHtml(s.kind)}`);
  if (s.selfReply) lines.push(`Self-reply to post under it: ${escapeHtml(s.selfReply)}`);
  if (linkLine) lines.push(escapeHtml(linkLine));
  if (s.needsStaging) lines.push('<b>Needs staging:</b> this item is on the NAS and has no playable file yet. Tap Stage from NAS (the Mac analyzer must be online). You can save the draft once staging finishes.');
  if (!s.text) lines.push('<i>No copy yet. Open HITLOOP to write it.</i>');
  return { media, copyText: s.text, metaHtml: lines.join('\n') };
}
