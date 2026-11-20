// video-review.js — the owner's feedback loop on an attached storyboard episode video (approve / request changes / restore an earlier version).
//
// Storage shape (all under videoBriefMeta, v2 briefs only):
//   storyboard.versions[]  Director-written, append-only (max 20): { v, outlineHash, episode, notes, createdAt, createdBy }.
//   storyboard.feedback[]  app-written, append-only (last 50): { v, notes, atSeconds, by, at }.
//   videoReview            { status 'pending'|'approved'|'changes', v, outlineHash, notes, atSeconds, by, at, requestedAt }.
// Firestore set(merge:true) deep-merges maps and replaces arrays whole, so every videoReview write carries ALL keys (nulls included)
// and arrays are only ever written from a read inside the same transaction. Pure: no Firestore, no network.

import { isV2Meta } from './brief-v2.js';

export const VERSIONS_MAX = 20;
export const FEEDBACK_MAX = 50;
export const VIDEO_REVIEW_NOTES_MAX = 2000;
export const AT_SECONDS_MAX = 3600;

const str = (v) => (v == null ? '' : String(v));
const stateError = (message, code, status = 409) => Object.assign(new Error(message), { status, code });
const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'invalid-video-review' });
const byOf = (by) => (by ? String(by).slice(0, 200) : null);

/** A videoReview object with every key present (deep-merge safe). */
export const reviewRecord = ({ status, v = null, outlineHash = null, notes = null, atSeconds = null, by = null, at = null, requestedAt = null }) => (
  { status, v, outlineHash, notes, atSeconds, by: byOf(by), at, requestedAt }
);

export const versionsOf = (meta) => (Array.isArray(meta?.storyboard?.versions) ? meta.storyboard.versions.filter((x) => x && typeof x === 'object' && Number.isInteger(x.v)) : []);
export const versionEntry = (meta, v) => versionsOf(meta).find((x) => x.v === Number(v)) || null;

/** Does this stored episode describe the media currently on the post? (same file, same outline) */
export const episodeIsOnPost = (post, episode) => Boolean(episode && post?.mediaJobId === `cal_${episode.episodeId}` && post?.mediaStoragePath === episode.storagePath && post?.mediaMetadata?.outlineHash === episode.outlineHash);

/** Version number of an episode: its entry in versions[] (same file + hash), else the latest-version fallback (1 when no history exists). */
export function versionOfEpisode(meta, episode) {
  const hit = versionsOf(meta).find((x) => x.episode && x.episode.storagePath === episode?.storagePath && x.episode.outlineHash === episode?.outlineHash);
  return hit ? hit.v : (versionsOf(meta).length || 0) + 1;
}

/** Version of the media attached to the post (null when no episode video is attached). */
export function attachedVersion(post) {
  const meta = post?.videoBriefMeta;
  if (!post?.mediaUrl || !String(post.mediaJobId || '').startsWith('cal_')) return null;
  const hit = versionsOf(meta).find((x) => x.episode && episodeIsOnPost(post, x.episode));
  if (hit) return hit.v;
  const ep = meta?.storyboard?.episode;
  return ep && episodeIsOnPost(post, ep) ? versionOfEpisode(meta, ep) : 1;
}

const parseAt = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > AT_SECONDS_MAX) throw bad(`atSeconds must be between 0 and ${AT_SECONDS_MAX}.`);
  return Math.round(n * 10) / 10;
};

