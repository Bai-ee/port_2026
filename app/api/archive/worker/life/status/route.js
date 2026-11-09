import { NextResponse } from 'next/server';
import { handleStatusWrite } from '../../../../../../features/life-timeline/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const out = await handleStatusWrite(request);
  return NextResponse.json(out.body, { status: out.status, headers: out.headers });
}
