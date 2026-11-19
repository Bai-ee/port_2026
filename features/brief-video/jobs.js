import { createHash } from 'node:crypto';
import { DAILY_BRIEF_VIDEO_CLIENTS, TEMPLATE_VERSION, HOWTO_TEMPLATE_VERSION, MAX_ATTEMPTS, LOOKAHEAD_DAYS } from './clients.js';
import { parseBrief, briefOfPost } from './brief.js';
import { panelBriefBlocksRender } from './brief-fields.js';

export const JOB_ID_RE = /^bv_[a-z0-9_]{6,40}$/;

/** Idempotent: the same post+brief+template+attempt always maps to the same job doc. */
export const briefJobId = ({ postId, briefHash, templateVersion = TEMPLATE_VERSION, attempt = 1 }) =>
  'bv_' + createHash('sha256').update(`${postId}:${briefHash}:${templateVersion}:${attempt}`).digest('hex').slice(0, 20);

/** cq-howto job id: also hashes the approved specHash, so a re-approved spec gets a fresh id. */
export const howtoJobId = ({ postId, briefHash, specHash, attempt = 1 }) =>
  'bv_' + createHash('sha256').update(`${postId}:${briefHash}:${HOWTO_TEMPLATE_VERSION}:${specHash}:${attempt}`).digest('hex').slice(0, 20);

/** cq-howto job id for an auto-approved request job: hashes requestHash + narration instead of a baked specHash. */
export const howtoRequestJobId = ({ postId, briefHash, requestHash, narration, attempt = 1 }) =>
  'bv_' + createHash('sha256').update(`${postId}:${briefHash}:${HOWTO_TEMPLATE_VERSION}:${requestHash}:${narration}:${attempt}`).digest('hex').slice(0, 20);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function addDaysIso(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Earliest eligible draft: allowlisted client, status draft, reviewOn in today..today+7 (CT), no mediaUrl, brief present,
 * and not already attempted MAX_ATTEMPTS times for this brief. `usedAttempts(post, parsed)` is injected (job lookup).
 * Pure: returns [{ post, parsed }] sorted by reviewOn then id.
 */
export const HOLD_RE = /\bHOLD\b/;

export function selectCandidates(posts, { today, clients = DAILY_BRIEF_VIDEO_CLIENTS, lookaheadDays = LOOKAHEAD_DAYS, includeHowto = false } = {}) {
  const last = addDaysIso(today, lookaheadDays);
  return (posts || [])
    .filter((p) => p && clients[p.clientId] && p.status === 'draft' && !p.mediaUrl
      && DAY_RE.test(String(p.reviewOn || '')) && p.reviewOn >= today && p.reviewOn <= last)
    // Panel briefs (brief-fields.js) render only once the owner approved them; legacy content briefs are unchanged.
    .filter((post) => !panelBriefBlocksRender(post))
    .map((post) => ({ post, parsed: briefOfPost(post) }))
    .filter((c) => c.parsed && !HOLD_RE.test(c.parsed.brief))
    // howto / invalid briefs never become a cq-brief job; with the howto flag on the worker still needs them (status + readiness).
    .filter((c) => includeHowto || c.parsed.briefKind === 'freetext')
    .sort((a, b) => (a.post.reviewOn < b.post.reviewOn ? -1 : a.post.reviewOn > b.post.reviewOn ? 1 : String(a.post.id).localeCompare(String(b.post.id))));
}

export function newJobDoc({ post, parsed, attempt, now, videoClient = DAILY_BRIEF_VIDEO_CLIENTS[post.clientId], specHash = null, request = null, requestHash = null, narration = false, renderNow = false }) {
  const byRequest = Boolean(request && requestHash);
  if (parsed?.briefKind !== 'freetext' && !(parsed?.briefKind === 'howto' && (specHash || byRequest))) throw new Error(`newJobDoc: not renderable (briefKind=${parsed?.briefKind}${parsed?.briefKind === 'howto' ? ', no specHash' : ''})`);
  const iso = new Date(now).toISOString();
  const howto = parsed.briefKind === 'howto' && (Boolean(specHash) || byRequest);
  return {
    v: 1,
    jobId: howto && byRequest ? howtoRequestJobId({ postId: post.id, briefHash: parsed.briefHash, requestHash, narration: Boolean(narration), attempt }) : howto ? howtoJobId({ postId: post.id, briefHash: parsed.briefHash, specHash, attempt }) : briefJobId({ postId: post.id, briefHash: parsed.briefHash, attempt }),
    kind: howto ? 'cq-howto' : 'cq-brief',
    ...(howto && byRequest ? { howtoId: parsed.howtoId, request, requestHash, narration: Boolean(narration), renderNow: Boolean(renderNow) } : howto ? { howtoId: parsed.howtoId, specHash } : {}),
    clientId: post.clientId,
    videoClient,
    postId: post.id,
    reviewOn: post.reviewOn,
    brief: parsed.brief,
    briefHash: parsed.briefHash,
    hook: parsed.hook,
    templateVersion: howto ? HOWTO_TEMPLATE_VERSION : TEMPLATE_VERSION,
    status: 'queued',
    createdAt: iso,
    updatedAt: iso,
    triggerAt: iso,
    attempt,
    ...(renderNow && !(howto && byRequest) ? { renderNow: true } : {}),
  };
}

export const nextAttempt = (existingAttempts) => (existingAttempts.length ? Math.max(...existingAttempts) + 1 : 1);
export const attemptsExhausted = (existingAttempts) => existingAttempts.length >= MAX_ATTEMPTS;
