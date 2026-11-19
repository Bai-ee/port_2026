// Read-only video-processing status for the calendar. Joins a draft with its brief_video_jobs and returns a compact
// `videoProcessing` object per post: { state, label, detail?, jobId?, updatedAt? }. Never writes. Only allowlisted
// clients (DAILY_BRIEF_VIDEO_CLIENTS) and only posts that carry a brief are looked at, one query per 30 posts.
import { DAILY_BRIEF_VIDEO_CLIENTS, BRIEF_VIDEO_JOBS, MAX_ATTEMPTS, LOOKAHEAD_DAYS, howtoEnabled } from './clients.js';
import { briefOfPost, BRIEF_MARKER_RE } from './brief.js';
import { addDaysIso, HOLD_RE } from './jobs.js';
import { panelBriefBlocksRender, panelBriefNeedsAuthoring } from './brief-fields.js';

export const IN_CHUNK = 30;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ctFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
const ctDay = (ms) => ctFmt.format(new Date(ms));

const isBvId = (v) => typeof v === 'string' && v.startsWith('bv_');
const short = (s, n = 80) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const stamp = (j) => j?.updatedAt || j?.finishedAt || j?.createdAt || undefined;
const out = (state, label, extra = {}) => ({ state, label, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null && v !== '')) });

/** Does this post carry (or once carried) a video brief? */
export const hasVideoBrief = (post) => Boolean(post) && (BRIEF_MARKER_RE.test(String(post.content ?? '')) || (typeof post.videoBrief === 'string' && post.videoBrief.trim() !== '') || isBvId(post.mediaJobId));

/** Attached already: a bv_ job produced the media on the post. */
export const isAttached = (post) => isBvId(post?.mediaJobId) && Boolean(post?.mediaUrl);

/** Newest first: highest attempt, then latest createdAt. */
const newestFirst = (a, b) => (Number(b.attempt || 0) - Number(a.attempt || 0)) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

/**
 * Pure. `jobs` = this post's brief_video_jobs. Returns null when there is nothing worth showing.
 * Mirrors selectCandidates for the no-job case.
 */
export function classifyVideoProcessing(post, jobs = [], { today, howto = false } = {}) {
  if (!hasVideoBrief(post)) return null;
  if (isAttached(post)) {
    const src = post.mediaMetadata?.source;
    return out('attached', 'Video attached', { detail: src === 'cq-howto' ? 'how-to' : src === 'cq-briefcut' ? 'brief cut' : null, jobId: post.mediaJobId });
  }
  const parsed = briefOfPost(post);
  if (!parsed) return out('invalid', 'Brief not valid: empty-brief');
  const own = (Array.isArray(jobs) ? jobs : []).filter((j) => j && j.postId === post.id && (!j.briefHash || j.briefHash === parsed.briefHash));
  const job = [...own].sort(newestFirst)[0];
  if (job) {
    const base = { jobId: job.jobId, updatedAt: stamp(job) };
    if (job.status === 'done') {
      if (job.attachSkipped) return out('not-attached', `Not attached: ${short(job.attachSkipped)}`, base);
      if (job.attachedAt) return out('attached', 'Video attached', { ...base, detail: job.kind === 'cq-howto' ? 'how-to' : 'brief cut' });
      return out('rendered', 'Rendered, attaching on next tick', base);
    }
    if (job.status === 'rendering') return out('rendering', 'Rendering', base);
    if (job.status === 'queued') return out('queued', 'Queued', base);
    if (job.status === 'failed') {
      const e = job.error || {};
      const what = [e.stage, short(e.message)].filter(Boolean).join(' ');
      return out('failed', `Render failed${what ? `: ${what}` : ''}`, { ...base, detail: `attempt ${job.attempt || own.length}/${MAX_ATTEMPTS}` });
    }
  }
  if (post.videoBriefStatus === 'waiting_howto') return out('waiting', `Waiting: ${post.videoBriefReason || 'how-to request'}`);
  if (post.videoBriefStatus === 'invalid_brief') return out('invalid', `Brief not valid: ${post.videoBriefReason || 'invalid'}`);
  // No job yet. Only an open draft without media can still get one.
  if (post.status !== 'draft' || post.mediaUrl) return null;
  if (panelBriefNeedsAuthoring(post)) {
    const why = post.videoBriefMeta?.authorError?.reasons;
    return out('needs-authoring', Array.isArray(why) && why.length ? `Not turned into a video request yet: ${why.join('; ')}` : 'Approve the Creative Brief so its video request is written');
  }
  if (parsed.briefKind === 'invalid') return out('invalid', `Brief not valid: ${parsed.invalidReason}`);
  if (panelBriefBlocksRender(post)) return out('brief-not-approved', `Brief ${post.videoBriefMeta.status}: approve it to render`);
  if (HOLD_RE.test(parsed.brief)) return out('hold', 'On hold (HOLD in brief)');
  const on = String(post.reviewOn || '');
  if (!DAY_RE.test(on)) return out('waiting', 'Needs a review date to render');
  if (today && on < today) return out('skipped', `Not rendered: review date ${on} has passed`);
  if (today && on > addDaysIso(today, LOOKAHEAD_DAYS)) return out('later', `Renders when within ${LOOKAHEAD_DAYS} days of ${on}`);
  if (parsed.briefKind === 'howto' && !howto) return out('off', 'How-to videos are off');
  return out('pending', 'Waiting for the next render tick');
}

