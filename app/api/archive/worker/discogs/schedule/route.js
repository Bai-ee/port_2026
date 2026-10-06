import { NextResponse } from 'next/server';
import { discogsClientId, workerAuthStatus } from '../../../../../../features/discogs-ingest/service.js';
import { scheduleReadyRecords } from '../../../../../../features/discogs-ingest/scheduler.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Schedules story-ready Discogs drafts into the C1 slots. Never posts to X.
export async function POST(request) {
  const auth = workerAuthStatus(request);
  if (auth === 503) return NextResponse.json({ error: 'Worker token not configured' }, { status: 503 });
  if (auth !== 200) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const result = await scheduleReadyRecords({ clientId: discogsClientId(), dryRun: body?.dryRun === true });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed' }, { status: err.status || 500 });
  }
}
