import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: 'hit-agency',
      generatedAt: new Date().toISOString(),
    },
    {
      headers: {
        'cache-control': 'no-store',
      },
    }
  );
}
