// brief-feedback.js — owner feedback and rollback on an authored Creative Brief (docs: CQ-CREATIVE-BRIEF-TEMPLATE.md).
// feedback: ONE capped model call revises the authored request (reviseHowtoRequest) -> submit it under a new id (`cb-<8>-r<rev>-f<n>`)
// -> point the draft at howto=<newId> -> replace render (renderReplace) -> version row. rollback: re-submit an old version's request
// under `...-b<n>` (no model call) -> same tail. Both are draft-only and never approve or schedule the post. Never logs prompts or model output.
import { submitHowtoRequest, getHowtoRequest } from './howto-request.js';
import { loadHowtoCatalog, catalogCheck, catalogHash } from './howto-catalog/index.js';
import { stripBrief, briefHash } from './brief.js';
import { creativeOf } from './brief-fields.js';
import { requestHash } from './howto.js';
import { authorId, reviseHowtoRequest, similarRecentWarnings, cappedLlm, authorKey, defaultLlm, FEEDBACK_MAX, AUTHOR_MODEL } from './brief-author.js';
import { listVersions, writeVersion, setVersionJob } from './brief-versions.js';
import { renderReplace, replaceBlockReason } from './worker.js';
import { takeLease, releaseLease } from './brief-lease.js';
import { HOWTO_CAMPAIGN_UNTIL, howtoEnabled } from './clients.js';

const POSTS = 'social_posts';
const fail = (status, reasons) => ({ ok: false, status, reasons: Array.isArray(reasons) ? reasons : [reasons] });
const lineOf = (id) => `howto=${id}`;

async function readPost(db, clientId, postId) {
  const snap = await db.collection(POSTS).doc(String(postId || '')).get();
  const post = snap.exists ? { id: String(postId), ...snap.data() } : null;
  return post && post.clientId === clientId ? post : null;
}

// Shared checks before any model call or write. Returns { post } or a fail().
async function loadTarget({ db, clientId, postId, expectedRevision, env }) {
  const post = await readPost(db, clientId, postId);
  if (!post) return fail(404, 'post-not-found');
  if (post.status !== 'draft') return fail(409, 'not-draft');
  if (expectedRevision != null && (post.revision || 0) !== Number(expectedRevision)) return fail(409, 'revision-conflict');
  const authored = post.videoBriefMeta?.authored;
  if (!authored?.requestId) return fail(409, 'no-authored-request');
  if (env.DAILY_BRIEF_VIDEO_ENABLED !== 'true') return fail(409, 'video-disabled');
  if (!howtoEnabled(env)) return fail(409, 'howto-disabled');
  const blocked = replaceBlockReason(post);
  if (blocked) return fail(409, blocked);
  if (String(post.reviewOn || '') > HOWTO_CAMPAIGN_UNTIL) return fail(409, 'invalid-brief:after-campaign');
  return { ok: true, post, authored };
}

// Submit the request, point the draft at it (draft-only transaction, revision must be unchanged), start the replace render, write the version.
async function applyRequest({ db, clientId, post, authored, request, kind, feedback = null, fromN = null, by, now, env, fetchImpl, model = null, catalog, campaign, warnings = [] }) {
  const iso = new Date(now).toISOString();
  const sub = await submitHowtoRequest(db, { clientId, request, by, now: () => iso, createOnly: true });
  if (!sub.ok) return fail(409, [`submit-${sub.error || sub.status}`, ...(sub.errors || [])].slice(0, 8));
  const line = lineOf(request.id);
  const reqHash = requestHash(request);
  const ref = db.collection(POSTS).doc(post.id);
  const wrote = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : null;
    if (!cur || cur.clientId !== clientId) return fail(404, 'post-not-found');
    if (cur.status !== 'draft') return fail(409, 'not-draft');
    if ((cur.revision || 0) !== (post.revision || 0)) return fail(409, 'revision-conflict');
    const patch = {
      videoBrief: line, videoBriefHash: briefHash(line), videoBriefStatus: null, videoBriefReason: null,
      videoBriefMeta: {
        ...cur.videoBriefMeta, status: 'approved', authorError: null, updatedAt: iso,
        authored: { key: authorKey(cur), requestId: request.id, requestHash: reqHash, at: iso, model: model || authored.model || AUTHOR_MODEL, catalogHash: catalogHash(catalog, campaign), feedbackOf: authored.requestId, ...(fromN != null ? { rollbackOf: Number(fromN) } : {}) },
      },
      authoring: null, revision: (cur.revision || 0) + 1, updatedAt: iso,
    };
    tx.set(ref, patch, { merge: true });
    return { ok: true, post: { ...cur, id: post.id, ...patch } };
  });
  if (!wrote.ok) return wrote;
  const version = await writeVersion(db, post.id, { requestId: request.id, requestHash: reqHash, request, feedback, kind, fromN, by, now });
  // A render that cannot start leaves the new request in place (the panel offers "Render this version"); the reason is returned.
  let render = await renderReplace({ db, clientId, postId: post.id, now, env, fetchImpl });
  if (!render.ok && render.error === 'job-exists') render = { ok: true, existing: true, status: 'queued' };
  if (render.ok && render.jobId) await setVersionJob(db, post.id, request.id, render.jobId);
  const sim = kind === 'feedback' ? await similarRecentWarnings(db, { clientId, request, postId: post.id, now }) : { warnings: [], similar: [] };
  return { ok: true, post: wrote.post, render, version, versions: await listVersions(db, post.id), warnings: [...warnings, ...sim.warnings], similar: sim.similar };
}

