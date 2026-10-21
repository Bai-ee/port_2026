// X bookmarks store (ESM, Firestore via an injected db). Free Mac-sourced signal: scripts/x-content/bookmarks-scan.mjs
// reads the owner's bookmarks with `bird`, upserts them here, judges the new ones against the Brain, and writes the picks
// payload the dashboard reads. Nothing here touches X.
//
// Collection: x_bookmarks/{clientId}/items/{tweetId}
//   { id, url, author, authorName, text, createdAt, conversationId, isThread, media:'video'|'image'|'none',
//     likes, replies, retweets, firstSeenAt, lastSeenAt,
//     judge:    null | { fit, lane:'design'|'music'|'other', angle, respond:'quote'|'reply'|'swipe'|'skip', how, why, reject?, judgedAt, model },
//     decision: null | { kind:'quoted'|'replied'|'dismissed', at, postId? } }
// Picks payload: dashboard_state/{clientId}.marketingBrief.bookmarkPicks (replaced wholesale via mergeFields).
// Single-collection reads only (no composite index); filtering and sorting happen in memory (a few hundred rows).

export const BOOKMARKS_ROOT = 'x_bookmarks';
export const PICKS_MAX = 12;
export const PICK_TEXT_MAX = 280;
/** A quote-react needs the original to still be climbing (same 36h design window the hot scan uses). */
export const QUOTE_MAX_AGE_HOURS = 36;
export const PICK_RESPONDS = Object.freeze(['quote', 'reply', 'swipe']);
export const DECISION_KINDS = Object.freeze(['quoted', 'replied', 'dismissed']);

const itemsCol = (db, clientId) => db.collection(BOOKMARKS_ROOT).doc(String(clientId)).collection('items');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Row (without judge/decision/firstSeenAt) from one `bird bookmarks --json` tweet. null when it has no usable id/author. */
export function bookmarkFromBird(t, now = Date.now()) {
  const id = String(t?.id || '').trim();
  const author = String(t?.author?.username || '').replace(/^@/, '').trim();
  if (!/^\d+$/.test(id) || !author) return null;
  const types = (Array.isArray(t.media) ? t.media : []).map((m) => m?.type);
  const media = types.some((x) => x === 'video' || x === 'animated_gif') ? 'video' : types.length ? 'image' : 'none';
  const created = Date.parse(t.createdAt || '');
  const conversationId = String(t.conversationId || id);
  return {
    id, url: `https://x.com/${author}/status/${id}`, author, authorName: clip(t.author?.name, 80),
    text: String(t.text || '').trim(),
    createdAt: Number.isFinite(created) ? new Date(created).toISOString() : null,
    conversationId, isThread: t.isThread === true || conversationId !== id,
    media, likes: num(t.likeCount), replies: num(t.replyCount), retweets: num(t.retweetCount),
    lastSeenAt: new Date(now).toISOString(),
  };
}

/** Insert new rows, refresh counts on known ones. NEVER overwrites judge, decision or firstSeenAt. */
export async function upsertBookmarks(db, clientId, rows, now = Date.now()) {
  const col = itemsCol(db, clientId);
  const iso = new Date(now).toISOString();
  const clean = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id);
  const snaps = await Promise.all(clean.map((r) => col.doc(r.id).get()));
  const newIds = [];
  await Promise.all(clean.map((r, i) => {
    if (snaps[i].exists) return col.doc(r.id).set({ ...r, lastSeenAt: iso }, { merge: true });
    newIds.push(r.id);
    return col.doc(r.id).set({ ...r, firstSeenAt: iso, lastSeenAt: iso, judge: null, decision: null });
  }));
  return { total: clean.length, newCount: newIds.length, newIds };
}

