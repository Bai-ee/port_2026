// hires-media.js — "get the high-res original of this post's picture from the drive (NAS)".
//
// A NAS package whose file is a 720px Facebook thumbnail has bigger siblings in the same library (hires-finder.js ranks
// them). This module turns a ranked candidate into media on a post:
//   find  (read-only)  findHiresMedia: the post's package + ranked candidates, each marked staged or not.
//   use   (tier 1)     useHiresMedia: candidate not staged -> queue the existing `nas-stage` command (the Mac analyzer
//                      copies the file to publish-staging/nas/<pkg>/ and writes it onto the candidate package's
//                      assetRefs; usually under a minute). Candidate staged -> replace the post's media with it and link
//                      it onto the post's package (item-media linkMediaPatch) so later posts reuse it.
// "Staged" = the candidate package has a usable media ref (item-media mediaOf). No new storage path or schema.
// All I/O is injected so tests run on fakes.

import { findHiresCandidates, isThumbnailPath } from './hires-finder.js';
import { mediaOf, linkMediaPatch } from './item-media.js';

export const HIRES_CANDIDATE_LIMIT = 5;
export const USE_CANDIDATE_LIMIT = 20;
/** Post statuses whose media may be replaced (anything past these is posted, posting, held or manual). */
export const HIRES_EDITABLE_STATUSES = Object.freeze(['draft', 'approved', 'awaiting_approval', 'scheduled']);
const PENDING_STAGE_MS = 60 * 60 * 1000;
const DONE_STATES = new Set(['COMPLETE', 'FAILED', 'CANCELED', 'CANCELLED']);
/** The Mac worker that copies NAS files (handles STAGE_FOR_PUBLISH). Start it from its repo. */
export const NAS_WORKER_START_COMMAND = 'cd ~/Documents/Repos/assetManager && npm run archive:analyzer';

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const dims = (p) => ({ width: Number(p?.nas?.width) || null, height: Number(p?.nas?.height) || null });

async function nasWorker(deps) {
  if (typeof deps.nasStatus !== 'function') return null;
  try {
    const s = await deps.nasStatus();
    return { online: s?.online === true, lastSeenAt: s?.lastSeenAt ?? null, ...(s?.online === true ? {} : { startCommand: NAS_WORKER_START_COMMAND }) };
  } catch { return null; }
}

function resolveTarget(packages, post, packageId) {
  const id = String(post?.packageId || packageId || '').trim();
  const target = id ? (packages || []).find((p) => p.id === id) : null;
  return { id, target };
}

/**
 * Read-only. deps: { readPost(postId), readPackages(), readStageStates?(ids)->Map id->{state,commandId}, nasStatus?() }.
 * @returns {Promise<object>} { ok, postId, target, candidates:[{id,width,height,score,reasons,staged,stageState,...}], bestId, nasWorker? } or { error }
 */
