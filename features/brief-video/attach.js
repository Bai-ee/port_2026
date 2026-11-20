import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { stripBrief, briefOfPost } from './brief.js';
import { fillVersionMedia } from './brief-versions.js';

// Same normalisation as twitter-service normalizePostText (kept local so this module stays free of the X client).
const normalizePostText = (c) => String(c || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const PUBLIC_MAX = 280;

const require = createRequire(import.meta.url);

const POSTS = 'social_posts';
const JOBS = 'brief_video_jobs';

/**
 * Pure decision: may this done job's video be attached to this post row? Returns { ok:true, updated } or { ok:false, reason }.
 * Writes nothing; the caller commits it in one transaction. `force` (re-render) allows replacing media that a bv_ job attached.
 */
export function planAttach(post, job, { force = false, now = new Date().toISOString() } = {}) {
  if (!post) return { ok: false, reason: 'post-missing' };
  if (post.clientId !== job.clientId) return { ok: false, reason: 'client-mismatch' };
  if (post.status !== 'draft') return { ok: false, reason: 'not-draft' };
  const hasOtherMedia = (Array.isArray(post.mediaVariants) ? post.mediaVariants.length > 0 : Boolean(post.mediaVariants && Object.keys(post.mediaVariants).length)) || Boolean(post.nasSha);
  if (hasOtherMedia) return { ok: false, reason: 'has-media' };
  // replaceDraftMedia (local takeover job): may replace the draft's current video; still draft-only (status checked above, inside the attach transaction).
  // Only media that a brief job (bv_*) attached may be replaced; never something the owner uploaded.
  const fromBriefJob = String(post.mediaJobId || '').startsWith('bv_');
  const canReplace = fromBriefJob && (force || job.replaceDraftMedia === true);
  // Local takeover (hub howto-attach.mjs): no briefHash/howtoId on the job, so the brief match is skipped (postId/clientId/draft checks stay).
  const takeover = job.source === 'local' && job.replaceDraftMedia === true;
  if (post.mediaUrl && !canReplace) return { ok: false, reason: 'has-media' };
  const current = briefOfPost(post);
  if (!current && !takeover) return { ok: false, reason: 'no-brief' };
  if (!takeover && current.briefHash !== job.briefHash) return { ok: false, reason: 'brief-changed' };
  const publicCopy = normalizePostText(stripBrief(post.content));
  if (!publicCopy) return { ok: false, reason: 'empty-public-copy' };
  if (publicCopy.length > PUBLIC_MAX) return { ok: false, reason: 'public-copy-too-long' };
  if (!job.downloadUrl || !job.posterUrl) return { ok: false, reason: 'job-incomplete' };
  const agents = post.agents && typeof post.agents === 'object' ? { ...post.agents } : {};
  const isHowto = job.kind === 'cq-howto';
  agents.mediaGenerator = { status: 'complete', note: isHowto ? 'Attached how-to video (CQ HowTo template).' : 'Attached brief video (CQ BriefCut template).', mediaUrl: job.downloadUrl, jobId: job.jobId };
  const updated = {
    ...post,
    content: stripBrief(post.content),
    ...(current ? { videoBrief: current.brief, videoBriefHash: current.briefHash } : {}),
    ...(post.videoBriefMeta && typeof post.videoBriefMeta === 'object' ? { videoBriefMeta: { ...post.videoBriefMeta, status: 'rendered', updatedAt: now } } : {}),
    mediaUrl: job.downloadUrl,
    mediaType: 'video',
    mediaContentType: 'video/mp4',
    mediaStoragePath: job.outputPath || null,
    mediaJobId: job.jobId,
    posterUrl: job.posterUrl,
    mediaMetadata: { source: isHowto ? 'cq-howto' : 'cq-briefcut', templateVersion: job.templateVersion, ...(isHowto ? { howtoId: job.howtoId ?? null, specHash: job.specHash ?? null, ...(job.requestHash ? { requestHash: job.requestHash } : {}) } : {}), width: job.width ?? null, height: job.height ?? null, durationInFrames: job.durationInFrames ?? null },
    // clear the visible brief status (set by the cron when a howto brief was waiting / invalid)
    ...('videoBriefStatus' in post || 'videoBriefReason' in post ? { videoBriefStatus: null, videoBriefReason: null } : {}),
    agents,
    revision: (post.revision || 0) + 1,
    updatedAt: now,
  };
  return { ok: true, updated };
}

// ── Storyboard episode attach (v2): the owner's "Approve storyboard" puts a pre-rendered, QA-passed episode on the draft. ───────
const HASH16 = /^[0-9a-f]{16}$/;
const fail = (reason) => ({ ok: false, reason });
const dirOf = (clientId) => `clients/${clientId}/brief-videos/`;
const safePath = (p, clientId, ext) => typeof p === 'string' && p.startsWith(dirOf(clientId)) && p.toLowerCase().endsWith(ext) && !p.split('/').some((seg) => seg === '..' || seg === '');
const sortKeysDeep = (v) => (Array.isArray(v) ? v.map(sortKeysDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeysDeep(v[k])])) : v);
/** Same recipe as the hub (services/showcase-render/episode.mjs): sha256(JSON.stringify(sortKeysDeep(outline))).slice(0,16). */
export const outlineHashOf = (outline) => createHash('sha256').update(JSON.stringify(sortKeysDeep(outline))).digest('hex').slice(0, 16);
export const episodeJobId = (episode) => `cal_${episode?.episodeId}`;

