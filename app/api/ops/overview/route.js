import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildOpsOverview } = require('../../../../api/_lib/ops-overview.cjs');
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
};

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
      'x-worker-secret': request.headers.get('x-worker-secret'),
    },
  };
}

export async function GET(request) {
  try {
    await verifyAdminRequest(makeReqShim(request));
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const data = await buildOpsOverview();
    return NextResponse.json(data, { headers: RESPONSE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build ops overview.' },
      { status: 500, headers: RESPONSE_HEADERS }
    );
  }
}
