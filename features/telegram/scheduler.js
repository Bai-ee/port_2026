// Due-time dispatch for the Telegram command center. Called by the */5 cron (worst-case notification delay about
// 5 minutes plus outbox backoff). Reads post state, enqueues deduplicated notifications, then drains the outbox.
// It NEVER writes a post: quiet hours, pauses and Telegram failures change when we notify, not when HITLOOP publishes.
import { createBot } from './bot.js';
import { checkBindingAccess } from './access.js';
import { TERMINAL_STATUSES, inQuietHours, localParts, quietHoursEnd, toMs } from './handoff.js';

const HANDOFF_STATUSES = new Set(['draft', 'approved', 'awaiting_approval', 'scheduled', 'queued', 'manual']);
const APPROVED_STATUSES = new Set(['approved', 'scheduled', 'queued']);
const UNAPPROVED = new Set(['draft', 'awaiting_approval']);
const FAILURE_STATUSES = new Set(['failed', 'needs_review', 'expired']);
const MISSED_MAX_AGE_MS = 48 * 3600000;
const FAILURE_MAX_AGE_MS = 48 * 3600000;

const rowsOf = (cal, queue) => {
  const out = new Map();
  for (const group of Object.values(queue || {})) for (const r of Array.isArray(group) ? group : []) if (r?.id) out.set(r.id, r);
  for (const day of cal?.week || []) for (const r of day.posts || []) if (r?.id && !out.has(r.id)) out.set(r.id, r);
  return [...out.values()];
};