/** Shape/path checks only (no I/O). Returns { ok:true } or { ok:false, reason }. Nothing in `episode` is trusted as a URL. */
export function validateEpisode(episode, { clientId } = {}) {
  if (!episode || typeof episode !== 'object' || !clientId) return fail('episode-missing');
  if (typeof episode.episodeId !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(episode.episodeId)) return fail('episode-bad-id');
  if (typeof episode.outlineHash !== 'string' || !HASH16.test(episode.outlineHash)) return fail('episode-bad-hash');
  if (!safePath(episode.storagePath, clientId, '.mp4')) return fail('episode-bad-path');
  if (episode.posterStoragePath != null && !safePath(episode.posterStoragePath, clientId, '.jpg')) return fail('episode-bad-poster-path');
  if (!episode.posterStoragePath) return fail('episode-bad-poster-path');
  if (episode.outlineJson != null) { // verified when the Director stored the outline beside the hash
    let parsed = null;
    try { parsed = JSON.parse(episode.outlineJson); } catch { /* mismatch below */ }
    if (!parsed || outlineHashOf(parsed) !== episode.outlineHash) return fail('episode-hash-mismatch');
  }
  if (!episode.qa || episode.qa.ok !== true) return fail('episode-qa-not-passed');
  return { ok: true };
}

/** Admin-SDK check that the video (video/mp4) and poster exist in `bucket`; returns { ok, mediaUrl, posterUrl } with URLs derived here from the object's download token (minted when missing). */
export async function resolveEpisodeMedia(bucket, episode, { clientId } = {}) {
  const v = validateEpisode(episode, { clientId });
  if (!v.ok) return v;
  const urlOf = async (path, wantType) => {
    const file = bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [meta] = await file.getMetadata();
    if (!String(meta?.contentType || '').toLowerCase().startsWith(wantType)) return null;
    let token = String(meta?.metadata?.firebaseStorageDownloadTokens || '').split(',')[0].trim();
    if (!token) { token = randomUUID(); await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } }); }
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  };
  try {
    const mediaUrl = await urlOf(episode.storagePath, 'video/mp4');
    if (!mediaUrl) return fail('episode-media-missing');
    const posterUrl = await urlOf(episode.posterStoragePath, 'image/');
    if (!posterUrl) return fail('episode-poster-missing');
    return { ok: true, mediaUrl, posterUrl };
  } catch {
    return fail('episode-media-unreadable');
  }
}

/** Already attached: this exact episode (same outline hash) is on the post. */
export const episodeAlreadyAttached = (post, episode) => Boolean(episode && post?.mediaJobId === episodeJobId(episode) && post?.videoBriefMeta?.storyboard?.episode?.outlineHash === episode.outlineHash);

