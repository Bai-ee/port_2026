import { createRequire } from 'node:module';
import {
  DAILY_BRIEF_VIDEO_CLIENTS, BRIEF_VIDEO_JOBS as JOBS, BRIEF_VIDEO_STATE as STATE,
  MAX_ATTEMPTS, MAX_RENDERS_PER_DAY, ACTIVE_MAX_MS, REPOKE_AFTER_MS, howtoEnabled, HOWTO_STATUS_WRITES_PER_TICK,
} from './clients.js';
import { parseBrief } from './brief.js';
import { selectCandidates, HOLD_RE, newJobDoc, briefJobId, addDaysIso } from './jobs.js';
import { attachJobToPost } from './attach.js';
import { howtoReadiness } from './howto.js';

const require = createRequire(import.meta.url);
const POSTS = 'social_posts';
const TRIGGER_TIMEOUT_MS = 4000;

const ctFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
export const ctToday = (ms) => ctFmt.format(new Date(ms));

const isActive = (j) => j?.status === 'queued' || j?.status === 'rendering';
// rendering: 20 min from startedAt (a queued job may legitimately wait behind a busy single-instance service);
// queued: 60 min from createdAt.
const isTimedOut = (j, now) => (j?.status === 'rendering' ? ageMs(j.startedAt || j.updatedAt || j.createdAt, now) > ACTIVE_MAX_MS
  : j?.status === 'queued' ? ageMs(j.createdAt, now) > QUEUED_MAX_MS : false);
const QUEUED_MAX_MS = 60 * 60 * 1000;
const ageMs = (iso, now) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? now - t : Infinity; };

/** POST {SHOWCASE_RENDER_URL}/render {jobId}; 4 s abort, every error swallowed (the job doc is the source of truth). */
export async function pokeService(jobId, { env = process.env, fetchImpl = fetch } = {}) {
  const base = String(env.SHOWCASE_RENDER_URL || '').replace(/\/+$/, '');
  const secret = env.SHOWCASE_RENDER_SECRET;
  if (!base || !secret) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-render-secret': secret },
      body: JSON.stringify({ jobId }),
      signal: controller.signal,
    });
    return Boolean(res?.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function readClientDrafts(db, clientId) {
  const snap = await db.collection(POSTS).where('clientId', '==', clientId).where('status', '==', 'draft').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function readClientJobs(db, clientId) {
  const snap = await db.collection(JOBS).where('clientId', '==', clientId).get();
  return snap.docs.map((d) => d.data());
}

/** Dry run: writes nothing. Every brief draft with its parsed brief + hash, plus the candidates the next tick would consider. */
export async function dryRun({ db, now = Date.now(), clients = DAILY_BRIEF_VIDEO_CLIENTS, env = process.env } = {}) {
  const today = ctToday(now);
  const flag = howtoEnabled(env);
  const out = { ok: true, dryRun: true, today, window: [today, addDaysIso(today, 7)], howtoEnabled: flag, clients: {} };
  for (const clientId of Object.keys(clients)) {
    const drafts = await readClientDrafts(db, clientId);
    const cache = new Map();
    const briefs = [];
    const ready = new Set();
    for (const post of drafts) {
      const parsed = parseBrief(post.content);
      if (!parsed) continue;
      const extra = {};
      if (HOLD_RE.test(parsed.brief)) extra.skipReason = 'hold';
      else if (parsed.briefKind === 'invalid') extra.skipReason = parsed.invalidReason;
      else if (parsed.briefKind === 'howto') {
        if (!flag) extra.skipReason = 'howto-disabled';
        else {
          const r = await howtoReadiness(db, { howtoId: parsed.howtoId, clientId, reviewOn: post.reviewOn }, cache);
          if (r.ready) ready.add(post.id);
          else if (r.state === 'waiting_howto') extra.waitingReason = r.reason;
          else extra.skipReason = r.reason;
        }
      }
      briefs.push({ postId: post.id, reviewOn: post.reviewOn || null, hasMedia: Boolean(post.mediaUrl), brief: parsed.brief, briefHash: parsed.briefHash, hook: parsed.hook, briefKind: parsed.briefKind, ...(parsed.howtoId ? { howtoId: parsed.howtoId } : {}), ...extra });
    }
    briefs.sort((a, b) => String(a.reviewOn).localeCompare(String(b.reviewOn)));
    const candidates = selectCandidates(drafts, { today, clients, includeHowto: flag })
      .filter((c) => c.parsed.briefKind === 'freetext' || (c.parsed.briefKind === 'howto' && ready.has(c.post.id)))
      .map((c) => c.post.id);
    out.clients[clientId] = { drafts: drafts.length, briefCount: briefs.length, candidates, briefs };
  }
  return out;
}

/** Visible brief status on the draft (flag on only). Draft-only transaction; writes only the two status fields, only when they change. */
async function writeBriefStatus(db, postId, { status, reason }) {
  const ref = db.collection(POSTS).doc(postId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : null;
    if (!cur || cur.status !== 'draft') return false;
    if ((cur.videoBriefStatus ?? null) === status && (cur.videoBriefReason ?? null) === reason) return false;
    tx.set(ref, { videoBriefStatus: status, videoBriefReason: reason }, { merge: true });
    return true;
  });
}

async function failTimedOut(db, job, now) {
  const ref = db.collection(JOBS).doc(job.jobId);
  const iso = new Date(now).toISOString();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const fresh = snap.exists ? snap.data() : null;
    if (!isActive(fresh) || !isTimedOut(fresh, now)) return false;
    tx.set(ref, { status: 'failed', error: { stage: 'render', message: 'timed out' }, updatedAt: iso }, { merge: true });
    return true;
  });
}

