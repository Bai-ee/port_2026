import { NextResponse } from 'next/server';
import { handleStatusRead } from '../../../../features/life-timeline/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUBLIC on purpose (no auth): the heartbeat doc holds numbers and batch labels only.
export async function GET(request) {
  const out = await handleStatusRead(request);
  return NextResponse.json(out.body, { status: out.status, headers: out.headers });
}
