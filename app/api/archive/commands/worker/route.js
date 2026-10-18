import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { handleCommandComplete, readPermanenceSettings } = require('../../../../../api/_lib/archive-permanent-archive.cjs');
const token = process.env.HITLOOP_ARCHIVE_WORKER_TOKEN;

// Paid Arweave writes. The kill switch (archive_settings/permanence.autoUpload) gates them at enqueue AND here at
// claim, so uploads queued while it was on are held (left QUEUED, not cancelled) once it is switched off.
const ARWEAVE_UPLOAD_TYPES = new Set(['UPLOAD_ASSET_ARWEAVE', 'UPLOAD_JSON']);
const TERMINAL_STATES = new Set(['COMPLETE', 'FAILED']);

function authorized(request) { return token && request.headers.get('authorization') === `Bearer ${token}`; }

// Comma-separated `types`/`excludeTypes` query params for claim
// partitioning (Phase 1 browse-lane fast path): the browse lane polls with
// types=LIST_DIRECTORY, the main lane polls with excludeTypes=LIST_DIRECTORY,
// so the two lanes never claim the same command.
function parseTypesParam(request, name) {
  const raw = request.nextUrl.searchParams.get(name);
  if (!raw) return null;
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: token ? 401 : 503 });
  const workerId = request.nextUrl.searchParams.get('workerId');
  if (!workerId) return NextResponse.json({ error: 'workerId required' }, { status: 400 });
  const types = parseTypesParam(request, 'types');
  const excludeTypes = parseTypesParam(request, 'excludeTypes');
  const filteringByType = Boolean(types || excludeTypes);

  // Type filtering is done in memory (not a Firestore `type` filter) so this
  // stays on the existing two-equality-filter query shape (workerId + state)
  // and never needs a new composite index. Widen the raw read when filtering
  // so one lane's excluded/foreign commands can't starve the other lane's
  // window into the first 10 QUEUED rows.
  const rawLimit = filteringByType ? 50 : 10;
  const snap = await fb.adminDb.collection('archive_commands').where('workerId','==',workerId).where('state','==','QUEUED').limit(rawLimit).get();
  let commands = snap.docs.map(d => ({ id:d.id, ...d.data(), createdAt:d.data().createdAt?.toDate?.().toISOString?.() || null }));
  if (types) commands = commands.filter(c => types.includes(c.type));
  if (excludeTypes) commands = commands.filter(c => !excludeTypes.includes(c.type));
  if (commands.some(c => ARWEAVE_UPLOAD_TYPES.has(c.type)) && !(await readPermanenceSettings()).autoUpload) {
    commands = commands.filter(c => !ARWEAVE_UPLOAD_TYPES.has(c.type));
  }
  commands = commands.slice(0, 10);
  return NextResponse.json({ commands }, { headers:{'cache-control':'no-store'} });
}