async function touchTrigger(db, jobId, now) {
  const iso = new Date(now).toISOString();
  await db.collection(JOBS).doc(jobId).set({ triggerAt: iso, updatedAt: iso }, { merge: true });
}

/** Create the job doc (idempotent id) and count it against the CT-day cap in one transaction. Returns the job or null. */
async function createJob(db, job, { now, maxPerDay }) {
  const stateRef = db.collection(STATE).doc(`briefvideo_${job.clientId}`);
  const jobRef = db.collection(JOBS).doc(job.jobId);
  const day = ctToday(now);
  return db.runTransaction(async (tx) => {
    const [stateSnap, jobSnap] = await Promise.all([tx.get(stateRef), tx.get(jobRef)]);
    if (jobSnap.exists) return null;
    const st = stateSnap.exists ? stateSnap.data() : {};
    const count = st.day === day ? Number(st.count) || 0 : 0;
    if (count >= maxPerDay) return { capped: true };
    tx.set(stateRef, { day, count: count + 1, updatedAt: new Date(now).toISOString() }, { merge: true });
    tx.set(jobRef, job);
    return { job };
  });
}

/**
 * One cron tick. At most one of each: attach a done job, fail a timed-out job, re-poke a stale queued job, start a new job.
 * `force` + `postId` (re-render) only ever targets a draft whose mediaJobId starts with 'bv_'.
 */
