import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../../api/_lib/auth.cjs');
const fb = require('../../../../../api/_lib/firebase-admin.cjs');

// Command types this route can queue for a worker (see
// docs/plans/ARCHIVE-NAS-STAGING-MASTER-PLAN-2026-09-20.md §3b, W-B, and the
// Phase 2 tree-browser/multi-select extension). `type` defaults to
// PROCESS_COLLECTION so every existing caller is unaffected.
// ORGANIZE_COLLECTION additionally carries `mode`. PROCESS_SELECTION and a
// selection-scoped ORGANIZE_COLLECTION/UNDO_ORGANIZE carry `collectionId`
// (+`items` for PROCESS_SELECTION/ORGANIZE_COLLECTION) instead of a single
// `relativePath`. CANCEL_JOB (worker-side: lib/archive/daemon.ts
// executeCancelJob) stops whatever PROCESS_COLLECTION/PROCESS_SELECTION job
// is currently running for this worker, or fails a still-QUEUED one by id.
const COMMAND_TYPES = ['PROCESS_COLLECTION', 'ORGANIZE_COLLECTION', 'UNDO_ORGANIZE', 'PROCESS_SELECTION', 'CANCEL_JOB'];
const ORGANIZE_MODES = ['plan', 'apply'];
// Types whose COMPLETE `result` payload is worth handing back from the
// "recent commands" list GET — the /archive organize panel reads a plan/undo
// result either by polling its own commandId or, after a reload, by finding
// it in this list.
const ORGANIZE_RESULT_TYPES = ['ORGANIZE_COLLECTION', 'UNDO_ORGANIZE'];
const COLLECTION_ID_RE = /^[a-z0-9-]{1,64}$/;
const ITEM_KINDS = ['file', 'folder'];
const MAX_SELECTION_ITEMS = 500;

function isCleanRelativePath(p) {
  return typeof p === 'string' && !p.startsWith('/') && !p.includes('..');
}

function isValidCollectionId(id) {
  return typeof id === 'string' && COLLECTION_ID_RE.test(id);
}

// Validates a PROCESS_SELECTION / selection-scoped ORGANIZE_COLLECTION
// `items` array. Returns an error string, or null when valid.
function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return 'items must be a non-empty array';
  if (items.length > MAX_SELECTION_ITEMS) return `items must not exceed ${MAX_SELECTION_ITEMS}`;
  for (const item of items) {
    if (!item || typeof item !== 'object') return 'each item must be an object with relativePath and kind';
    if (!ITEM_KINDS.includes(item.kind)) return `each item.kind must be one of ${ITEM_KINDS.join(', ')}`;
    if (!item.relativePath || !isCleanRelativePath(item.relativePath)) {
      return 'each item.relativePath must be a non-empty path relative to the source root, with no leading / and no ..';
    }
  }
  return null;
}

