import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { ingestArchiveRecords } from '../../../../features/x-content-inventory/archive-ingest.js';
import { SERIES, PILLARS } from '../../../../features/x-content-inventory/categories.js';
import { validatePackage } from '../../../../features/x-content-inventory/schema.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');
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

async function requireAdmin(request) {
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
  return decoded;
}

/** Confirmed archive records, joined to whatever is already permanent. */
async function readConfirmedRecords() {
  const snap = await fb.adminDb
    .collection(REVIEW_COLLECTION)
    .where('state', '==', 'CONFIRMED')
    .limit(MAX_RECORDS)
    .get();
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

  return snap.docs.map((d) => {
    const x = d.data() || {};
    const permanent = permanentByAsset.get(d.id) || {};
    return { id: d.id, ...x, ...permanent };
  });
}

/** The stories this side has written, keyed by package id. */
async function readStoredPackages() {
  try {
    const snap = await fb.adminDb.collection(PACKAGES_COLLECTION).limit(MAX_RECORDS * 2).get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch {
    return [];
  }
}

export async function GET(request) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return json({ error: err?.message || 'Unauthorized.' }, err?.status || 401);
  }

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'inbox';
    if (action !== 'inbox') return json({ error: `Unknown action: ${action}` }, 400);

    const [records, stored] = await Promise.all([readConfirmedRecords(), readStoredPackages()]);

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
  try {
    decoded = await requireAdmin(request);
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

    // Merge, never replace: this document may already carry fields written by
    // the ingest, and a story edit must not drop them.
    await fb.adminDb.collection(PACKAGES_COLLECTION).doc(id).set({
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