/** Newest bookmark first. onlyUnjudged = judge null; onlyOpen = no decision yet. */
export async function listBookmarks(db, clientId, { limit = 200, onlyUnjudged = false, onlyOpen = false } = {}) {
  const snap = await itemsCol(db, clientId).get();
  let items = snap.docs.map((d) => d.data()).filter((x) => x && x.id);
  if (onlyUnjudged) items = items.filter((x) => !x.judge);
  if (onlyOpen) items = items.filter((x) => !x.decision);
  items.sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '') || String(b.id).localeCompare(String(a.id)));
  return items.slice(0, Math.max(1, Math.min(Number(limit) || 200, 500)));
}

export async function getBookmark(db, clientId, id) {
  if (!id || String(id).includes('/')) return null;
  const snap = await itemsCol(db, clientId).doc(String(id)).get();
  return snap.exists ? snap.data() : null;
}

export async function setJudge(db, clientId, id, judge) {
  await itemsCol(db, clientId).doc(String(id)).set({ judge }, { merge: true });
}

/** Record the owner's decision. Throws a 404 error when the bookmark is unknown. */
export async function setDecision(db, clientId, id, { kind, postId = null, now = Date.now() }) {
  if (!DECISION_KINDS.includes(kind)) throw Object.assign(new Error(`decision kind must be one of ${DECISION_KINDS.join(', ')}.`), { status: 400 });
  const ref = itemsCol(db, clientId).doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error('Bookmark not found.'), { status: 404 });
  const decision = { kind, at: new Date(now).toISOString(), ...(postId ? { postId: String(postId) } : {}) };
  await ref.set({ decision }, { merge: true });
  return decision;
}

export const ageHoursOf = (item, now) => {
  const t = Date.parse(item?.createdAt || '');
  return Number.isFinite(t) ? Math.max(0, Math.round(((now - t) / 3_600_000) * 10) / 10) : null;
};

/** What to do with a judged item NOW: a quote whose original is past the window becomes a swipe. */
export function effectiveRespond(item, now) {
  const r = item?.judge?.respond;
  if (r === 'quote') {
    const age = ageHoursOf(item, now);
    return age !== null && age > QUOTE_MAX_AGE_HOURS ? 'swipe' : 'quote';
  }
  return r || 'skip';
}

export function toBookmarkPick(item, now) {
  const j = item.judge || {};
  return {
    id: item.id, url: item.url, author: item.author, text: clip(item.text, PICK_TEXT_MAX), media: item.media || 'none',
    likes: num(item.likes), ageHours: ageHoursOf(item, now), lane: j.lane || 'other', angle: j.angle || 'none',
    respond: effectiveRespond(item, now), how: j.how || '', why: j.why || '', fit: j.fit ?? 0,
  };
}

/** Up to PICKS_MAX open, judged items worth acting on, best fit first. */
export function selectBookmarkPicks(items, now, { limit = PICKS_MAX } = {}) {
  return (items || [])
    .filter((x) => x.judge && !x.decision && PICK_RESPONDS.includes(x.judge.respond))
    .sort((a, b) => (b.judge.fit ?? 0) - (a.judge.fit ?? 0) || Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))
    .slice(0, limit)
    .map((x) => toBookmarkPick(x, now));
}

export function buildBookmarkPicksPayload({ items, now = Date.now(), newThisRun = 0, judged = 0, costUsd = 0, notes = [] }) {
  return {
    scannedAt: new Date(now).toISOString(), total: (items || []).length, newThisRun, judged,
    costUsd: Math.round(costUsd * 1e5) / 1e5,
    picks: selectBookmarkPicks(items, now), notes: (notes || []).slice(0, 10),
  };
}

export async function readBookmarkPicks(db, clientId) {
  const snap = await db.collection('dashboard_state').doc(String(clientId)).get();
  return snap.exists ? snap.data()?.marketingBrief?.bookmarkPicks || null : null;
}

export async function writeBookmarkPicks(db, clientId, payload) {
  await db.collection('dashboard_state').doc(String(clientId)).set(
    { marketingBrief: { bookmarkPicks: payload } }, { mergeFields: ['marketingBrief.bookmarkPicks'] });
}
