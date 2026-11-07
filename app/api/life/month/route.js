import { NextResponse } from 'next/server';
import { handleMonth } from '../../../../features/life-timeline/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const out = await handleMonth(request);
  return NextResponse.json(out.body, { status: out.status, headers: out.headers });
}
