import { NextResponse } from 'next/server';
import { parseDraftRequest } from '../../../../../../features/discogs-ingest/draft-builder.js';
import { ingestDiscogsDraft, workerAuthStatus } from '../../../../../../features/discogs-ingest/service.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const auth = workerAuthStatus(request);
  if (auth === 503) return NextResponse.json({ error: 'Worker token not configured' }, { status: 503 });
  if (auth !== 200) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    const req = parseDraftRequest(body);
    return NextResponse.json(await ingestDiscogsDraft(req));
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed' }, { status: err.status || 500 });
  }
}