export async function findHiresMedia(deps, { postId, packageId, limit = HIRES_CANDIDATE_LIMIT } = {}) {
  const post = postId ? await deps.readPost(postId) : null;
  if (postId && !post) return { error: `unknown post ${postId}` };
  const packages = (await deps.readPackages()) || [];
  const { id, target } = resolveTarget(packages, post, packageId);
  if (!id) return { error: 'this post has no library item (package), so there is no original to look for' };
  if (!target) return { error: `unknown item ${id}` };
  if (!target.nas?.relativePath) return { error: `${id} is not a NAS item, so there is no drive copy to look up` };
  const found = findHiresCandidates(target, packages, { limit: Math.max(1, Math.min(Number(limit) || HIRES_CANDIDATE_LIMIT, USE_CANDIDATE_LIMIT)) });
  const byId = new Map(packages.map((p) => [p.id, p]));
  // The item's OWN original is always an option (last, after any larger copy): a full-size item with no larger copy, or
  // a thumbnail with nothing better, must still be deliverable — "no larger copy" is not "no image".
  const selfStaged = !!mediaOf(target).kind;
  const open = [...found.candidates.filter((c) => !mediaOf(byId.get(c.id)).kind).map((c) => c.id), ...(selfStaged ? [] : [id])];
  let states = new Map();
  if (open.length && typeof deps.readStageStates === 'function') {
    try { states = (await deps.readStageStates(open)) || new Map(); } catch { states = new Map(); }
  }
  const candidates = found.candidates.map((c) => {
    const pkg = byId.get(c.id);
    const staged = !!mediaOf(pkg).kind;
    const st = states.get(c.id);
    return {
      id: c.id, title: pkg?.title ?? null, width: c.width, height: c.height, score: c.score, reasons: c.reasons,
      relativePath: c.relativePath, rights: c.rights ?? pkg?.rights ?? null, staged,
      ...(staged ? {} : { stageState: st?.state ?? 'not-staged', ...(st?.error ? { stageError: String(st.error).slice(0, 160) } : {}) }),
      thumbId: c.id, nasSha: pkg?.nas?.sha256 ?? null,
    };
  });
  const selfState = states.get(id);
  candidates.push({
    id, self: true, title: target.title ?? null, ...dims(target), score: null,
    reasons: [found.target.isThumbnail ? "this item's own file (a small copy; no larger one was found)" : "this item's own original file"],
    relativePath: target.nas?.relativePath ?? null, rights: target.rights ?? null, staged: selfStaged,
    ...(selfStaged ? {} : { stageState: selfState?.state ?? 'not-staged', ...(selfState?.error ? { stageError: String(selfState.error).slice(0, 160) } : {}) }),
    thumbId: id, nasSha: target.nas?.sha256 ?? null,
  });
  const out = {
    ok: true, postId: post?.id ?? null,
    target: { id, title: target.title ?? null, ...dims(target), isThumbnail: found.target.isThumbnail === true, hasPostMedia: !!(post?.mediaUrl) },
    candidates, bestId: found.best?.id ?? id,
    note: found.best ? 'A larger copy exists (bestId). Use it with media.use-hires.' : "No larger copy on the drive; this item's own original (bestId) can still be put on the post and linked: media.use-hires with candidateId = this item's id.",
  };
  // Worker state matters only when the copy we would use (bestId) still has to come off the drive.
  if (candidates.some((c) => c.id === out.bestId && !c.staged)) {
    const w = await nasWorker(deps);
    if (w) out.nasWorker = w;
  }
  return out;
}

/**
 * Tier 1. deps: { getPost(postId), getPackage(id), readPackages(), pendingStage?(id)->{state,commandId}|null, nasStage(id)->{commandId},
 *   nasStatus?(), pickMedia(pkg)->{mediaUrl,mediaType,mediaContentType,mediaStoragePath}|null, applyPostMedia(postId,patch,{clientId})->bool,
 *   upsertPackage(pkg), now() }.
 * Staged -> { ok, status:'done', ... }. Not staged -> { ok, status:'staging', commandId, ... }. Throws {status} on a bad request.
 */
