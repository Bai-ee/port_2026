// NAS Archive backend (Content Engine v2 master plan §5.3, P3).
//
// The Mac "analyzer" worker (workerId `<base>-analyzer`) reads NAS files,
// makes ONE vision call each, and posts the facets back. This module is the
// HITLOOP side: ingest results into x_content_packages, sign staging uploads,
// queue analyzer commands for the dashboard card, and write staging results
// back onto the package.
//
// All I/O is injected (`deps`) so tests run on fakes. Route files stay thin.
//   deps.db                      Firestore-compatible (archive_workers / archive_commands)
//   deps.getPackage(id)          store.getPackage
//   deps.upsertPackage(pkg)      store.upsertPackage (returnPackages:false)
//   deps.signUpload({storagePath, contentType}) -> url
//   deps.fieldValue              { serverTimestamp() }
//   deps.now() / deps.sleep(ms) / deps.randomId()

import { normalizeFacets, sanitizeEventFacets } from './facets.js';
import { PILLARS } from './categories.js';
import { needsApproval } from './schema.js';

export const ANALYZER_SUFFIX = '-analyzer';
export const ONLINE_WINDOW_MS = 90_000;
export const MAX_RESULT_ITEMS = 200;
export const MAX_PATHS = 200;
export const DEFAULT_CAP_USD = 5;
export const MAX_CAP_USD = 20;
export const NAS_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
export const NAS_PROMPT_VERSION = 'nas-facets-v1';
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
export const STAGING_PREFIX = 'publish-staging/nas';
export const NAS_JOB_TYPES = ['ANALYZE_FACETS', 'STAGE_FOR_PUBLISH', 'CANCEL_JOB'];
export const BROWSE_WAIT_MS = 6000;

const SHA_RE = /^[0-9a-f]{64}$/;
const FLYER_KINDS = new Set(['flyer', 'party-photo', 'crowd', 'performance']);
const UPLOAD_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
};
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'tif', 'tiff']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', 'mpg', 'mpeg']);
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const str = (v) => (typeof v === 'string' ? v.trim() : '');

export const nasPackageId = (sha256) => `nas-${String(sha256).slice(0, 16)}`;

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  const p = Date.parse(v);
  return Number.isFinite(p) ? p : null;
}
const toIso = (v) => { const ms = toMs(v); return ms == null ? null : new Date(ms).toISOString(); };

function cleanRelPath(p) {
  const s = String(p ?? '').trim();
  if (!s || s.startsWith('/') || s.includes('\0') || s.split(/[\\/]+/).includes('..')) return null;
  return s;
}

// ---------------------------------------------------------------- results --

function titleFrom(item) {
  const f = item.facets || {};
  const first = (k) => (Array.isArray(f[k]) ? str(f[k][0]) : '');
  const parts = [first('partyNames'), first('venues'), str(f.dateText)].filter(Boolean);
  const t = parts.join(' · ') || str(item.summary) || 'NAS archive item';
  return t.length > 90 ? `${t.slice(0, 89).trimEnd()}…` : t;
}

/** Validate one analyzer item; returns an error string or null. */
function itemError(it) {
  if (!it || typeof it !== 'object') return 'item must be an object';
  if (!SHA_RE.test(String(it.sha256 || ''))) return 'sha256 must be 64 lowercase hex chars';
  if (!cleanRelPath(it.relativePath)) return 'relativePath invalid';
  if (!it.facets || typeof it.facets !== 'object' || Array.isArray(it.facets)) return 'facets must be an object';
  return null;
}

