// calendar-media-backfill.js — every open calendar draft that has a library item gets that item's media.
//
// OWNER RULE (2026-10-22): nothing sits on the calendar without an image or thumbnail when its item has one or can
// have one. The fill writes media only when a draft is CREATED, so drafts written before an item was staged (or before
// the fill carried media / nasSha at all) stayed bare for good. This pass runs after every daily fill and catches up:
//
//   media already on the post                        -> skip
//   item (or a same-release lender) has staged media -> attach it (+ the nasSha link when the item is a NAS file)
//   NAS item not staged yet                          -> write the nasSha link and queue the stage on the Mac; the
//                                                       stage-complete hook (hires-media attachStagedHires) attaches it
//   nothing                                          -> reported, never invented
//
// Drafts only: attaching media to an approved or scheduled v2 row would void its approval (lifecycle isMaterialEdit),
// so those are the owner's to change. Pure: all I/O is injected.

import { hasNasMediaLink } from './daily-fill.js';
import { findMediaCandidates, linkMediaPatch, SAME_RELEASE_SCORE } from './item-media.js';

export const BACKFILL_STATUSES = Object.freeze(['draft']);
/** Stages queued per run (one Mac copy each); the rest are picked up by the next fill. */
export const BACKFILL_MAX_STAGES = 10;
const DAY_MS = 86_400_000;

const dayOf = (post) => {
  const d = String(post?.reviewOn || post?.scheduledAt || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The item with a same-Discogs-release lender's media linked onto it (item-media linkMediaPatch), or null when no item
 * of the same release has usable media. Only the exact-release match lends automatically: word overlap is a suggestion
 * for the owner, not a rule.
 */
export function lendSameReleaseMedia(pkg, packages) {
  const cand = findMediaCandidates(pkg, packages, { limit: 1 })[0];
  if (!cand || cand.score < SAME_RELEASE_SCORE) return null;
  const source = (packages || []).find((p) => p?.id === cand.id);
  const link = source ? linkMediaPatch(pkg, source) : { error: 'lender missing' };
  return link.error ? null : { ...pkg, ...link.patch };
}

/**
 * deps: readDrafts(clientId) -> [{id,status,reviewOn,scheduledAt,packageId,mediaUrl,nasSha}] (open social_posts rows)
 *       readPackages(clientId) -> library items
 *       pickMedia(clientId, pkg) -> {mediaUrl,mediaType,...} | null   the item's staged media (item-actions pickMedia)
 *       applyPostMedia(clientId, postId, patch) -> bool               draft-only media/nasSha write (twitter-service swapPostMedia)
 *       upsertPackage?(clientId, pkg)                                 persists a same-release media link
 *       stageNas?(clientId, {postId, packageId}) -> {status,...}      queues the NAS copy + auto-attach (hires-media useHiresMedia)
 * @returns {{ok:true, window:{from,to}, attached:string[], staging:string[], lent:string[], bare:{postId,packageId,reason}[], failed:{postId,error}[]}}
 */
export async function backfillCalendarMedia(deps, { clientId, from, days = 7 } = {}) {
  const span = Math.max(1, Math.min(Math.floor(Number(days)) || 7, 31));
  if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(String(from))) return { ok: false, error: 'clientId and from (YYYY-MM-DD) are required' };
  const to = addDays(from, span - 1);
  const out = { ok: true, window: { from, to }, attached: [], staging: [], lent: [], bare: [], failed: [] };
  const drafts = ((await deps.readDrafts(clientId)) || []).filter((p) => {
    const day = dayOf(p);
    return BACKFILL_STATUSES.includes(p?.status) && p.packageId && !p.mediaUrl && day && day >= from && day <= to;
  });
  if (!drafts.length) return out;
  const packages = (await deps.readPackages(clientId)) || [];
  const byId = new Map(packages.filter((p) => p?.id).map((p) => [p.id, p]));
  let stages = 0;
  for (const post of drafts) {
    const pkg = byId.get(post.packageId);
    if (!pkg || (pkg.clientId && pkg.clientId !== clientId)) { out.bare.push({ postId: post.id, packageId: post.packageId, reason: 'item not found' }); continue; }
    if (pkg.rights === 'never-public') { out.bare.push({ postId: post.id, packageId: pkg.id, reason: 'never-public' }); continue; }
    try {
      const nasSha = !post.nasSha && hasNasMediaLink(pkg) ? pkg.nas.sha256 : null;
      let media = await deps.pickMedia(clientId, pkg).catch(() => null);
      if (!media) {
        const lent = lendSameReleaseMedia(pkg, packages);
        if (lent) {
          media = await deps.pickMedia(clientId, lent).catch(() => null);
          if (media) {
            if (typeof deps.upsertPackage === 'function') await deps.upsertPackage(clientId, lent).catch(() => {});
            byId.set(pkg.id, lent);
            out.lent.push(post.id);
          }
        }
      }
      if (media) {
        const ok = await deps.applyPostMedia(clientId, post.id, { ...media, ...(nasSha ? { nasSha } : {}) });
        if (ok) out.attached.push(post.id); else out.failed.push({ postId: post.id, error: 'post changed; not updated' });
        continue;
      }
      if (hasNasMediaLink(pkg)) {
        // The link alone makes the draft publishable later (nas-stage on schedule); the queued copy makes it visible now.
        if (nasSha) await deps.applyPostMedia(clientId, post.id, { nasSha });
        if (typeof deps.stageNas === 'function' && stages < BACKFILL_MAX_STAGES) {
          const r = await deps.stageNas(clientId, { postId: post.id, packageId: pkg.id });
          if (r?.status === 'done') out.attached.push(post.id);
          else {
            out.staging.push(post.id);
            if (!r?.alreadyQueued) stages += 1; // a copy already in the Mac queue is not a new one
          }
        } else {
          out.bare.push({ postId: post.id, packageId: pkg.id, reason: stages >= BACKFILL_MAX_STAGES ? 'stage limit this run' : 'not staged' });
        }
        continue;
      }
      out.bare.push({ postId: post.id, packageId: pkg.id, reason: 'item has no media' });
    } catch (err) {
      out.failed.push({ postId: post.id, error: String(err?.message || err).slice(0, 160) });
    }
  }
  return out;
}
