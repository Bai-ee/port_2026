import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { randomBytes } from 'crypto';
import { SHOWCASE_CLIENTS } from '../../../../features/showcase/clients.js';
import { getFocusFile, validateCreateInput } from '../../../../features/showcase/registry.js';
import { generateOptions, normalizeShuffle, utcDateKey, SHOWCASE_RECENT_WINDOW } from '../../../../features/showcase/options.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { requirePilotOwner } = require('../../../../api/_lib/pilot-access.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');

// Site Showcase — owner-only, on-demand render of a HITLOOP showcase video.
//
// This route only queues a `showcase_jobs/{jobId}` doc and pokes the `showcase-render` Cloud Run service
// (POST {jobId}); the service claims the doc, renders and writes the result back. It does not import media-jobs.cjs
// and never touches media_jobs / media_queue_locks. Firestore only; no rules or index changes.

const JOBS = 'showcase_jobs';
const STATE = 'showcase_state';
const ACTIVE_MAX_MS = 20 * 60 * 1000; // an active job older than this is failed "timed out"
const RETRIGGER_AFTER_MS = 20 * 1000; // a job still queued this long after its trigger is poked again
const TRIGGER_TIMEOUT_MS = 4000;
const LIST_LIMIT = 30;
const DEFAULT_MAX_PER_DAY = 6;
const JOB_ID_RE = /^sc_[a-z0-9_]{6,40}$/;

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

// verifyRequestUser -> isAdminEmail -> getEffectiveClientContext -> requirePilotOwner -> SHOWCASE_CLIENTS[clientId].
async function requireShowcaseContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  if (!(await isAdminEmail(decoded?.email))) {
    throw Object.assign(new Error('Admin access required for Site Showcase.'), { status: 403 });
  }
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  const { clientId } = requirePilotOwner(context, decoded);
  const videoClient = SHOWCASE_CLIENTS[clientId];
  if (!videoClient) {
    throw Object.assign(new Error('Site Showcase is not enabled for this client.'), { status: 403 });
  }
  return { decoded, clientId, videoClient };
}

const maxPerDay = () => {
  const n = Number.parseInt(process.env.SHOWCASE_MAX_RENDERS_PER_DAY, 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_PER_DAY;
};

const ageMs = (iso, now) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? now - t : Infinity;
};
const isActive = (job) => job?.status === 'queued' || job?.status === 'rendering';

// Fail an over-age active job inside a transaction that re-checks it is still queued/rendering, so a render that
// finished meanwhile is never overwritten. Returns the job as it stands afterwards.
async function failIfTimedOut(job, nowMs) {
  if (!isActive(job) || ageMs(job.createdAt, nowMs) <= ACTIVE_MAX_MS) return job;
  const ref = fb.adminDb.collection(JOBS).doc(job.jobId);
  const nowIso = new Date(nowMs).toISOString();
  return fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const fresh = snap.exists ? snap.data() : null;
    if (!isActive(fresh)) return fresh || job;
    const patch = { status: 'failed', error: { stage: 'render', message: 'timed out' }, updatedAt: nowIso };
    tx.set(ref, patch, { merge: true });
    return { ...fresh, ...patch };
  });
}

// Never expose createdBy (the owner's uid) to the browser.
function project(job) {
  if (!job) return null;
  const { createdBy: _createdBy, ...rest } = job;
  return rest;
}

// Await the service (it holds the request open until the render ends), abort at 4 s, swallow everything: the job doc
// is the source of truth and the status poll re-triggers a job that never got claimed.
async function triggerRender(jobId) {
  const base = String(process.env.SHOWCASE_RENDER_URL || '').replace(/\/+$/, '');
  const secret = process.env.SHOWCASE_RENDER_SECRET;
  if (!base || !secret) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-render-secret': secret },
      body: JSON.stringify({ jobId }),
      signal: controller.signal,
    });
    if (!res.ok) console.warn(`showcase render trigger returned HTTP ${res.status}`);
  } catch {
    // Aborting after 4 s is the normal path; the service keeps rendering.
  } finally {
    clearTimeout(timer);
  }
}

