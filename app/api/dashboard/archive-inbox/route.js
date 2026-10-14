import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { ingestArchiveRecords } from '../../../../features/x-content-inventory/archive-ingest.js';
import { SERIES, PILLARS } from '../../../../features/x-content-inventory/categories.js';
import { validatePackage } from '../../../../features/x-content-inventory/schema.js';
import { archiveRecordBelongsTo } from '../../../../features/x-content-inventory/nas.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { requirePilotOwner } = require('../../../../api/_lib/pilot-access.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');

// Archive inbox — the seam between the Archive POC and the posting engine.
//
// ⚠️ BOUNDARY. The Archive owns what an artifact IS. This route READS
// `archive_review` and `archive_uploads` and never writes to either: Jev's
// answers and the human confirmations over them belong to the `/archive`
// control surface, which is the only thing that may set them (invariant 7 —
// human corrections are authoritative and kept separate from model output).
//
// What this route DOES own is the story. A story is a publishing concern, not
// an archival fact: the Archive record is meant to outlive every decision about
// how to post it. So stories live on this side, in `x_content_packages`, keyed
// by the package id derived from the asset's SHA-256.
//
// Admin-only, same reasoning as the X Monitor and X Content routes.

const REVIEW_COLLECTION = 'archive_review';
const UPLOADS_COLLECTION = 'archive_uploads';
const PACKAGES_COLLECTION = 'x_content_packages';
const MAX_RECORDS = 200;

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

// Admin + client context, mirroring quote-targets requireAdminContext: the effective client comes from
// ?as= (dashboard switcher) via getEffectiveClientContext, then the owner-pilot gate (uid + client).
async function requireAdminContext(request) {
  const decoded = await verifyRequestUser({
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  });
  if (!(await isAdminEmail(decoded?.email))) {
    const err = new Error('Admin access required for the archive inbox.');
    err.status = 403;
    throw err;
  }
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.clientId) {
    const err = new Error('No client workspace was found.');
    err.status = 404;
    throw err;
  }
  requirePilotOwner(context, decoded);
  return { decoded, clientId: context.clientId };
}

/** Confirmed archive records for `clientId`, joined to whatever is already permanent. */
async function readConfirmedRecords(clientId) {
  // Home reads by state (its legacy records carry no clientId); any other client reads only its own
  // stamped records, so home's legacy backlog can never fill a non-home client's page. Single-field
  // equality queries only (no composite index); the remaining condition is filtered in memory.
  const home = homeClientId();
  const query = clientId === home
    ? fb.adminDb.collection(REVIEW_COLLECTION).where('state', '==', 'CONFIRMED')
    : fb.adminDb.collection(REVIEW_COLLECTION).where('clientId', '==', clientId);
  const snap = await query.limit(MAX_RECORDS).get();
  if (snap.empty) return [];

  // One read for the whole upload set rather than per-asset: the join is on
  // contentAssetId and the collection is small relative to the review queue.
  let permanentByAsset = new Map();
  try {
    const uploads = await fb.adminDb.collection(UPLOADS_COLLECTION).where('kind', '==', 'original').get();
    permanentByAsset = new Map(uploads.docs.map((d) => {
      const u = d.data() || {};
      return [u.contentAssetId, { transactionId: u.transactionId ?? null, arweaveUrl: u.arweaveUrl ?? null }];
    }));
  } catch {
    // An archive with no uploads yet is a normal state, not a failure — the
    // packages simply reference the SHA-256 until a transaction exists.
  }

  // Ownership filter in memory (no composite index): a record with a clientId belongs to that client;
  // a legacy record without one belongs to the home NAS client only (NAS_INVENTORY_CLIENT_ID).
  return snap.docs
    .filter((d) => (d.data() || {}).state === 'CONFIRMED' && archiveRecordBelongsTo(d.data() || {}, clientId, home))
    .map((d) => {
      const x = d.data() || {};
      const permanent = permanentByAsset.get(d.id) || {};
      return { id: d.id, ...x, ...permanent };
    });
}

// Home NAS client: owner of LEGACY archive_review records (no clientId stamped). Unset => legacy
// records are visible to no one (fail closed). It is never a fallback for another requested client.
const homeClientId = () => process.env.NAS_INVENTORY_CLIENT_ID || null;

