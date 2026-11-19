import { createRequire } from 'node:module';
import { stripBrief, briefOfPost } from './brief.js';

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

/** One transaction: re-read the post, re-check every precondition, write post + stamp job. Returns { attached, reason? }. */
export async function attachJobToPost(job, { db = require('../../api/_lib/firebase-admin.cjs').adminDb, force = false, now = new Date().toISOString() } = {}) {
  const postRef = db.collection(POSTS).doc(job.postId);
  const jobRef = db.collection(JOBS).doc(job.jobId);
  return db.runTransaction(async (tx) => {
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
    return { attached: true };
  });
}
