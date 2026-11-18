import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { buildTapeDeckPayload, TAPE_DECK_FETCH_LIMIT } from '../../../../features/mixtape-processing/tape-deck-records.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);

// Public Tape Deck: published mixtape reviews, whitelisted fields only.
// Read-only; failures answer 200 with an empty list so the deck shows its
// "unavailable" state and nothing about the backend leaks.
export async function GET() {
  try {
    const fb = require('../../../../api/_lib/firebase-admin.cjs');
    const snap = await fb.adminDb.collection('mixtape_reviews')
      .where('status', '==', 'published').limit(TAPE_DECK_FETCH_LIMIT).get();
    const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    return NextResponse.json(buildTapeDeckPayload(docs), {
      headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    console.error('[tape-deck]', err?.code || err?.name || 'error');
    return NextResponse.json({ reviews: [], error: 'unavailable' }, { headers: { 'cache-control': 'no-store' } });
  }
}
