import { NextResponse } from 'next/server';
import { handleMonths } from '../../../../features/life-timeline/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const out = await handleMonths(request);
  return NextResponse.json(out.body, { status: out.status, headers: out.headers });
}