function machineFields(it, sourceId, nowIso) {
  // Event dates: strict validation (ISO date must agree with month-day; invalid
  // values dropped). Never derived from capturedAt/file dates/folder names.
  const { eventDate: _rawEventDate, ...rawFacets } = it.facets;
  const facets = normalizeFacets({ ...rawFacets, ...sanitizeEventFacets(it.facets) });
  const isVideo = String(it.mediaType || '').toLowerCase() === 'video';
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const nas = {
    sourceId: String(sourceId), relativePath: String(it.relativePath), sha256: it.sha256,
    width: num(it.width), height: num(it.height),
    durationSec: num(it.durationSec), capturedAt: it.capturedAt ? String(it.capturedAt) : null,
  };
  const organized = str(it.organizedPath);
  if (organized) nas.organizedPath = organized;
  return {
    facets,
    summary: str(it.summary),
    activity: str(it.activity),
    peopleCount: num(it.peopleCount),
    mediaType: isVideo ? 'video' : 'image',
    format: isVideo ? 'video' : 'still',
    mediaState: isVideo ? 'video' : 'still',
    nas,
    analysis: {
      model: str(it.model) || null, promptVersion: str(it.promptVersion) || null,
      costUsd: num(it.costUsd) ?? 0, analyzedAt: nowIso,
    },
  };
}

/**
 * Upsert analyzer results as `nas-<sha16>` packages.
 * Create sets owner-facing defaults; update touches MACHINE fields only
 * (facets, summary, activity, nas, analysis, variants.x.suggestedStory) and
 * keeps title/series/pillar/story/status/approval/humanEdits/thumbRef/assetRefs.
 */
export async function ingestNasResults(deps, body) {
  const sourceId = str(body?.sourceId);
  if (!sourceId) throw bad('sourceId is required.');
  const items = body?.items;
  if (!Array.isArray(items) || !items.length) throw bad('items[] is required.');
  if (items.length > MAX_RESULT_ITEMS) throw bad(`At most ${MAX_RESULT_ITEMS} items per call.`);
  const nowIso = new Date(deps.now ? deps.now() : Date.now()).toISOString();

  let created = 0; let updated = 0;
  const skipped = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const err = itemError(it);
    if (err) { skipped.push({ index: i, error: err }); continue; }
    const id = nasPackageId(it.sha256);
    const m = machineFields(it, sourceId, nowIso);
    try {
      const existing = await deps.getPackage(id);
      let pkg;
      if (existing && existing.source?.kind === 'nas-archive') {
        pkg = {
          ...existing, ...m,
          nas: { ...m.nas, ...(!m.nas.organizedPath && existing.nas?.organizedPath ? { organizedPath: existing.nas.organizedPath } : {}) },
          variants: { ...(existing.variants || {}), x: { ...(existing.variants?.x || {}), suggestedStory: m.summary } },
        };
      } else {
        const kind = m.facets.vibe?.kind;
        const pillar = it.jev?.pillar && PILLARS[it.jev.pillar] ? it.jev.pillar : 'was-there';
        pkg = {
          id, bucketId: 'nas', engine: 'record',
          series: FLYER_KINDS.has(kind) ? 'C3' : 'C5', pillar,
          title: titleFrom(it), story: '[add your memory]', status: 'idea',
          effort: 'ready', rights: 'owned', platforms: ['x'],
          assetRefs: [], cta: null, lastPostedAt: null,
          source: { kind: 'nas-archive', externalId: it.sha256 },
          variants: { x: { suggestedStory: m.summary } },
          ...m,
        };
      }
      const r = await deps.upsertPackage(pkg);
      if (r?.created) created += 1; else updated += 1;
    } catch (e) {
      skipped.push({ index: i, error: e?.message || 'upsert failed' });
    }
  }
  if (!created && !updated) throw Object.assign(bad(`No valid items: ${skipped[0]?.error || 'none'}`), { skipped });
  return { ok: true, created, updated, ...(skipped.length ? { skipped } : {}) };
}

// ------------------------------------------------------------- upload url --