export async function PATCH(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: token ? 401 : 503 });
  const body = await request.json();
  const { commandId, state, jobId = null, error = null, result = null } = body || {};
  if (!commandId || !['CLAIMED','RUNNING','COMPLETE','FAILED'].includes(state)) return NextResponse.json({ error:'Invalid command update' }, {status:400});

  // Read the command before overwriting its state — handleCommandComplete
  // needs its type/workerId/refs, which the incoming PATCH body doesn't carry.
  // Transactional and terminal-idempotent: a COMPLETE/FAILED command never changes again, so a retried COMPLETE
  // PATCH cannot re-run the completion handlers (duplicate paid archive-record version, repeated high-res attach).
  const cmdRef = fb.adminDb.collection('archive_commands').doc(commandId);
  const tx = await fb.adminDb.runTransaction(async (t) => {
    const snap = await t.get(cmdRef);
    if (!snap.exists) return { missing: true };
    const data = snap.data();
    if (TERMINAL_STATES.has(data.state)) return { data, unchanged: true };
    t.set(cmdRef, { state, jobId, error, result, updatedAt: fb.FieldValue.serverTimestamp() }, { merge: true });
    return { data };
  });
  if (tx.missing) return NextResponse.json({ error: 'Unknown command' }, { status: 404 });
  if (tx.unchanged) return NextResponse.json({ ok: true, unchanged: true, state: tx.data.state });
  const cmdData = tx.data;

  // UPLOAD_ASSET_ARWEAVE COMPLETE -> archive_uploads write + versions the
  // asset's archive-record JSON. UPLOAD_JSON COMPLETE -> upserts
  // archive_records / archive_collections / archive_settings per kind, and
  // (for archive-record) re-checks whether the collection's manifest can now
  // rebuild. See api/_lib/archive-permanent-archive.cjs.
  if (state === 'COMPLETE' && cmdData) {
    try { await handleCommandComplete({ command: cmdData, result }); }
    catch (e) { console.error('[archive] handleCommandComplete failed for', commandId, e); }
  }

  // STAGE_FOR_PUBLISH COMPLETE -> record the staged storage path on the NAS
  // package (assetRefs += path, staged:{storagePath,at}). Lazy import keeps
  // the content-inventory store off every other command's path.
  if (state === 'COMPLETE' && cmdData?.type === 'STAGE_FOR_PUBLISH') {
    try {
      const [{ getPackage, upsertPackage }, { applyStageComplete }] = await Promise.all([
        import('../../../../../features/x-content-inventory/store.js'),
        import('../../../../../features/x-content-inventory/nas.js'),
      ]);
      await applyStageComplete({ getPackage, upsertPackage: (pkg) => upsertPackage(pkg, { returnPackages: false }), now: () => Date.now() }, { command: cmdData, result });
      // Posts that asked for this original (chat / post sheet "use high-res") get it now, without asking again.
      const [{ attachStagedHires, HIRES_EDITABLE_STATUSES }, { pickMedia }, { tokenUrlFor }, { getSocialPost, swapPostMedia }, telegramStore, { enqueueCreativeFollowup }] = await Promise.all([
        import('../../../../../features/x-content-inventory/hires-media.js'),
        import('../../../../../features/x-content-inventory/item-actions.js'),
        import('../../../../../features/x-content-inventory/thumbs.js'),
        import('../../../../../features/social-posting/twitter-service.js'),
        import('../../../../../features/telegram/store.js'),
        import('../../../../../features/telegram/creative.js'),
      ]);
      const out = await attachStagedHires({
        getPackage,
        upsertPackage: (pkg) => upsertPackage(pkg, { returnPackages: false }),
        getPost: (clientId, postId) => getSocialPost(clientId, postId),
        // Staged NAS files live in the HITLOOP bucket: a token URL is all that is needed (publish re-signs anyway).
        pickMedia: (pkg) => pickMedia(pkg, { hitloopUrl: (p) => tokenUrlFor(fb.adminStorage.bucket(), p), signEvLong: async () => null }),
        // Lifecycle swap: an approved/scheduled v2 row gets its approval + schedule voided (re-approve to publish).
        applyPostMedia: (postId, media, { clientId } = {}) => swapPostMedia(clientId, postId, media, { statuses: HIRES_EDITABLE_STATUSES }),
        now: () => Date.now(),
        // A Telegram "Copy + high-res" tap is waiting on this original: queue the follow-up send (binding re-checked at send time).
        onAttached: (w, { candidateId }) => enqueueCreativeFollowup({ db: fb.adminDb, store: telegramStore, now: Date.now() }, w, { candidateId }),
      }, { candidateId: cmdData.packageId });
      if (out.attached.length || out.skipped.length) console.info('[archive] high-res attach', cmdData.packageId, JSON.stringify(out));
    } catch (e) { console.error('[archive] stage write-back failed for', commandId, e); }
  }

  return NextResponse.json({ok:true});
}
