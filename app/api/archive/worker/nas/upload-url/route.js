import { NextResponse } from 'next/server';
import { workerAuthStatus, signedUploadUrl } from '../../../../../../features/discogs-ingest/service.js';
import { nasUploadUrl } from '../../../../../../features/x-content-inventory/nas.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// NAS analyzer -> signed PUT URL into publish-staging/nas/<packageId>/...
export async function POST(request) {
  const auth = workerAuthStatus(request);
  if (auth === 503) return NextResponse.json({ error: 'Worker token not configured' }, { status: 503 });
  if (auth !== 200) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json(await nasUploadUrl({ signUpload: signedUploadUrl }, body));
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed' }, { status: err.status || 500 });
  }
}