/** Owner decision on the attached video. Returns the next videoBriefMeta (never touches media). */
export function applyVideoReview(post, input = {}, { by = null, now = new Date().toISOString() } = {}) {
  const meta = post?.videoBriefMeta;
  const sb = meta?.storyboard;
  if (!isV2Meta(meta) || !sb) throw stateError('There is no storyboard video to review.', 'no-storyboard');
  const v = attachedVersion(post);
  if (v == null) throw stateError('No storyboard video is attached to this post yet.', 'no-video');
  const decision = str(input.decision).trim();
  if (!['approve', 'changes'].includes(decision)) throw bad('decision must be approve or changes.');
  const outlineHash = post.mediaMetadata?.outlineHash || null;
  // The owner decided on a specific video: it must still be the one on the post.
  if (Number(input.v) !== v || !outlineHash || str(input.outlineHash) !== outlineHash) throw stateError('The video on this post changed. Reload and review the current version.', 'video-changed');
  if (decision === 'approve') {
    // Approving the video the owner is looking at withdraws an open change request; a newer ready version stays waiting.
    const closes = sb.status === 'changes';
    return { ...meta, videoReview: reviewRecord({ status: 'approved', v, outlineHash, by, at: now }), ...(closes ? { storyboard: { ...sb, status: 'approved', updatedAt: now, updatedBy: byOf(by) } } : {}) };
  }
  const notes = str(input.notes).replace(/\r\n?/g, '\n').trim();
  if (!notes) throw bad('Say what should change.');
  if (notes.length > VIDEO_REVIEW_NOTES_MAX) throw bad(`notes must be ${VIDEO_REVIEW_NOTES_MAX} characters or fewer.`);
  const atSeconds = parseAt(input.atSeconds);
  const feedback = [...(Array.isArray(sb.feedback) ? sb.feedback : []), { v, notes, atSeconds, by: byOf(by), at: now }].slice(-FEEDBACK_MAX);
  return {
    ...meta,
    videoReview: reviewRecord({ status: 'changes', v, outlineHash, notes, atSeconds, by, at: now, requestedAt: now }),
    storyboard: { ...sb, status: 'changes', feedback, updatedAt: now, updatedBy: byOf(by) },
  };
}

/** Calendar-chip state for a row: 'changes' (revision requested) | 'ready' (new version waiting) | 'approved' | null. */
export function videoReviewChip(row) {
  const meta = row?.videoBriefMeta;
  if (!isV2Meta(meta) || !meta.storyboard) return null;
  const sb = meta.storyboard;
  if (meta.videoReview?.status === 'changes' || sb.status === 'changes') return 'changes';
  if (row.mediaUrl && sb.status === 'ready' && sb.episode && !episodeIsOnPost(row, sb.episode)) return 'ready';
  if (meta.videoReview?.status === 'approved') return 'approved';
  return null;
}

/** Director inbox: this client's draft posts with an open change request, newest request first. */
export function listRevisionRequests(posts) {
  const out = [];
  for (const p of Array.isArray(posts) ? posts : []) {
    if (!p || p.status !== 'draft') continue;
    const meta = p.videoBriefMeta;
    if (!isV2Meta(meta) || !meta.storyboard) continue;
    const r = meta.videoReview;
    if (!(r?.status === 'changes' || meta.storyboard.status === 'changes')) continue;
    const fb = Array.isArray(meta.storyboard.feedback) ? meta.storyboard.feedback : [];
    const last = fb[fb.length - 1] || null;
    out.push({
      postId: p.id || null,
      revision: p.revision ?? null,
      v: r?.v ?? last?.v ?? null,
      notes: (r?.status === 'changes' ? r.notes : null) ?? last?.notes ?? meta.storyboard.notes ?? null,
      atSeconds: (r?.status === 'changes' ? r.atSeconds : null) ?? last?.atSeconds ?? null,
      requestedAt: r?.requestedAt || last?.at || meta.storyboard.updatedAt || null,
      requestedBy: r?.by || last?.by || null,
      storyboardStatus: meta.storyboard.status || null,
      episodeId: meta.storyboard.episode?.episodeId || null,
      versions: versionsOf(meta).length,
      reviewOn: p.reviewOn || null,
      content: str(p.content).slice(0, 280),
    });
  }
  return out.sort((a, b) => str(b.requestedAt).localeCompare(str(a.requestedAt)));
}
