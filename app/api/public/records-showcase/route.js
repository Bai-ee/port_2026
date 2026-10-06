import { NextResponse } from 'next/server';
import { buildShowcase } from '../../../../features/records-page/records-helpers.js';
import { loadRecordsSource } from '../../../../features/records-page/records-data.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public gallery: only posted records or packages flagged showcase: true.
export async function GET() {
  try {
    const { packages, posts } = await loadRecordsSource();
    return NextResponse.json({ items: buildShowcase(packages, posts) }, {
      headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    console.error('[records-showcase]', err?.message || err);
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