export async function useHiresMedia(deps, { clientId, postId, candidateId, packageId, notify = null } = {}) {
  postId = String(postId || '').trim();
  candidateId = String(candidateId || '').trim();
  if (!postId || !candidateId) throw bad('postId and candidateId are required.');
  const post = await deps.getPost(postId);
  if (!post) throw bad(`No post ${postId}.`, 404);
  if (!HIRES_EDITABLE_STATUSES.includes(post.status)) throw bad(`A ${post.status} post cannot take new media (only ${HIRES_EDITABLE_STATUSES.join(', ')}).`, 409);
  if (!post.packageId) throw bad('This post has no library item to find an original for.');
  if (packageId && String(packageId) !== post.packageId) throw bad('packageId does not match the post.', 409);
  const target = await deps.getPackage(post.packageId);
  if (!target) throw bad(`No item ${post.packageId}.`, 404);
  if (clientId && target.clientId && target.clientId !== clientId) throw bad(`No item ${post.packageId}.`, 404);

  // The candidate must be one the finder offers for THIS item (same client, never-public excluded, strictly larger).
  const packages = (await deps.readPackages()) || [];
  // The item's own original (candidateId = the post's item) is always allowed; any other id must be a finder match.
  const self = candidateId === target.id;
  const offered = self ? { id: target.id, ...dims(target) } : findHiresCandidates(target, packages, { limit: USE_CANDIDATE_LIMIT }).candidates.find((c) => c.id === candidateId);
  if (!offered) throw bad(`${candidateId} is not a high-res match for ${target.id}. Call find_hires_media for the current list.`, 409);
  const cand = packages.find((p) => p.id === candidateId) || (await deps.getPackage(candidateId));
  if (!cand) throw bad(`No item ${candidateId}.`, 404);

  const staged = mediaOf(cand);
  if (!staged.kind) {
    const worker = await nasWorker(deps);
    const pending = typeof deps.pendingStage === 'function' ? await deps.pendingStage(candidateId) : null;
    const since = Date.parse(pending?.createdAt || '');
    const fresh = pending && !DONE_STATES.has(String(pending.state)) && (!Number.isFinite(since) || deps.now() - since < PENDING_STAGE_MS);
    const commandId = fresh ? pending.commandId : (await deps.nasStage(candidateId)).commandId; // nas-stage refuses never-public / client-approval-needed
    // Remember who is waiting: when the worker reports the copy COMPLETE, attachStagedHires swaps it onto this post.
    let autoAttach = false;
    try {
      const latest = (await deps.getPackage(candidateId)) || cand;
      const waiting = (Array.isArray(latest.hiresPending) ? latest.hiresPending : []).filter((w) => w && w.postId !== postId);
      await deps.upsertPackage({ ...latest, hiresPending: [...waiting, { postId, targetId: target.id, clientId: clientId || target.clientId || null, at: new Date(deps.now()).toISOString(), ...(cleanNotify(notify) ? { notify: cleanNotify(notify) } : {}) }].slice(-HIRES_PENDING_MAX) });
      autoAttach = true;
    } catch { /* the owner can still ask again once it is staged */ }
    return {
      ok: true, status: 'staging', commandId, candidateId, width: offered.width, height: offered.height, ...(fresh ? { alreadyQueued: true } : {}),
      workerOnline: worker ? worker.online : null,
      autoAttach,
      note: worker?.online === false
        ? `Queued, but the NAS worker is offline. Needs you: start it on the Mac (${NAS_WORKER_START_COMMAND}); the copy runs as soon as it is up${autoAttach ? ' and it is then put on the post automatically' : ''}.`
        : autoAttach
          ? 'The Mac worker is copying the original to staging (usually under a minute); it is put on the post automatically when the copy finishes. find_hires_media / get_post show it.'
          : 'The Mac worker is copying the original to staging; usually under a minute. Ask me to check again (find_hires_media shows staged: true when it is ready), then use it.',
      ...(worker?.online === false ? { needsYou: true, startCommand: NAS_WORKER_START_COMMAND } : {}),
    };
  }

  const media = await deps.pickMedia(cand);
  if (!media) throw bad(`Could not resolve the staged file for ${candidateId}.`, 502);
  const prev = post.mediaStoragePath || post.mediaUrl || null;
  const ok = await deps.applyPostMedia(postId, { ...media, mediaFromHires: { candidateId, packageId: target.id, at: new Date(deps.now()).toISOString() } }, { clientId });
  if (!ok) throw bad('The post changed while the media was being replaced. Try again.', 409);
  // Link onto the post's package so later posts of this item use the original (linkMediaPatch semantics).
  let linked = true;
  let linkWarning;
  if (!self) {
    const link = linkMediaPatch(target, cand, { now: deps.now() });
    if (link.error) { linked = false; linkWarning = link.error; } else {
      try { await deps.upsertPackage({ ...target, ...link.patch }); } catch (err) { linked = false; linkWarning = String(err?.message || err).slice(0, 160); }
    }
  }
  return {
    ok: true, status: 'done', postId, candidateId, packageId: target.id, width: offered.width, height: offered.height,
    mediaType: media.mediaType, mediaStoragePath: media.mediaStoragePath, downloadUrl: media.mediaUrl,
    replacedMedia: prev, linkedToItem: linked, ...(linkWarning ? { linkWarning } : {}),
  };
}

