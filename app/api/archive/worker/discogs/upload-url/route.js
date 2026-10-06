import { NextResponse } from 'next/server';
import { parseUploadUrlRequest } from '../../../../../../features/discogs-ingest/draft-builder.js';
import { signedUploadUrl, workerAuthStatus } from '../../../../../../features/discogs-ingest/service.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const auth = workerAuthStatus(request);
  if (auth === 503) return NextResponse.json({ error: 'Worker token not configured' }, { status: 503 });
  if (auth !== 200) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    const { storagePath, contentType } = parseUploadUrlRequest(body);
    const uploadUrl = await signedUploadUrl({ storagePath, contentType });
    return NextResponse.json({ uploadUrl, storagePath, headers: { 'Content-Type': contentType } });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed' }, { status: err.status || 500 });
  }
}