const newJobId = () => `sc_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

async function readRecentDone(clientId) {
  const snap = await fb.adminDb.collection(JOBS).orderBy('createdAt', 'desc').limit(LIST_LIMIT).get();
  return snap.docs
    .map((d) => d.data())
    .filter((j) => j.clientId === clientId && j.status === 'done')
    .slice(0, SHOWCASE_RECENT_WINDOW)
    .map((j) => j.focusId);
}

export async function GET(request) {
  let ctx;
  try {
    ctx = await requireShowcaseContext(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  const { clientId, videoClient } = ctx;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  try {
    if (action === 'options') {
      const now = new Date();
      const dayKey = utcDateKey(now);
      const [recentFocusIds, stateSnap] = await Promise.all([
        readRecentDone(clientId),
        fb.adminDb.collection(STATE).doc(clientId).get(),
      ]);
      const state = stateSnap.exists ? stateSnap.data() : null;
      const options = generateOptions({
        focusFile: getFocusFile(videoClient),
        videoClient,
        date: dayKey,
        shuffle: normalizeShuffle(url.searchParams.get('shuffle')),
        recentFocusIds,
      });
      return json({ options, quota: { used: state?.dayKey === dayKey ? Number(state.count) || 0 : 0, max: maxPerDay() } });
    }

    if (action === 'list') {
      const snap = await fb.adminDb.collection(JOBS).orderBy('createdAt', 'desc').limit(LIST_LIMIT).get();
      const nowMs = Date.now();
      const mine = snap.docs.map((d) => d.data()).filter((j) => j.clientId === clientId);
      const jobs = (await Promise.all(mine.map((j) => failIfTimedOut(j, nowMs)))).map(project);
      return json({ jobs });
    }

    if (action === 'status') {
      const jobId = url.searchParams.get('jobId') || '';
      if (!JOB_ID_RE.test(jobId)) return json({ error: 'Invalid jobId.' }, 400);
      const ref = fb.adminDb.collection(JOBS).doc(jobId);
      const snap = await ref.get();
      let job = snap.exists ? snap.data() : null;
      if (!job || job.clientId !== clientId) return json({ error: 'Job not found.' }, 404);
      const now = Date.now();
      if (isActive(job) && ageMs(job.createdAt, now) > ACTIVE_MAX_MS) {
        job = await failIfTimedOut(job, now);
      } else if (job.status === 'queued' && ageMs(job.triggerAt, now) > RETRIGGER_AFTER_MS) {
        const triggerAt = new Date(now).toISOString();
        await ref.set({ triggerAt, updatedAt: triggerAt }, { merge: true });
        job = { ...job, triggerAt, updatedAt: triggerAt };
        await triggerRender(jobId);
      }
      return json({ job: project(job) });
    }
  } catch (err) {
    return json({ error: err.message || 'Showcase request failed.' }, err.status || 500);
  }
  return json({ error: 'Unknown action.' }, 400);
}

export async function POST(request) {
  let ctx;
  try {
    ctx = await requireShowcaseContext(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  const { decoded, clientId, videoClient } = ctx;
  const action = new URL(request.url).searchParams.get('action');
  if (action !== 'create') return json({ error: 'Unknown action.' }, 400);

  // Before any write: without a service to call, a queued job would never run.
  if (!process.env.SHOWCASE_RENDER_URL || !process.env.SHOWCASE_RENDER_SECRET) {
    return json({ error: 'Showcase rendering is not configured.' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }
  const checked = validateCreateInput(body, videoClient);
  if (!checked.ok) return json({ error: checked.error }, 400);
  const { focusId, format, theme } = checked.value;
  const { focus } = checked;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const dayKey = utcDateKey(new Date(nowMs));
  const jobId = newJobId();
  const cap = maxPerDay();
  const db = fb.adminDb;
  const stateRef = db.collection(STATE).doc(clientId);
  const jobRef = db.collection(JOBS).doc(jobId);

  let refusal = null;
  try {
    await db.runTransaction(async (tx) => {
      refusal = null;
      const stateSnap = await tx.get(stateRef);
      const state = stateSnap.exists ? stateSnap.data() : {};
      let active = null;
      let activeRef = null;
      if (state.activeJobId) {
        activeRef = db.collection(JOBS).doc(state.activeJobId);
        const activeSnap = await tx.get(activeRef);
        active = activeSnap.exists ? activeSnap.data() : null;
      }
      if (isActive(active)) {
        if (ageMs(active.createdAt, nowMs) <= ACTIVE_MAX_MS) {
          refusal = { status: 409, error: 'A showcase render is already running.', jobId: state.activeJobId };
          return;
        }
        tx.set(activeRef, { status: 'failed', error: { stage: 'render', message: 'timed out' }, updatedAt: nowIso }, { merge: true });
      }
      const used = state.dayKey === dayKey ? Number(state.count) || 0 : 0;
      if (used >= cap) {
        refusal = { status: 429, error: 'Daily showcase render limit reached.' };
        return;
      }
      tx.set(jobRef, {
        v: 1, jobId, clientId, videoClient, focusId, format, theme,
        title: focus.title, caption: focus.caption,
        status: 'queued', createdBy: decoded.uid,
        createdAt: nowIso, updatedAt: nowIso, dayKey, triggerAt: nowIso,
      });
      tx.set(stateRef, { dayKey, count: used + 1, activeJobId: jobId });
    });
  } catch (err) {
    return json({ error: err.message || 'Could not queue the showcase render.' }, err.status || 500);
  }
  if (refusal) {
    const { status, ...rest } = refusal;
    return json(rest, status);
  }

  await triggerRender(jobId);
  return json({ jobId, status: 'queued' }, 202);
}