/** The stories this side has written for `clientId`, keyed by package id. */
async function readStoredPackages(clientId) {
  if (!clientId) return [];
  try {
    const snap = await fb.adminDb.collection(PACKAGES_COLLECTION).where('clientId', '==', clientId).limit(MAX_RECORDS * 2).get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch {
    return [];
  }
}

export async function GET(request) {
  let clientId;
  try {
    ({ clientId } = await requireAdminContext(request));
  } catch (err) {
    return json({ error: err?.message || 'Unauthorized.' }, err?.status || 401);
  }

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'inbox';
    if (action !== 'inbox') return json({ error: `Unknown action: ${action}` }, 400);

    const [records, stored] = await Promise.all([readConfirmedRecords(clientId), readStoredPackages(clientId)]);

    // `existing` is passed so a package a human has already written a story
    // into is reported as present rather than regenerated over the top of it.
    const ingest = ingestArchiveRecords({ records, existing: stored });
    const storedById = new Map(stored.map((p) => [p.id, p]));

    // Everything confirmed, merged with any story this side holds. A row the
    // ingest skipped as "already in the inventory" still belongs on screen —
    // it is the finished work, not an error.
    const rows = records.map((rec) => {
      const fresh = ingest.details.find((d) => d.provenance.sha256 === rec.sha256);
      const base = fresh?.package
        ?? storedById.get(`asset-${String(rec.sha256 ?? '').slice(0, 12)}`)
        ?? null;
      if (!base) return null;
      const held = storedById.get(base.id) || {};
      const pkg = {
        ...base,
        story: held.story ?? base.story ?? '',
        title: held.title ?? base.title ?? '',
        cta: SERIES[base.series]?.cta ?? null,
      };
      return {
        package: pkg,
        validation: validatePackage(pkg),
        seriesLabel: SERIES[pkg.series]?.label ?? null,
        pillarLabel: PILLARS[pkg.pillar] ?? null,
        // Provenance stays out of the package and on the row: the operator
        // needs to know which artifact this is without the NAS path traveling
        // into something built to be posted.
        archiveName: rec.archiveName ?? null,
        contentAssetId: rec.id ?? null,
        permanent: !!rec.transactionId,
        transactionId: rec.transactionId ?? null,
        sourcePathCount: Array.isArray(rec.sourcePaths) ? rec.sourcePaths.length : 0,
        corrections: fresh?.provenance?.corrections ?? [],
        hasStory: !!(held.story ?? base.story ?? '').trim(),
      };
    }).filter(Boolean);

    return json({
      rows,
      counts: {
        confirmed: records.length,
        packages: rows.length,
        ready: rows.filter((r) => r.validation.ok).length,
        needsStory: rows.filter((r) => !r.hasStory).length,
        rightsBlocked: rows.filter((r) => r.package.rights === 'client-approval-needed').length,
      },
      skipped: ingest.skipped,
    });
  } catch (err) {
    return json({ error: err?.message || 'Failed to read the archive inbox.' }, err?.status || 500);
  }
}

export async function POST(request) {
  let decoded;
  let clientId;
  try {
    ({ decoded, clientId } = await requireAdminContext(request));
  } catch (err) {
    return json({ error: err?.message || 'Unauthorized.' }, err?.status || 401);
  }

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';
    if (action !== 'save-story') return json({ error: `Unknown action: ${action}` }, 400);

    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) return json({ error: 'id required' }, 400);

    const story = typeof body?.story === 'string' ? body.story : '';
    const title = typeof body?.title === 'string' ? body.title : '';

    if (!clientId) return json({ error: 'No client workspace; archive stories cannot be saved.', code: 'package-client-required' }, 400);
    const ref = fb.adminDb.collection(PACKAGES_COLLECTION).doc(id);
    const prior = await ref.get();
    if (prior.exists && prior.data()?.clientId && prior.data().clientId !== clientId) {
      return json({ error: `Package ${id} belongs to another client.`, code: 'package-client-mismatch' }, 409);
    }
    // A package this client does not own yet may only be created for an archive record that belongs
    // to this client (stamped for it, or legacy and this is the home NAS client).
    if (!(prior.exists && prior.data()?.clientId === clientId)) {
      const sha = typeof body?.sha256 === 'string' ? body.sha256.trim() : '';
      if (!sha) return json({ error: 'sha256 required for a new archive story.', code: 'archive-record-required' }, 400);
      const recs = await fb.adminDb.collection(REVIEW_COLLECTION).where('sha256', '==', sha).limit(10).get();
      const home = homeClientId();
      if (!recs.docs.some((d) => archiveRecordBelongsTo(d.data() || {}, clientId, home))) {
        return json({ error: 'That archive record does not belong to this client.', code: 'archive-record-client-mismatch' }, 403);
      }
    }

    // Merge, never replace: this document may already carry fields written by
    // the ingest, and a story edit must not drop them.
    await ref.set({
      clientId,
      story,
      title,
      sha256: typeof body?.sha256 === 'string' ? body.sha256 : null,
      series: typeof body?.series === 'string' ? body.series : null,
      pillar: typeof body?.pillar === 'string' ? body.pillar : null,
      source: 'archive',
      updatedBy: decoded?.email ?? null,
      updatedAt: fb.FieldValue.serverTimestamp(),
    }, { merge: true });

    return json({ ok: true, id });
  } catch (err) {
    return json({ error: err?.message || 'Could not save the story.' }, err?.status || 500);
  }
}
