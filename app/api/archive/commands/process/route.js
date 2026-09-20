import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../../api/_lib/auth.cjs');
const fb = require('../../../../../api/_lib/firebase-admin.cjs');

export async function POST(request) {
  try { await verifyAdminRequest(buildAuthRequestShim(request)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Forbidden.' }, { status: 403 }); }

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { workerId, sourceId, relativePath = '.' } = body || {};
  if (!workerId || !sourceId || typeof relativePath !== 'string') return NextResponse.json({ error: 'workerId, sourceId and relativePath are required' }, { status: 400 });
  if (relativePath.startsWith('/') || relativePath.includes('..')) return NextResponse.json({ error: 'relativePath must stay within the registered source' }, { status: 400 });

  const id = randomUUID();
  const command = {
    id, type: 'PROCESS_COLLECTION', workerId: String(workerId), sourceId: String(sourceId),
    relativePath, state: 'QUEUED', createdAt: fb.FieldValue.serverTimestamp(), updatedAt: fb.FieldValue.serverTimestamp(),
  };
  await fb.adminDb.collection('archive_commands').doc(id).set(command);
  return NextResponse.json({ ok: true, commandId: id, state: 'QUEUED' }, { status: 202 });
}

// Lives on this route file (not a new one) to stay inside the Vercel Hobby
// function-packaging cap — see docs/source-of-truth/VERCEL-HOBBY-DEPLOYMENT.md.
// Backs the /archive "Recent commands" strip: the last 5 archive_commands
// queued for a worker, of any type (PROCESS_COLLECTION, LIST_DIRECTORY,
// UPLOAD_ASSET_ARWEAVE), across all states.
export async function GET(request) {
  try { await verifyAdminRequest(buildAuthRequestShim(request)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Forbidden.' }, { status: 403 }); }

  const workerId = request.nextUrl.searchParams.get('workerId');
  if (!workerId) return NextResponse.json({ error: 'workerId required' }, { status: 400 });

  // A single equality filter (no orderBy on a different field) needs no
  // composite index. Sort/trim to the last 5 in memory instead, matching the
  // full-collection-then-sort style already used by /api/archive/workers.
  const snapshot = await fb.adminDb.collection('archive_commands').where('workerId', '==', String(workerId)).get();
  const commands = snapshot.docs
    .map(doc => {
      const data = doc.data() || {};
      const updatedAt = data.updatedAt?.toDate?.().toISOString?.() || null;
      const createdAt = data.createdAt?.toDate?.().toISOString?.() || null;
      return {
        id: doc.id,
        type: data.type || null,
        state: data.state || null,
        error: data.state === 'FAILED' ? (data.error || null) : null,
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
