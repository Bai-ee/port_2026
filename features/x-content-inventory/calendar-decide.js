// calendar-decide.js — Pass / Delete / Replace for every calendar row (docs/source-of-truth/CONTENT-TRACKS.md § Pass / Delete / Replace).
//   pass     "not this one": the row is taken off the calendar; the library item stays eligible later.
//   delete   same, and the library item behind it is rejected too, so no fill ever offers it again.
//   replace  pass + the next-best item for the SAME track on the SAME day (a new review draft; never approved/scheduled/posted).
// Pure: every read/write is injected, so the route, the agent and the MCP tool share one behaviour. Nothing here calls X.
//
// deps:
//   getPost(clientId, postId)                       -> post | null
//   rejectPost(clientId, postId, {by, expectedRevision}) -> post   (twitter-service rejectDraft)
//   unschedulePost(clientId, postId, {expectedRevision}) -> post   (scheduledAt cleared; no X call)
//   dismissQuoteTarget(clientId, targetId)          -> void
//   dismissSuggestion(clientId, suggestionId)       -> void
//   rejectPackage(clientId, packageId, by)          -> void
//   getPackage(clientId, packageId)                 -> pkg | null   (optional; only to find a bucket the post lacks)
//   fill(clientId, spec, {execute, batchId})        -> runDailyFill result (carries `posts`)
//   openQuoteTargets(clientId)                      -> [{id,createdAt}] open (non-dismissed) quote candidates
//   rowOf(clientId, postId)                         -> calendar row | null
//   now()                                           -> ms

const DECISIONS = ['pass', 'delete', 'replace'];
const KINDS = ['post', 'suggestion', 'requote'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const QUOTE_WINDOW_MS = 36 * 3_600_000;
// Statuses that mean the tweet went (or is going) to X: never removable from here.
const SENT_STATUSES = new Set(['posted', 'posting', 'published', 'queued', 'manual']);
// fillKind of the removed row -> what the replacement fill may draw from.
const INCLUDE_FOR = { baseline: ['baseline'], 'client-work': ['client-work'], quote: ['quotes'], narrative: ['narratives'] };

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** Quote target id a saved post came from (sourceRef from a card/fill, or the fill's own source), else null. */
const quoteTargetOf = (post) => {
  if (post?.sourceRef?.kind === 'quote-target' && post.sourceRef.id != null) return String(post.sourceRef.id);
  if (post?.fillSource?.type === 'quote-target' && post.fillSource.id != null) return String(post.fillSource.id);
  return null;
};

export async function decideCalendarItem(deps, { clientId, decision, item, by = null } = {}) {
  if (!DECISIONS.includes(decision)) throw fail(400, 'bad-decision', `decision must be one of ${DECISIONS.join(', ')}`);
  const kind = item?.kind;
  if (!KINDS.includes(kind)) throw fail(400, 'bad-kind', `item.kind must be one of ${KINDS.join(', ')}`);
  if (!clientId) throw fail(400, 'no-client', 'clientId is required');

  if (kind === 'suggestion') {
    const suggestionId = str(item.suggestionId);
    if (!suggestionId) throw fail(400, 'bad-item', 'item.suggestionId is required');
    if (decision === 'replace') throw fail(400, 'replace-unsupported', 'A daily suggestion cannot be replaced; pass it instead.');
    await deps.dismissSuggestion(clientId, suggestionId);
    return { ok: true, decision, kind, removed: { suggestionId }, replacement: null };
  }

  if (kind === 'requote') {
    const targetId = str(item.targetId);
    if (!targetId) throw fail(400, 'bad-item', 'item.targetId is required');
    await deps.dismissQuoteTarget(clientId, targetId);
    if (decision !== 'replace') return { ok: true, decision, kind, removed: { targetId }, replacement: null };
    // No draft is created: the next open candidate is already a requote row on the calendar; report which one.
    const now = deps.now();
    const next = (await deps.openQuoteTargets(clientId)).find((t) => String(t.id) !== targetId && Date.parse(t.createdAt || '') + QUOTE_WINDOW_MS > now);
    return {
      ok: true, decision, kind, removed: { targetId },
      replacement: next ? { kind: 'requote', targetId: String(next.id), date: DAY_RE.test(str(item.date)) ? str(item.date) : null } : null,
      ...(next ? {} : { note: 'no-eligible-item' }),
    };
  }

  // ---- post ------------------------------------------------------------------------------------------------------
  const postId = str(item.postId);
  if (!postId) throw fail(400, 'bad-item', 'item.postId is required');
  const post = await deps.getPost(clientId, postId);
  if (!post) throw fail(404, 'not-found', 'Post not found.');
  if (SENT_STATUSES.has(post.status)) throw fail(409, 'not-removable', `This post is ${post.status}; it already went (or is going) to X and cannot be removed here.`);

  const expectedRevision = item.expectedRevision ?? null;
  let working = post;
  if (post.status === 'scheduled') {
    working = await deps.unschedulePost(clientId, postId, { expectedRevision }); // back to approved/draft, slot released
  }
  // After an unschedule the revision moved on; the caller's check was already spent on it.
  await deps.rejectPost(clientId, postId, { by, expectedRevision: working === post ? expectedRevision : null });

  const removed = { postId };
  const targetId = quoteTargetOf(post);
  if (targetId) { await deps.dismissQuoteTarget(clientId, targetId); removed.targetId = targetId; } // else the requote reappears
  if (post.packageId) removed.packageId = post.packageId;
  if (decision === 'delete' && post.packageId) { await deps.rejectPackage(clientId, post.packageId, by); removed.packageRejected = true; }
  if (decision !== 'replace') return { ok: true, decision, kind, removed, replacement: null };

  // replace: one new review draft for the same day and track/bucket.
  const date = DAY_RE.test(str(item.date)) ? str(item.date) : (post.reviewOn || str(post.scheduledAt).slice(0, 10));
  const include = INCLUDE_FOR[post.fillKind] || (post.packageId ? ['baseline', 'client-work'] : null);
  let bucketId = post.bucketId || null;
  if (!bucketId && post.packageId && typeof deps.getPackage === 'function') bucketId = (await deps.getPackage(clientId, post.packageId))?.bucketId || null;
  if (!DAY_RE.test(date) || !include || (!bucketId && !targetId)) return { ok: true, decision, kind, removed, replacement: null, note: 'no-eligible-item' };

  const res = await deps.fill(clientId, {
    from: date, days: 1, include,
    ...(post.packageId ? { excludePackageIds: [post.packageId] } : {}),
    replace: { bucketId: bucketId || null },
  }, { execute: true, batchId: `calendar-replace-${postId}` });
  if (!res?.ok) throw fail(res?.status || 502, 'replace-failed', res?.error || 'The replacement could not be planned.');
  const made = (res.posts || []).find((p) => p.date === date);
  if (!made) return { ok: true, decision, kind, removed, replacement: null, note: 'no-eligible-item' };
  return { ok: true, decision, kind, removed, replacement: { kind: 'post', postId: made.postId, date, row: (await deps.rowOf(clientId, made.postId)) || null } };
}