export const HIRES_PENDING_MAX = 10;

// Optional "tell this Telegram chat when the original is on the post" marker stored on a hiresPending entry.
function cleanNotify(n) {
  if (!n || n.telegramUserId == null || n.chatId == null) return null;
  return { telegramUserId: String(n.telegramUserId), chatId: String(n.chatId), bindingVersion: n.bindingVersion ?? null };
}

/**
 * Called when a STAGE_FOR_PUBLISH command completes: puts the now-staged original on every post that asked for it
 * (candidate.hiresPending, written by useHiresMedia) and links it to each post's item; clears the list.
 * A post that is no longer editable, or belongs to another client, is skipped. Never throws per post.
 * deps: { getPackage, upsertPackage, getPost(clientId, postId), pickMedia(pkg), applyPostMedia(postId, media, {clientId}), now,
 *   onAttached?(waitingEntry, {candidateId}) - best-effort hook per attached post (Telegram follow-up) }
 */
export async function attachStagedHires(deps, { candidateId }) {
  const cand = await deps.getPackage(candidateId);
  const waiting = Array.isArray(cand?.hiresPending) ? cand.hiresPending : [];
  if (!cand || !waiting.length || !mediaOf(cand).kind) return { attached: [], skipped: [] };
  const media = await deps.pickMedia(cand);
  const attached = [];
  const skipped = [];
  for (const w of waiting) {
    try {
      if (!media) { skipped.push({ postId: w.postId, reason: 'no staged media' }); continue; }
      const post = await deps.getPost(w.clientId, w.postId);
      if (!post || (w.clientId && post.clientId !== w.clientId) || !HIRES_EDITABLE_STATUSES.includes(post.status)) { skipped.push({ postId: w.postId, reason: 'post not editable' }); continue; }
      const ok = await deps.applyPostMedia(w.postId, { ...media, mediaFromHires: { candidateId, packageId: w.targetId, at: new Date(deps.now()).toISOString(), auto: true } }, { clientId: w.clientId });
      if (!ok) { skipped.push({ postId: w.postId, reason: 'post changed' }); continue; }
      const target = w.targetId && w.targetId !== candidateId ? await deps.getPackage(w.targetId) : null; // own original: nothing to link
      if (target) { const link = linkMediaPatch(target, cand, { now: deps.now() }); if (!link.error) await deps.upsertPackage({ ...target, ...link.patch }); }
      attached.push(w.postId);
      try { await deps.onAttached?.(w, { candidateId }); } catch { /* a notification failure never undoes the attach */ }
    } catch (err) {
      skipped.push({ postId: w.postId, reason: String(err?.message || err).slice(0, 120) });
    }
  }
  const latest = (await deps.getPackage(candidateId)) || cand;
  await deps.upsertPackage({ ...latest, hiresPending: [] });
  return { attached, skipped };
}

export { isThumbnailPath };

// ---------------------------------------------------------------- Firestore-backed readers (server only) --

/** Newest STAGE_FOR_PUBLISH command per package id: Map id -> {state, commandId, createdAt, error}. Single-field `in` query. */
export async function readStageStatesFromDb(db, ids) {
  const out = new Map();
  const list = [...new Set((ids || []).filter(Boolean))].slice(0, 30);
  if (!list.length) return out;
  const snap = await db.collection('archive_commands').where('packageId', 'in', list).get();
  const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v && typeof v.toDate === 'function' ? v.toDate().getTime() : Date.parse(v) || 0);
  for (const d of snap.docs) {
    const c = d.data() || {};
    if (c.type !== 'STAGE_FOR_PUBLISH') continue;
    const prev = out.get(c.packageId);
    if (!prev || ms(c.createdAt) > prev.at) out.set(c.packageId, { state: c.state || 'QUEUED', commandId: d.id, createdAt: new Date(ms(c.createdAt) || 0).toISOString(), at: ms(c.createdAt), error: c.error || null });
  }
  return out;
}

export async function pendingStageFromDb(db, id) {
  return (await readStageStatesFromDb(db, [id])).get(id) ?? null;
}
