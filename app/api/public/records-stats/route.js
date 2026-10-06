import { NextResponse } from 'next/server';
import { aggregateStats } from '../../../../features/records-page/records-helpers.js';
import { loadRecordsSource } from '../../../../features/records-page/records-data.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public, aggregate counts only. No PII, no draft text.
export async function GET() {
  try {
    const { packages, posts } = await loadRecordsSource();
    return NextResponse.json(aggregateStats(packages, posts), {
      headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    console.error('[records-stats]', err?.message || err);
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
