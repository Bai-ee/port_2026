import { NextResponse } from 'next/server';
import { workerAuthStatus } from '../../../../../../features/discogs-ingest/service.js';
import { getPackage, upsertPackage } from '../../../../../../features/x-content-inventory/store.js';
import { ingestNasResults } from '../../../../../../features/x-content-inventory/nas.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// NAS analyzer -> HITLOOP: upsert analyzed items as `nas-<sha16>` packages.
// Client per item: the worker may send `items[].clientId`; NAS_INVENTORY_CLIENT_ID (home) is the fallback
// ONLY for items that carry none. Neither => that item is skipped ('client-required'). Existing rows keep
// their own client; an item naming a different client is skipped ('package-client-mismatch').
export async function POST(request) {
  const auth = workerAuthStatus(request);
  if (auth === 503) return NextResponse.json({ error: 'Worker token not configured' }, { status: 503 });
  if (auth !== 200) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const out = await ingestNasResults({
      getPackage,
      upsertPackage: (pkg, opts = {}) => upsertPackage(pkg, { returnPackages: false, clientId: opts.clientId }),
      defaultClientId: process.env.NAS_INVENTORY_CLIENT_ID || null,
      now: () => Date.now(),
    }, body);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed', skipped: err.skipped }, { status: err.status || 500 });
  }
}
