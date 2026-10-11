// Post results (Content Management Phase 5).
//
// Pure: no I/O, no clock (`now` is injected and only echoed for determinism).
// Separates delivery state (posted / pending / failed) from engagement
// evidence. Missing metrics stay null; a real 0 stays 0.
// Reuses joinPerformance (performance.js) for metric normalisation.

import { joinPerformance, MIN_N } from './performance.js';

export const LIST_CAP = 50;
const EXCERPT_MAX = 140;
const ERROR_MAX = 200;
const PENDING_STATUSES = ['approved', 'awaiting_approval', 'scheduled', 'queued', 'posting'];
const FAILED_STATUSES = ['failed', 'expired'];

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}
const iso = (v) => { const t = toMs(v); return t == null ? null : new Date(t).toISOString(); };
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function baseRow(post, pkgById) {
  const pkg = post.packageId ? pkgById.get(post.packageId) : null;
  return {
    id: post.id,
    status: post.status,
    content: clip(post.content ?? post.text, EXCERPT_MAX),
    engine: post.engine ?? null,
    scheduledAt: iso(post.scheduledAt),
    postedAt: iso(post.postedAt),
    twitterId: post.twitterId ?? null,
    packageId: post.packageId ?? null,
    packageTitle: pkg ? (pkg.title ?? pkg.name ?? null) : null,
    origin: {
      runId: post.runId ?? null,
      suggestionId: post.suggestionId ?? null,
      strategyVersion: post.strategyVersion ?? null,
      source: post.source ?? null,
      sourceRefKind: post.sourceRef?.kind ?? null,
    },
    metrics: null,
    metricsNote: 'not measured yet',
  };
}

const byDescPosted = (a, b) => (toMs(b.postedAt) ?? -Infinity) - (toMs(a.postedAt) ?? -Infinity);
const byScheduled = (a, b) => {
  const x = toMs(a.scheduledAt); const y = toMs(b.scheduledAt);
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return x - y;
};

export function buildPostResults({ posts = [], packages = [], now } = {}) {
  void now; // injected for determinism; nothing here depends on the clock
  const pkgById = new Map((packages || []).filter((p) => p?.id).map((p) => [p.id, p]));
  const valid = (posts || []).filter((p) => p && p.id != null);

  const perf = new Map(joinPerformance({ posts: valid, packages }).map((r) => [r.id, r]));

  const posted = [];
  const pending = [];
  const failed = [];
  for (const post of valid) {
    const row = baseRow(post, pkgById);
    if (post.status === 'posted') {
      const j = perf.get(post.id);
      if (j?.metrics) {
        const { reposts, ...rest } = j.metrics;
        row.metrics = { ...rest, reposts, retweets: reposts };
        const cap = iso(j.metrics.capturedAt);
        row.metrics.capturedAt = cap;
        row.metricsNote = cap
          ? `captured ${cap}${j.ageHoursAtCapture != null ? ` (${j.ageHoursAtCapture}h after posting)` : ''}`
          : 'captured (time unknown)';
      }
      posted.push(row);
    } else if (PENDING_STATUSES.includes(post.status)) {
      pending.push(row);
    } else if (post.status === 'needs_review') {
      row.heldReason = post.errorClass ?? 'needs_review';
      pending.push(row);
    } else if (FAILED_STATUSES.includes(post.status)) {
      row.failure = {
        errorClass: post.errorClass ?? null,
        error: post.error ? clip(post.error, ERROR_MAX) : null,
        retryable: post.retryable ?? null,
      };
      failed.push(row);
    }
  }

  posted.sort(byDescPosted);
  // Held (needs_review) rows first so the list cap can never cut them off; then by scheduled time.
  pending.sort((a, b) => (Number(!!b.heldReason) - Number(!!a.heldReason)) || byScheduled(a, b));
  failed.sort((a, b) => (toMs(b.postedAt ?? b.scheduledAt) ?? -Infinity) - (toMs(a.postedAt ?? a.scheduledAt) ?? -Infinity));

  const measured = posted.filter((r) => r.metrics).length;
  const unmeasured = posted.length - measured;
  let lastMs = null;
  for (const r of posted) {
    const t = toMs(r.metrics?.capturedAt);
    if (t != null && (lastMs == null || t > lastMs)) lastMs = t;
  }

  const caveats = [
    'Views/engagement come from stored captures only; a refresh does not backfill them.',
    'Lift is likes-based and does not measure causal effect.',
  ];
  if (unmeasured >= 1) caveats.push(`${unmeasured} posted post(s) have no captured metrics yet.`);
  if (measured < MIN_N) caveats.push(`Only ${measured} posted post(s) have metrics; fewer than ${MIN_N} is too few to compare.`);

  return {
    posted: posted.slice(0, LIST_CAP),
    pending: pending.slice(0, LIST_CAP),
    failed: failed.slice(0, LIST_CAP),
    counts: {
      posted: posted.length,
      pending: pending.length,
      failed: failed.length,
      needsReview: pending.filter((r) => r.heldReason).length,
      unmeasured,
    },
    caveats,
    lastCapturedAt: lastMs == null ? null : new Date(lastMs).toISOString(),
  };
}