export async function runDispatch(ctx, { now: nowIn } = {}) {
  const now = toMs(nowIn ?? (ctx.now ? ctx.now() : Date.now()));
  const c = { ...ctx, now: () => now };
  const { db, store, readModels, services, env } = c;
  const bot = ctx.bot || createBot(c);
  const accessFn = typeof ctx.access === 'function' ? ctx.access : (ctx.access?.checkBindingAccess || checkBindingAccess);
  const check = (b) => accessFn(b, env);
  const counts = { inbox: 0, handoffs: 0, briefings: 0, failures: 0, outbox: 0 };

  // (1) Inbox recovery: updates whose webhook processing died.
  for (const u of await store.listReclaimableUpdates(db, { now, limit: 20 })) {
    const claimed = await store.claimUpdate(db, u.id ?? u.updateId, { workerId: 'telegram-dispatch', now });
    if (!claimed) continue;
    try {
      await bot.handleUpdate(claimed.payload);
      await store.completeUpdate(db, claimed.id, { now });
      counts.inbox += 1;
    } catch (error) {
      await store.failUpdate(db, claimed.id, { error, now });
    }
  }

  // (2-4) Per bound client: decide what to notify about.
  for (const binding of await store.listActiveBindings(db)) {
    if (!check(binding).ok) continue;
    const { clientId } = binding;
    const settings = await store.getSettings(db, clientId);
    if (settings.notificationsPaused) continue; // pause = no notifications; posts and schedules are untouched
    const tz = settings.timezone;
    const notBefore = inQuietHours(now, tz, settings.quietHours) ? quietHoursEnd(now, tz, settings.quietHours) : undefined;
    const enq = async (dedupKey, kind, payload, revalidate = null) => {
      const r = await store.enqueueMessage(db, { clientId, chatId: binding.chatId, dedupKey, kind, payload, revalidate, notBefore, now });
      return !r.duplicate;
    };

    if (settings.briefingEnabled) {
      const local = localParts(now, tz);
      const state = await store.getState(db, clientId);
      if (local.hour >= settings.briefingHour && state.lastBriefingDate !== local.dateKey) {
        if (await enq(`briefing:${clientId}:${local.dateKey}`, 'briefing', { kind: 'briefing', dateKey: local.dateKey })) counts.briefings += 1;
        await store.patchState(db, clientId, { lastBriefingDate: local.dateKey });
      }
    }

    let rows = [];
    try {
      const [cal, brief] = await Promise.all([readModels.loadCalendar(clientId, { now }).catch(() => null), readModels.loadBriefing(clientId).catch(() => null)]);
      rows = rowsOf(cal, brief?.queue);
    } catch { rows = []; }

    const windowEnd = now + settings.leadMinutes * 60000;
    for (const row of rows) {
      const target = toMs(row.scheduledAt) ?? (row.proposed ? toMs(row.proposedAt) : null);
      const wantsHandoff = HANDOFF_STATUSES.has(row.status) && target != null && target >= now && target <= windowEnd;
      const wantsMissed = UNAPPROVED.has(row.status) && toMs(row.scheduledAt) != null && toMs(row.scheduledAt) < now && now - toMs(row.scheduledAt) <= MISSED_MAX_AGE_MS;
      const wantsFailure = settings.notifyFailures && FAILURE_STATUSES.has(row.status) && !(toMs(row.updatedAt) != null && now - toMs(row.updatedAt) > FAILURE_MAX_AGE_MS);
      if (!wantsHandoff && !wantsMissed && !wantsFailure) continue;
      const post = await services.getSocialPost(clientId, row.id); // authoritative revision/status, never the cached row
      if (!post || TERMINAL_STATUSES.has(post.status)) continue;
      const rev = post.revision ?? 0;
      const reval = { postId: post.id, revision: rev };
      if (wantsHandoff && HANDOFF_STATUSES.has(post.status)) {
        const targetAt = new Date(target).toISOString();
        const mode = APPROVED_STATUSES.has(post.status) ? 'reminder' : 'handoff';
        if (await enq(`handoff:${post.id}:${rev}:${targetAt}`, 'card', { kind: 'card', mode, targetAt, withMedia: true }, reval)) counts.handoffs += 1;
      } else if (wantsMissed && UNAPPROVED.has(post.status)) {
        const targetAt = new Date(toMs(post.scheduledAt) ?? toMs(row.scheduledAt)).toISOString();
        if (await enq(`missed:${post.id}:${rev}`, 'card', { kind: 'card', mode: 'missed', targetAt, withMedia: false }, { ...reval, mustBeUnapproved: true })) counts.handoffs += 1;
      } else if (wantsFailure && FAILURE_STATUSES.has(post.status)) {
        if (await enq(`failure:${post.id}:${rev}:${post.status}`, 'card', { kind: 'card', mode: 'failure', withMedia: false }, { ...reval, status: post.status })) counts.failures += 1;
      }
    }
  }

  // (5) Drain the outbox.
  for (const item of await store.claimOutbox(db, { now, limit: 10, workerId: 'telegram-dispatch' })) {
    const binding = await store.getActiveBindingForClient(db, item.clientId);
    if (!binding || !check(binding).ok || String(binding.chatId) !== String(item.chatId)) {
      await store.supersedeOutbox(db, item.id, { reason: 'access-revoked', now });
      continue;
    }
    const settings = await store.getSettings(db, item.clientId);
    if (settings.notificationsPaused) { await store.supersedeOutbox(db, item.id, { reason: 'notifications-paused', now }); continue; }
    if (inQuietHours(now, settings.timezone, settings.quietHours)) {
      await store.retryOutbox(db, item.id, { retryAfterSec: Math.ceil((quietHoursEnd(now, settings.timezone, settings.quietHours) - now) / 1000), error: 'quiet-hours', now });
      continue;
    }
    let post = null;
    if (item.revalidate) {
      post = await services.getSocialPost(item.clientId, item.revalidate.postId);
      const r = item.revalidate;
      const gone = !post || (post.revision ?? 0) !== (r.revision ?? 0) || TERMINAL_STATUSES.has(post.status)
        || (r.status && post.status !== r.status) || (r.mustBeUnapproved && !UNAPPROVED.has(post.status));
      if (gone) { await store.supersedeOutbox(db, item.id, { reason: 'post-changed', now }); continue; }
    }
    try {
      let messageIds = [];
      if (item.payload?.kind === 'card') {
        ({ messageIds } = await bot.sendCard(binding, post, { mode: item.payload.mode, withMedia: !!item.payload.withMedia, targetAt: item.payload.targetAt }));
      } else if (item.payload?.kind === 'briefing') {
        await bot.showHappening(binding);
      }
      await store.completeOutbox(db, item.id, { messageIds, now });
      counts.outbox += 1;
    } catch (error) {
      if (error?.code === 'rate-limited') await store.retryOutbox(db, item.id, { retryAfterSec: error.retryAfter, error, now });
      else if (error?.code === 'forbidden' || error?.code === 'bad-request') await store.failOutbox(db, item.id, { error, now });
      else await store.retryOutbox(db, item.id, { error, now });
    }
  }
  return counts;
}
