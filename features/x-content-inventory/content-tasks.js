// content-tasks.js - "film this" / "find media" tasks for calendar items that have no media yet.
// Docs: content_tasks/{clientId}/tasks/{id}. One task per post (id media-<postId>), so re-proposing adds nothing.
// A task is a reminder on its dueOn day in the month calendar; it never touches a post or a library item.
//
// planMediaTasks is pure (no I/O, no clock). The store takes a Firestore-like db.

import { mediaOf } from './item-media.js';
import { addDays } from './calendar-batch.js';
import { ctDate } from './month-calendar.js';

export const MAX_MEDIA_TASKS = 50;
export const TASK_KINDS = Object.freeze(['film', 'find-media']);
export const TASK_STATUSES = Object.freeze(['open', 'done']);
export const DUE_LEAD_DAYS = 3;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TASKABLE = new Set(['draft', 'approved', 'awaiting_approval', 'scheduled']);

export const taskIdFor = (postId) => `media-${postId}`;

/** True when the library item (or the post) already has media the publisher can use or stage. */
export function itemHasMedia(pkg, post) {
  return !!(post?.mediaUrl || pkg?.mediaUrl || pkg?.mediaFrom || pkg?.nas?.sha256 || mediaOf(pkg).kind);
}

/** The calendar day a post sits on (reviewOn for an unscheduled draft, else its scheduled day), or null. */
export function postDay(post) {
  if (DAY_RE.test(String(post?.reviewOn ?? '')) && !post.scheduledAt) return post.reviewOn;
  const ms = Date.parse(post?.scheduledAt || '');
  return Number.isFinite(ms) ? ctDate(ms) : null;
}

/**
 * @param {{posts:object[], packages?:object[], existingTaskIds?:Set<string>, kind?:string, today:string, postIds?:string[], filter?:{from?:string,to?:string}, limit?:number}} input
 * @returns {{rows:object[], skipped:Record<string,number>}} row = {postId, packageId, title, kind, dueOn, reviewOn, existing}
 */
export function planMediaTasks({ posts = [], packages = [], existingTaskIds = new Set(), kind = 'film', today, postIds = null, filter = null, limit = MAX_MEDIA_TASKS } = {}) {
  const byId = new Map((packages || []).map((p) => [p.id, p]));
  const want = Array.isArray(postIds) && postIds.length ? new Set(postIds) : null;
  const skipped = {};
  const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
  const rows = [];
  for (const post of posts) {
    if (want && !want.has(post.id)) continue;
    if (!TASKABLE.has(post.status) || post.replyTo) { skip('not-on-calendar'); continue; }
    const day = postDay(post);
    if (!day) { skip('no-date'); continue; }
    if (day < today) { skip('past'); continue; }
    if (!want && filter && ((filter.from && day < filter.from) || (filter.to && day > filter.to))) continue;
    const pkg = byId.get(post.packageId) || null;
    if (itemHasMedia(pkg, post)) { skip('has-media'); continue; }
    const computed = addDays(day, -DUE_LEAD_DAYS);
    rows.push({
      postId: post.id, packageId: post.packageId || null, title: String(pkg?.title || post.title || post.content || '').replace(/\s+/g, ' ').trim().slice(0, 90) || post.id,
      kind: TASK_KINDS.includes(kind) ? kind : 'film', dueOn: computed < today ? today : computed, reviewOn: day,
      existing: existingTaskIds.has(taskIdFor(post.id)),
    });
    if (rows.length >= limit) break;
  }
  rows.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.postId.localeCompare(b.postId));
  return { rows, skipped };
}

const col = (db, clientId) => db.collection('content_tasks').doc(clientId).collection('tasks');
const clean = (id, d) => ({ id, kind: d.kind, packageId: d.packageId ?? null, postId: d.postId ?? null, dueOn: d.dueOn, title: d.title, status: d.status === 'done' ? 'done' : 'open', ...(d.doneAt ? { doneAt: d.doneAt } : {}) });

/** Firestore-backed store. create() is idempotent per task id; list() is bounded by dueOn range. */
export function createContentTaskStore(db, { clock = Date.now } = {}) {
  return {
    async create(clientId, rows, { by = 'agent', proposalId = null } = {}) {
      let created = 0;
      let existing = 0;
      const at = new Date(clock()).toISOString();
      for (const r of rows) {
        const id = taskIdFor(r.postId);
        try {
          await col(db, clientId).doc(id).create({
            kind: r.kind, packageId: r.packageId ?? null, postId: r.postId, dueOn: r.dueOn, title: r.title, status: 'open', clientId,
            createdAt: at, createdBy: by, ...(proposalId ? { proposalId } : {}),
          });
          created += 1;
        } catch (err) {
          if (err?.code === 6 || /already exists/i.test(String(err?.message))) existing += 1; else throw err;
        }
      }
      return { created, existing };
    },
    async ids(clientId) {
      const snap = await col(db, clientId).select().get();
      return new Set(snap.docs.map((d) => d.id));
    },
    async list(clientId, { from, to } = {}) {
      let q = col(db, clientId);
      if (from) q = q.where('dueOn', '>=', from);
      if (to) q = q.where('dueOn', '<=', to);
      const snap = await q.get();
      return snap.docs.map((d) => clean(d.id, d.data()));
    },
    async setStatus(clientId, taskId, status) {
      if (!TASK_STATUSES.includes(status)) throw Object.assign(new Error('status must be open or done'), { code: 'bad-request' });
      const ref = col(db, clientId).doc(String(taskId));
      const snap = await ref.get();
      if (!snap.exists) return null;
      const patch = { status, doneAt: status === 'done' ? new Date(clock()).toISOString() : null };
      await ref.set(patch, { merge: true });
      return clean(ref.id, { ...snap.data(), ...patch });
    },
  };
}