export async function runTick({ db, now = Date.now(), clients = DAILY_BRIEF_VIDEO_CLIENTS, env = process.env, fetchImpl, postId = null, force = false, maxPerDay = MAX_RENDERS_PER_DAY } = {}) {
  const report = { ok: true, attached: null, failed: null, repoked: null, started: null, skipped: null };
  const poke = (id) => pokeService(id, { env, fetchImpl });
  const flag = howtoEnabled(env);
  const jobsByClient = {};
  for (const clientId of Object.keys(clients)) jobsByClient[clientId] = await readClientJobs(db, clientId);
  const allJobs = Object.values(jobsByClient).flat();

  // 1. Reconcile.
  const doneUnattached = allJobs.filter((j) => j.status === 'done' && !j.attachedAt && !j.attachSkipped)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (doneUnattached[0]) {
    const j = doneUnattached[0];
    const res = await attachJobToPost(j, { db, force: j.replace === true, now: new Date(now).toISOString() });
    report.attached = { jobId: j.jobId, postId: j.postId, ...res };
  }
  const stale = allJobs.filter((j) => isActive(j) && isTimedOut(j, now))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (stale[0] && (await failTimedOut(db, stale[0], now))) { report.failed = { jobId: stale[0].jobId }; stale[0].status = 'failed'; }
  const failedId = report.failed?.jobId;
  const queuedOld = allJobs.find((j) => j.jobId !== failedId && j.status === 'queued' && ageMs(j.triggerAt || j.createdAt, now) > REPOKE_AFTER_MS && !isTimedOut(j, now));
  if (queuedOld) {
    await touchTrigger(db, queuedOld.jobId, now);
    await poke(queuedOld.jobId);
    report.repoked = { jobId: queuedOld.jobId };
  }

  // Per-client scan (memoized): candidates with their readiness/status, plus drafts that carry a status but are no longer candidates.
  const scans = new Map();
  const scanClient = async (clientId) => {
    if (scans.has(clientId)) return scans.get(clientId);
    const drafts = await readClientDrafts(db, clientId);
    const cache = new Map();
    const items = [];
    const candidateIds = new Set();
    for (const c of selectCandidates(drafts, { today: ctToday(now), clients, includeHowto: flag })) {
      candidateIds.add(c.post.id);
      const kind = c.parsed.briefKind;
      if (kind === 'invalid') { items.push({ c, ready: false, specHash: null, state: { status: 'invalid_brief', reason: c.parsed.invalidReason } }); continue; }
      if (kind === 'howto') {
        const r = await howtoReadiness(db, { howtoId: c.parsed.howtoId, clientId, reviewOn: c.post.reviewOn }, cache);
        items.push(r.ready ? { c, ready: true, specHash: r.specHash, state: { status: null, reason: null } } : { c, ready: false, specHash: null, state: { status: r.state, reason: r.reason } });
        continue;
      }
      items.push({ c, ready: true, specHash: null, state: { status: null, reason: null } });
    }
    const stale = flag ? drafts.filter((p) => !candidateIds.has(p.id) && (p.videoBriefStatus ?? null) !== null) : [];
    const scan = { items, stale };
    scans.set(clientId, scan);
    return scan;
  };
  // Status sync runs every tick (flag on), before any early return; one cap shared across all clients.
  let statusWrites = 0;
  const sync = async (post, state) => {
    if (!flag || statusWrites >= HOWTO_STATUS_WRITES_PER_TICK) return;
    if ((post.videoBriefStatus ?? null) === state.status && (post.videoBriefReason ?? null) === state.reason) return;
    if (await writeBriefStatus(db, post.id, state)) { statusWrites += 1; (report.statusWrites ||= []).push({ postId: post.id, status: state.status, reason: state.reason }); }
  };
  if (flag && !postId) {
    for (const clientId of Object.keys(clients)) {
      const { items, stale } = await scanClient(clientId);
      for (const it of items) await sync(it.c.post, it.state);
      for (const p of stale) await sync(p, { status: null, reason: null });
    }
  }

  // 2. Start one, only when nothing is active.
  if (failedId) { report.skipped = 'failed-this-tick'; return report; }
  const stillActive = allJobs.some((j) => isActive(j) && !isTimedOut(j, now));
  if (stillActive) { report.skipped = 'active-job'; return report; }

  let pick = null;
  if (postId) {
    if (!force) { report.skipped = 'postId-needs-force'; return report; }
    for (const clientId of Object.keys(clients)) {
      const snap = await db.collection(POSTS).doc(postId).get();
      const post = snap.exists ? { id: postId, ...snap.data() } : null;
      if (!post || post.clientId !== clientId) continue;
      if (post.status !== 'draft' || !String(post.mediaJobId || '').startsWith('bv_')) { report.skipped = 'force-not-eligible'; return report; }
      const parsed = parseBrief(post.content) || (post.videoBrief ? parseBrief(`INTERNAL VIDEO BRIEF: ${post.videoBrief}`) : null);
      if (!parsed) { report.skipped = 'no-brief'; return report; }
      if (parsed.briefKind !== 'freetext') { report.skipped = 'howto-force-unsupported'; return report; }
      if (HOLD_RE.test(parsed.brief)) { report.skipped = 'hold'; return report; }
      const attempts = jobsByClient[clientId].filter((j) => j.postId === post.id && j.briefHash === parsed.briefHash).map((j) => Number(j.attempt) || 1);
      pick = { post, parsed, attempt: Math.max(0, ...attempts) + 1, replace: true };
    }
    if (!pick) { report.skipped = report.skipped || 'post-not-found'; return report; }
  } else {
    for (const clientId of Object.keys(clients)) {
      const { items } = await scanClient(clientId);
      for (const it of items) {
        if (!it.ready || pick) continue; // status already synced above; keep only ready candidates for the pick
        const { c, specHash } = it;
        const mine = jobsByClient[clientId].filter((j) => j.postId === c.post.id && j.briefHash === c.parsed.briefHash && (j.specHash ?? null) === specHash);
        if (mine.some((j) => j.status !== 'failed')) continue; // queued/rendering/done already: reconcile owns it
        const attempts = mine.map((j) => Number(j.attempt) || 1);
        if (attempts.length >= MAX_ATTEMPTS) continue;
        pick = { post: c.post, parsed: c.parsed, attempt: Math.max(0, ...attempts) + 1, replace: false, specHash };
      }
      if (pick) break;
    }
    if (!pick) { report.skipped = 'no-candidate'; return report; }
  }

  const job = newJobDoc({ post: pick.post, parsed: pick.parsed, attempt: pick.attempt, now, specHash: pick.specHash });
  if (pick.replace) job.replace = true;
  const created = await createJob(db, job, { now, maxPerDay });
  if (!created) { report.skipped = 'job-exists'; return report; }
  if (created.capped) { report.skipped = 'daily-cap'; return report; }
  await poke(job.jobId);
  report.started = { jobId: job.jobId, postId: job.postId, reviewOn: job.reviewOn, attempt: job.attempt };
  return report;
}

export const defaultDb = () => require('../../api/_lib/firebase-admin.cjs').adminDb;
export { briefJobId };