export async function nasUploadUrl(deps, body) {
  const packageId = str(body?.packageId);
  const sha256 = str(body?.sha256);
  const contentType = str(body?.contentType).toLowerCase();
  const sizeBytes = Number(body?.sizeBytes);
  if (!SHA_RE.test(sha256)) throw bad('sha256 must be 64 lowercase hex chars.');
  if (packageId !== nasPackageId(sha256)) throw bad('packageId must be nas-<first 16 hex of sha256>.');
  const ext = UPLOAD_EXT[contentType];
  if (!ext) throw bad(`contentType must be one of ${Object.keys(UPLOAD_EXT).join(', ')}.`);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) {
    throw bad(`sizeBytes must be 1..${MAX_UPLOAD_BYTES}.`);
  }
  const storagePath = `${STAGING_PREFIX}/${packageId}/${sha256.slice(0, 16)}.${ext}`;
  const uploadUrl = await deps.signUpload({ storagePath, contentType });
  return { uploadUrl, storagePath, headers: { 'Content-Type': contentType } };
}

/** PATCH hook: STAGE_FOR_PUBLISH COMPLETE -> package.assetRefs += storagePath. */
export async function applyStageComplete(deps, { command, result }) {
  if (command?.type !== 'STAGE_FOR_PUBLISH') return null;
  const packageId = str(command.packageId);
  const storagePath = str(result?.storagePath);
  if (!packageId || !storagePath) return null;
  if (!storagePath.startsWith(`${STAGING_PREFIX}/${packageId}/`) || storagePath.includes('..')) return null;
  const pkg = await deps.getPackage(packageId);
  if (!pkg) return null;
  const refs = Array.isArray(pkg.assetRefs) ? pkg.assetRefs : [];
  const at = new Date(deps.now ? deps.now() : Date.now()).toISOString();
  await deps.upsertPackage({
    ...pkg,
    assetRefs: refs.includes(storagePath) ? refs : [...refs, storagePath],
    staged: { storagePath, at },
  });
  return { packageId, storagePath };
}

// ------------------------------------------------------------ card actions --

async function findAnalyzer(db) {
  const snap = await db.collection('archive_workers').get();
  let best = null;
  for (const d of snap.docs) {
    if (!d.id.endsWith(ANALYZER_SUFFIX)) continue;
    const data = d.data() || {};
    const ms = toMs(data.lastHeartbeatAt) ?? toMs(data.workerAt);
    if (!best || (ms ?? 0) > (best.ms ?? 0)) best = { id: d.id, data, ms };
  }
  return best;
}

const isOnline = (a, nowMs) => Boolean(a && a.ms != null && nowMs - a.ms < ONLINE_WINDOW_MS);

async function baseSources(db, analyzerId) {
  const baseId = analyzerId.slice(0, -ANALYZER_SUFFIX.length);
  const snap = await db.collection('archive_workers').doc(baseId).collection('sources').get();
  return {
    baseId,
    sources: snap.docs.map((s) => {
      const d = s.data() || {};
      return { id: s.id, label: d.label || s.id, ...(d.root ? { root: d.root } : {}) };
    }),
  };
}

async function queueCommand(deps, fields) {
  const id = deps.randomId();
  await deps.db.collection('archive_commands').doc(id).set({
    id, state: 'QUEUED', ...fields,
    createdAt: deps.fieldValue.serverTimestamp(), updatedAt: deps.fieldValue.serverTimestamp(),
  });
  return id;
}

function validatePaths(paths) {
  if (!Array.isArray(paths) || !paths.length) throw bad('paths[] is required.');
  if (paths.length > MAX_PATHS) throw bad(`At most ${MAX_PATHS} paths per call.`);
  return paths.map((p) => cleanRelPath(p) || (() => { throw bad(`Invalid path: ${p}`); })());
}

async function requireAnalyzer(deps, { online }) {
  const a = await findAnalyzer(deps.db);
  if (!a) throw bad('No NAS analyzer has registered yet.', 409);
  if (online && !isOnline(a, deps.now())) throw bad('NAS analyzer is offline. Start it on the Mac and retry.', 409);
  return a;
}

