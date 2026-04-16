import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { CARD_CONTRACT } = require('../../../../features/scout-intake/card-contract');
const { SOURCE_INVENTORY } = require('../../../../features/scout-intake/source-inventory');

// Admin-only data map for the scout pipeline.
// Returns: { sources, cards } — consumed by the Data Map tab.

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request) {
  try {
    await verifyAdminRequest(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  return json({
    sources: SOURCE_INVENTORY,
    cards:   CARD_CONTRACT,
  });
}