/**
 * Pure decision for the review transaction on 'approve': may this storyboard's episode video go on this draft? Returns { ok:true, patch } (merge patch)
 * or { ok:false, reason }. `urls` = { mediaUrl, posterUrl } from resolveEpisodeMedia (server-derived, never from the episode).
 */
export function planEpisodeAttach(post, episode, { clientId, urls = {}, now = new Date().toISOString() } = {}) {
  if (!post) return fail('post-missing');
  if (post.clientId !== clientId) return fail('client-mismatch');
  if (post.status !== 'draft') return fail('not-draft');
  const v = validateEpisode(episode, { clientId });
  if (!v.ok) return v;
  if (!urls.mediaUrl || !urls.posterUrl) return fail('job-incomplete');
  const hasVariants = Array.isArray(post.mediaVariants) ? post.mediaVariants.length > 0 : Boolean(post.mediaVariants && Object.keys(post.mediaVariants).length);
  if (hasVariants || post.nasSha) return fail('has-media');
  const hasMedia = Boolean(post.mediaUrl || post.mediaStoragePath || post.mediaJobId);
  const jobId = String(post.mediaJobId || '');
  if (hasMedia && !(jobId.startsWith('cal_') || jobId.startsWith('bv_'))) return fail('has-media');
  const publicCopy = normalizePostText(stripBrief(post.content));
  if (!publicCopy) return fail('empty-public-copy');
  if (publicCopy.length > PUBLIC_MAX) return fail('public-copy-too-long');
  const agents = post.agents && typeof post.agents === 'object' ? { ...post.agents } : {};
  const newJobId = episodeJobId(episode);
  agents.mediaGenerator = { status: 'complete', note: 'Attached storyboard episode video (CQ calendar episode).', mediaUrl: urls.mediaUrl, jobId: newJobId };
  const patch = {
    videoBriefMeta: { status: 'rendered', updatedAt: now },
    mediaUrl: urls.mediaUrl,
    mediaType: 'video',
    mediaContentType: 'video/mp4',
    mediaStoragePath: episode.storagePath,
    mediaJobId: newJobId,
    posterUrl: urls.posterUrl,
    // merge:true deep-merges maps: null the keys an earlier bv_ / how-to attach may have left.
    mediaMetadata: { source: 'cq-calendar-episode', templateVersion: 'cq-cal-1', episodeId: episode.episodeId, kit: episode.kit ?? null, outlineHash: episode.outlineHash, width: episode.width ?? null, height: episode.height ?? null, durationInFrames: episode.durationInFrames ?? null, howtoId: null, specHash: null, requestHash: null },
    videoBriefStatus: null,
    videoBriefReason: null,
    agents,
    revision: (post.revision || 0) + 1,
    updatedAt: now,
  };
  return { ok: true, patch };
}

/** One transaction: re-read the post, re-check every precondition, write post + stamp job. Returns { attached, reason? }. */
export async function attachJobToPost(job, { db = require('../../api/_lib/firebase-admin.cjs').adminDb, force = false, now = new Date().toISOString() } = {}) {
  const postRef = db.collection(POSTS).doc(job.postId);
  const jobRef = db.collection(JOBS).doc(job.jobId);
  const out = await db.runTransaction(async (tx) => {
    const [postSnap, jobSnap] = await Promise.all([tx.get(postRef), tx.get(jobRef)]);
    const liveJob = jobSnap.exists ? jobSnap.data() : null;
    if (!liveJob || liveJob.status !== 'done') return { attached: false, reason: 'job-not-done' };
    if (liveJob.attachedAt || liveJob.attachSkipped) return { attached: false, reason: 'already-stamped' };
    const plan = planAttach(postSnap.exists ? postSnap.data() : null, liveJob, { force, now });
    if (!plan.ok) {
      tx.set(jobRef, { attachSkipped: plan.reason, updatedAt: now }, { merge: true });
      return { attached: false, reason: plan.reason };
    }
    tx.set(postRef, plan.updated);
    tx.set(jobRef, { attachedAt: now, updatedAt: now }, { merge: true });
    return { attached: true, liveJob };
  });
  if (!out.attached) return out;
  await fillVersionMedia(db, out.liveJob); // version history, best-effort
  return { attached: true };
}