/**
 * Reads the jobs for the qualifying posts and classifies each. Returns Map(postId -> videoProcessing).
 * Allowlisted clients only; posts that are already attached need no job read. `db` is a Firestore (or fake) handle.
 */
export async function readVideoProcessing(db, posts, { now = Date.now(), clients = DAILY_BRIEF_VIDEO_CLIENTS, env = process.env } = {}) {
  const result = new Map();
  const today = ctDay(now);
  const howto = howtoEnabled(env);
  const byClient = new Map();
  for (const p of Array.isArray(posts) ? posts : []) {
    if (!p?.id || !clients[p.clientId] || !hasVideoBrief(p)) continue;
    if (!byClient.has(p.clientId)) byClient.set(p.clientId, []);
    byClient.get(p.clientId).push(p);
  }
  for (const [clientId, list] of byClient) {
    const jobsByPost = new Map();
    // Job lookups only for open drafts (cost): other posts are classified statically, with no query.
    const need = list.filter((p) => !isAttached(p) && p.status === 'draft');
    for (let i = 0; i < need.length; i += IN_CHUNK) {
      const ids = need.slice(i, i + IN_CHUNK).map((p) => p.id);
      const snap = await db.collection(BRIEF_VIDEO_JOBS).where('clientId', '==', clientId).where('postId', 'in', ids).get();
      for (const d of snap.docs) {
        const j = d.data();
        if (j?.clientId !== clientId) continue; // never join another client's job
        if (!jobsByPost.has(j.postId)) jobsByPost.set(j.postId, []);
        jobsByPost.get(j.postId).push(j);
      }
    }
    for (const p of list) {
      const vp = classifyVideoProcessing(p, jobsByPost.get(p.id) || [], { today, howto });
      if (vp) result.set(p.id, vp);
    }
  }
  return result;
}

/** Posts with `videoProcessing` attached (new objects; the input is untouched). Never throws: the status is advisory. */
export async function withVideoProcessing(db, posts, opts = {}) {
  try {
    const map = await readVideoProcessing(db, posts, opts);
    if (!map.size) return posts;
    return posts.map((p) => (map.has(p.id) ? { ...p, videoProcessing: map.get(p.id) } : p));
  } catch (err) {
    console.warn('[video-status] lookup failed', err?.code || '', err?.message);
    return posts;
  }
}