export async function POST(request) {
  try { await verifyAdminRequest(buildAuthRequestShim(request)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Forbidden.' }, { status: 403 }); }

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { workerId, sourceId, type = 'PROCESS_COLLECTION' } = body || {};
  if (!workerId || !sourceId) return NextResponse.json({ error: 'workerId and sourceId are required' }, { status: 400 });
  if (!COMMAND_TYPES.includes(type)) return NextResponse.json({ error: `type must be one of ${COMMAND_TYPES.join(', ')}` }, { status: 400 });

  const id = randomUUID();
  const command = {
    id, type, workerId: String(workerId), sourceId: String(sourceId),
    state: 'QUEUED', createdAt: fb.FieldValue.serverTimestamp(), updatedAt: fb.FieldValue.serverTimestamp(),
  };

  if (type === 'CANCEL_JOB') {
    const { commandId: targetCommandId, jobId } = body || {};
    if (targetCommandId !== undefined) {
      if (typeof targetCommandId !== 'string' || !targetCommandId) return NextResponse.json({ error: 'commandId must be a non-empty string' }, { status: 400 });
      const targetDoc = await fb.adminDb.collection('archive_commands').doc(targetCommandId).get();
      if (!targetDoc.exists) return NextResponse.json({ error: 'Target command not found' }, { status: 404 });
      const targetData = targetDoc.data() || {};
      if (String(targetData.workerId) !== String(workerId)) return NextResponse.json({ error: 'Target command belongs to a different worker' }, { status: 403 });
      command.targetCommandId = targetCommandId;
    }
    if (jobId !== undefined) {
      if (typeof jobId !== 'string' || !jobId) return NextResponse.json({ error: 'jobId must be a non-empty string' }, { status: 400 });
      command.jobId = jobId;
    }
  } else if (type === 'PROCESS_SELECTION') {
    const { collectionId, items, mediaOnly } = body || {};
    if (!isValidCollectionId(collectionId)) return NextResponse.json({ error: 'collectionId is required and must match ^[a-z0-9-]{1,64}$' }, { status: 400 });
    const itemsError = validateItems(items);
    if (itemsError) return NextResponse.json({ error: itemsError }, { status: 400 });
    if (mediaOnly !== undefined && typeof mediaOnly !== 'boolean') return NextResponse.json({ error: 'mediaOnly must be a boolean' }, { status: 400 });
    command.collectionId = collectionId;
    command.items = items;
    if (mediaOnly !== undefined) command.mediaOnly = mediaOnly;
  } else if (type === 'ORGANIZE_COLLECTION') {
    const { mode, items, collectionId, relativePath } = body || {};
    if (!ORGANIZE_MODES.includes(mode)) return NextResponse.json({ error: `mode must be one of ${ORGANIZE_MODES.join(', ')}` }, { status: 400 });
    command.mode = mode;
    if (items !== undefined) {
      const itemsError = validateItems(items);
      if (itemsError) return NextResponse.json({ error: itemsError }, { status: 400 });
      if (!isValidCollectionId(collectionId)) return NextResponse.json({ error: 'collectionId is required and must match ^[a-z0-9-]{1,64}$ when items is provided' }, { status: 400 });
      command.items = items;
      command.collectionId = collectionId;
      if (relativePath !== undefined) {
        if (!isCleanRelativePath(relativePath)) return NextResponse.json({ error: 'relativePath must stay within the registered source' }, { status: 400 });
        command.relativePath = relativePath;
      }
    } else {
      const path = relativePath === undefined ? '.' : relativePath;
      if (!isCleanRelativePath(path)) return NextResponse.json({ error: 'relativePath must stay within the registered source' }, { status: 400 });
      command.relativePath = path;
    }
  } else if (type === 'UNDO_ORGANIZE') {
    const { collectionId, relativePath } = body || {};
    if (collectionId !== undefined) {
      if (!isValidCollectionId(collectionId)) return NextResponse.json({ error: 'collectionId must match ^[a-z0-9-]{1,64}$' }, { status: 400 });
      command.collectionId = collectionId;
      if (relativePath !== undefined) {
        if (!isCleanRelativePath(relativePath)) return NextResponse.json({ error: 'relativePath must stay within the registered source' }, { status: 400 });
        command.relativePath = relativePath;
      }
    } else {
      const path = relativePath === undefined ? '.' : relativePath;
      if (!isCleanRelativePath(path)) return NextResponse.json({ error: 'relativePath must stay within the registered source' }, { status: 400 });
      command.relativePath = path;
    }
  } else { // PROCESS_COLLECTION
    const { relativePath, mediaOnly } = body || {};
    const path = relativePath === undefined ? '.' : relativePath;
    if (!isCleanRelativePath(path)) return NextResponse.json({ error: 'relativePath must stay within the registered source' }, { status: 400 });
    if (mediaOnly !== undefined && typeof mediaOnly !== 'boolean') return NextResponse.json({ error: 'mediaOnly must be a boolean' }, { status: 400 });
    command.relativePath = path;
    if (mediaOnly !== undefined) command.mediaOnly = mediaOnly;
  }

  await fb.adminDb.collection('archive_commands').doc(id).set(command);
  return NextResponse.json({ ok: true, commandId: id, state: 'QUEUED' }, { status: 202 });
}

// Lives on this route file (not a new one) to stay inside the Vercel Hobby
// function-packaging cap — see docs/source-of-truth/VERCEL-HOBBY-DEPLOYMENT.md.
//
// Two GET shapes on the one route:
//  - ?commandId=  → single-command poll, mirroring /api/archive/browse's GET
//    ({id, state, result, error}). The organize PLAN/APPLY/UNDO panel queues
//    with POST above, then polls this the same way `browse()` already polls
//    LIST_DIRECTORY commands.
//  - ?workerId=   → the existing "Recent commands" strip: the last 5
//    archive_commands queued for a worker, of any type, across all states.
//    Now also carries `result` for COMPLETE ORGANIZE_COLLECTION/UNDO_ORGANIZE
//    commands, so the plan table can re-render after a page reload without
//    needing the original commandId.
export async function GET(request) {
  try { await verifyAdminRequest(buildAuthRequestShim(request)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Forbidden.' }, { status: 403 }); }

  const commandId = request.nextUrl.searchParams.get('commandId');
  if (commandId) {
    const doc = await fb.adminDb.collection('archive_commands').doc(commandId).get();
    if (!doc.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const d = doc.data() || {};
    return NextResponse.json(
      { id: doc.id, state: d.state || null, result: d.result || null, error: d.error || null },
      { headers: { 'cache-control': 'no-store, max-age=0' } },
    );
  }

  const workerId = request.nextUrl.searchParams.get('workerId');
  if (!workerId) return NextResponse.json({ error: 'workerId or commandId required' }, { status: 400 });

  // A single equality filter (no orderBy on a different field) needs no
  // composite index. Sort/trim to the last 5 in memory instead, matching the
  // full-collection-then-sort style already used by /api/archive/workers.
  const snapshot = await fb.adminDb.collection('archive_commands').where('workerId', '==', String(workerId)).get();
  const commands = snapshot.docs
    .map(doc => {
      const data = doc.data() || {};
      const updatedAt = data.updatedAt?.toDate?.().toISOString?.() || null;
      const createdAt = data.createdAt?.toDate?.().toISOString?.() || null;
      const isCompleteOrganize = data.state === 'COMPLETE' && ORGANIZE_RESULT_TYPES.includes(data.type);
      return {
        id: doc.id,
        type: data.type || null,
        state: data.state || null,
        error: data.state === 'FAILED' ? (data.error || null) : null,
        result: isCompleteOrganize ? (data.result || null) : null,
        sourceId: data.sourceId || null,
        relativePath: data.relativePath || null,
        mode: data.mode || null,
        collectionId: data.collectionId || null,
        itemCount: Array.isArray(data.items) ? data.items.length : null,
        updatedAt,
        createdAt,
        sortAt: updatedAt || createdAt,
      };
    })
    .sort((a, b) => Date.parse(b.sortAt || 0) - Date.parse(a.sortAt || 0))
    .slice(0, 5)
    .map(({ sortAt, ...rest }) => rest);

  return NextResponse.json({ commands }, { headers: { 'cache-control': 'no-store, max-age=0' } });
}
