import { createHash } from 'node:crypto';
import { DAILY_BRIEF_VIDEO_CLIENTS, TEMPLATE_VERSION, MAX_ATTEMPTS, LOOKAHEAD_DAYS } from './clients.js';
import { parseBrief } from './brief.js';

export const JOB_ID_RE = /^bv_[a-z0-9_]{6,40}$/;

/** Idempotent: the same post+brief+template+attempt always maps to the same job doc. */
export const briefJobId = ({ postId, briefHash, templateVersion = TEMPLATE_VERSION, attempt = 1 }) =>
  'bv_' + createHash('sha256').update(`${postId}:${briefHash}:${templateVersion}:${attempt}`).digest('hex').slice(0, 20);

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

export function selectCandidates(posts, { today, clients = DAILY_BRIEF_VIDEO_CLIENTS, lookaheadDays = LOOKAHEAD_DAYS } = {}) {
  const last = addDaysIso(today, lookaheadDays);
  return (posts || [])
    .filter((p) => p && clients[p.clientId] && p.status === 'draft' && !p.mediaUrl
      && DAY_RE.test(String(p.reviewOn || '')) && p.reviewOn >= today && p.reviewOn <= last)
    .map((post) => ({ post, parsed: parseBrief(post.content) }))
    .filter((c) => c.parsed && !HOLD_RE.test(c.parsed.brief))
    .sort((a, b) => (a.post.reviewOn < b.post.reviewOn ? -1 : a.post.reviewOn > b.post.reviewOn ? 1 : String(a.post.id).localeCompare(String(b.post.id))));
}

export function newJobDoc({ post, parsed, attempt, now, videoClient = DAILY_BRIEF_VIDEO_CLIENTS[post.clientId] }) {
  const iso = new Date(now).toISOString();
  return {
    v: 1,
    jobId: briefJobId({ postId: post.id, briefHash: parsed.briefHash, attempt }),
    kind: 'cq-brief',
    clientId: post.clientId,
    videoClient,
    postId: post.id,
    reviewOn: post.reviewOn,
    brief: parsed.brief,
    briefHash: parsed.briefHash,
    hook: parsed.hook,
    templateVersion: TEMPLATE_VERSION,
    status: 'queued',
    createdAt: iso,
    updatedAt: iso,
    triggerAt: iso,
    attempt,
  };
}

export const nextAttempt = (existingAttempts) => (existingAttempts.length ? Math.max(...existingAttempts) + 1 : 1);
export const attemptsExhausted = (existingAttempts) => existingAttempts.length >= MAX_ATTEMPTS;