async function analyzeCommand(deps, body, { dryRun, decoded }) {
  const sourceId = str(body?.sourceId);
  if (!sourceId) throw bad('sourceId is required.');
  const paths = validatePaths(body?.paths);
  const a = await requireAnalyzer(deps, { online: true });
  let capUsd = DEFAULT_CAP_USD;
  if (!dryRun && body?.capUsd !== undefined && body?.capUsd !== null) {
    capUsd = Number(body.capUsd);
    if (!Number.isFinite(capUsd) || capUsd <= 0 || capUsd > MAX_CAP_USD) throw bad(`capUsd must be > 0 and ≤ ${MAX_CAP_USD}.`);
  }
  const commandId = await queueCommand(deps, {
    type: 'ANALYZE_FACETS', workerId: a.id, sourceId, paths, capUsd,
    model: str(body?.model) || NAS_DEFAULT_MODEL,
    promptVersion: str(body?.promptVersion) || NAS_PROMPT_VERSION,
    dryRun, requestedBy: decoded?.email || null,
    // Anthropic Message Batches: half price, results arrive minutes to hours later.
    ...(body?.batch === true ? { batch: true } : {}),
  });
  return { ok: true, commandId };
}

function mediaTypeOf(name, ext) {
  const e = String(ext || String(name).split('.').pop() || '').toLowerCase().replace(/^\./, '');
  if (IMAGE_EXT.has(e)) return 'image';
  if (VIDEO_EXT.has(e)) return 'video';
  return undefined;
}

function mapEntries(path, entries) {
  return (Array.isArray(entries) ? entries : []).map((e) => {
    const name = String(e?.name ?? '');
    const dir = e?.kind === 'folder' || e?.kind === 'dir';
    const row = { name, relativePath: path === '.' || !path ? name : `${path}/${name}`, kind: dir ? 'dir' : 'file' };
    if (!dir) { const mt = mediaTypeOf(name, e?.ext); if (mt) row.mediaType = mt; }
    return row;
  });
}

async function browse(deps, body) {
  const sourceId = str(body?.sourceId);
  if (!sourceId) throw bad('sourceId is required.');
  const path = body?.path == null || body.path === '' ? '.' : (cleanRelPath(body.path) || (() => { throw bad('Invalid path.'); })());
  const a = await requireAnalyzer(deps, { online: false });
  const { baseId, sources } = await baseSources(deps.db, a.id);
  if (!sources.some((s) => s.id === sourceId)) throw bad(`Unknown source: ${sourceId}`, 404);

  let commandId = str(body?.commandId);
  if (!commandId) {
    commandId = await queueCommand(deps, { type: 'LIST_DIRECTORY', workerId: baseId, sourceId, relativePath: path });
  }
  const deadline = deps.now() + (deps.browseWaitMs ?? BROWSE_WAIT_MS);
  for (;;) {
    const snap = await deps.db.collection('archive_commands').doc(commandId).get();
    const d = snap.exists ? snap.data() : null;
    if (!d) throw bad('Browse command not found.', 404);
    if (d.state === 'COMPLETE') return { ok: true, path, entries: mapEntries(path, d.result?.entries ?? (d.result?.folders || []).map((n) => ({ name: n, kind: 'folder' }))) };
    if (d.state === 'FAILED') throw bad(d.error || 'Directory listing failed.', 502);
    if (deps.now() >= deadline) return { ok: true, path, entries: [], pending: true, commandId };
    await deps.sleep(deps.browsePollMs ?? 400);
  }
}

