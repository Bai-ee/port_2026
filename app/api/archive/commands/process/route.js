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