/** Owner feedback -> revised request -> replace render. Returns { ok:true, post, render, versions } | { ok:false, status, reasons }. */
export async function applyFeedback({ db, clientId, postId, feedback, expectedRevision = null, by = null, now = Date.now(), env = process.env, llm = defaultLlm, fetchImpl } = {}) {
  const note = String(feedback ?? '').replace(/\r\n?/g, '\n').trim();
  if (!note) return fail(400, 'feedback-empty');
  if (note.length > FEEDBACK_MAX) return fail(400, 'feedback-too-long');
  const t = await loadTarget({ db, clientId, postId, expectedRevision, env });
  if (!t.ok) return t;
  const lease = await takeLease(db, { postId, clientId, key: `feedback:${t.authored.requestId}`, now, bump: 'feedbackCount' });
  if (!lease.ok) return fail(lease.status, lease.reasons);
  const { post, authored } = { post: lease.post, authored: t.authored };
  try {
    const prev = await getHowtoRequest(db, { clientId, id: authored.requestId });
    if (!prev.ok) return fail(409, 'request-missing');
    const { catalog, campaign } = loadHowtoCatalog();
    // n comes from the counter bumped with the lease, so two feedbacks never share an id.
    const id = `${authorId(post, Number(post.videoBriefMeta?.creativeRev) || 1)}-f${lease.n}`;
    const out = await reviseHowtoRequest({ request: prev.request, feedback: note, creative: creativeOf(post), catalog, campaign, llm: cappedLlm(db, { now, env, llm }), post, id });
    if (!out.ok) return fail(409, out.reasons);
    return await applyRequest({ db, clientId, post, authored, request: out.request, kind: 'feedback', feedback: note, by, now, env, fetchImpl, model: out.model, catalog, campaign, warnings: out.warnings });
  } finally {
    await releaseLease(db, { postId, key: `feedback:${authored.requestId}` });
  }
}

/** Re-submit version `n`'s request as a new id (`...-b<n>`) and re-render. No model call. */
export async function applyRollback({ db, clientId, postId, n, expectedRevision = null, by = null, now = Date.now(), env = process.env, fetchImpl } = {}) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1) return fail(400, 'invalid-version');
  const t = await loadTarget({ db, clientId, postId, expectedRevision, env });
  if (!t.ok) return t;
  const lease = await takeLease(db, { postId, clientId, key: `rollback:${t.authored.requestId}`, now, bump: 'rollbackCount' });
  if (!lease.ok) return fail(lease.status, lease.reasons);
  const { post, authored } = { post: lease.post, authored: t.authored };
  try {
    const v = (await listVersions(db, post.id)).find((x) => x.n === num);
    if (!v?.request) return fail(404, 'version-not-found');
    const { catalog, campaign } = loadHowtoCatalog();
    // `-b<n>-<k>`: k is the rollback counter, so restoring the same version twice gets a fresh id.
    const id = `${authorId(post, Number(post.videoBriefMeta?.creativeRev) || 1)}-b${num}-${lease.n}`;
    const request = { ...v.request, id, review_on: post.reviewOn || v.request.review_on, public_copy: stripBrief(post.content) || v.request.public_copy };
    const bad = catalogCheck(request, catalog);
    if (bad.length) return fail(409, bad);
    return await applyRequest({ db, clientId, post, authored, request, kind: 'rollback', fromN: num, by, now, env, fetchImpl, catalog, campaign });
  } finally {
    await releaseLease(db, { postId, key: `rollback:${authored.requestId}` });
  }
}

export { listVersions };