async function jobs(deps) {
  const a = await findAnalyzer(deps.db);
  if (!a) return { ok: true, jobs: [] };
  // Equality-only query (no composite index); sort + trim in memory. The set
  // is one command per owner click, so it stays small.
  const snap = await deps.db.collection('archive_commands').where('workerId', '==', a.id).limit(500).get();
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((c) => c.type === 'ANALYZE_FACETS' || c.type === 'STAGE_FOR_PUBLISH')
    .map((c) => ({
      id: c.id, type: c.type, state: c.state,
      paths: c.paths || (c.relativePath ? [c.relativePath] : []),
      capUsd: c.capUsd ?? null, dryRun: Boolean(c.dryRun), batch: c.batch === true,
      progress: c.result?.progress ?? null, estimate: c.result?.estimate ?? null,
      // Final tallies (progress is only a snapshot taken every few files).
      final: c.result && c.result.done != null
        ? { done: c.result.done, total: c.result.total ?? null, cached: c.result.cached ?? 0, pushed: c.result.pushed ?? 0, errorCount: c.result.errorCount ?? 0 }
        : null,
      spentUsd: c.result?.spentUsd ?? null, error: c.error || null,
      createdAt: toIso(c.createdAt), updatedAt: toIso(c.updatedAt),
    }))
    .sort((x, y) => (Date.parse(y.createdAt || 0) || 0) - (Date.parse(x.createdAt || 0) || 0))
    .slice(0, 10);
  return { ok: true, jobs: rows };
}

async function status(deps) {
  const a = await findAnalyzer(deps.db);
  if (!a) return { ok: true, online: false, workerId: null, lastSeenAt: null, localThumbBase: null, sources: [] };
  const { sources } = await baseSources(deps.db, a.id);
  return {
    ok: true, online: isOnline(a, deps.now()), workerId: a.id,
    lastSeenAt: a.ms != null ? new Date(a.ms).toISOString() : null,
    localThumbBase: a.data.localThumbBase || null, sources,
  };
}

async function cancel(deps, body) {
  const target = str(body?.commandId);
  if (!target) throw bad('commandId is required.');
  const snap = await deps.db.collection('archive_commands').doc(target).get();
  const t = snap.exists ? snap.data() : null;
  if (!t || !NAS_JOB_TYPES.includes(t.type)) throw bad('No such NAS job.', 404);
  // Contract: CANCEL_JOB {commandId} — `commandId` is the job to cancel.
  const commandId = await queueCommand(deps, { type: 'CANCEL_JOB', workerId: t.workerId, sourceId: t.sourceId || null, commandId: target });
  return { ok: true, commandId };
}

async function stage(deps, body, decoded) {
  const id = str(body?.id);
  if (!id) throw bad('id is required.');
  const pkg = await deps.getPackage(id);
  if (!pkg) throw bad(`No package ${id}.`, 404);
  const nas = pkg.nas;
  if (!nas?.sha256 || !nas?.relativePath || !nas?.sourceId) throw bad('Package is not a NAS item.');
  if (pkg.rights === 'never-public') throw bad('Rights: never-public — cannot stage.', 403);
  // The owner's click IS the approval, except where a client relationship
  // gates it (client-approval-needed stays blocked until that is cleared).
  if (pkg.rights === 'client-approval-needed' || (needsApproval(pkg) && pkg.approval?.state === 'rejected')) {
    throw bad('Package needs approval/rights clearance before staging.', 403);
  }
  const a = await requireAnalyzer(deps, { online: false });
  await deps.upsertPackage({
    ...pkg,
    approval: { state: 'approved', by: decoded?.email || 'owner', at: new Date(deps.now()).toISOString() },
  });
  const commandId = await queueCommand(deps, {
    type: 'STAGE_FOR_PUBLISH', workerId: a.id, sourceId: nas.sourceId,
    packageId: id, sha256: nas.sha256, relativePath: nas.relativePath,
  });
  return { ok: true, commandId };
}

export const NAS_ACTIONS = ['nas-status', 'nas-browse', 'nas-estimate', 'nas-process', 'nas-jobs', 'nas-cancel', 'nas-stage'];

export async function handleNasAction(deps, action, body, decoded) {
  switch (action) {
    case 'nas-status': return status(deps);
    case 'nas-browse': return browse(deps, body);
    case 'nas-estimate': return analyzeCommand(deps, body, { dryRun: true, decoded });
    case 'nas-process': return analyzeCommand(deps, body, { dryRun: false, decoded });
    case 'nas-jobs': return jobs(deps);
    case 'nas-cancel': return cancel(deps, body);
    case 'nas-stage': return stage(deps, body, decoded);
    default: throw bad(`Unknown NAS action: ${action}`);
  }
}
