import { NextResponse } from 'next/server';
import { workerAuthStatus } from '../../../../../../features/discogs-ingest/service.js';
import { getPackage, upsertPackage } from '../../../../../../features/x-content-inventory/store.js';
import { ingestNasResults } from '../../../../../../features/x-content-inventory/nas.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// NAS analyzer -> HITLOOP: upsert analyzed items as `nas-<sha16>` packages.
export async function POST(request) {
  const auth = workerAuthStatus(request);
  if (auth === 503) return NextResponse.json({ error: 'Worker token not configured' }, { status: 503 });
  if (auth !== 200) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const out = await ingestNasResults({
      getPackage,
      upsertPackage: (pkg) => upsertPackage(pkg, { returnPackages: false }),
      now: () => Date.now(),
    }, body);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed', skipped: err.skipped }, { status: err.status || 500 });
  }
}
