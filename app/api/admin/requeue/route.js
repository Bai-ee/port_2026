import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { requeueRun } = require('../../../../api/_lib/run-lifecycle.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

export async function POST(request) {
  try {
    await verifyAdminRequest(makeReqShim(request));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Forbidden.' },
      { status: 403 }
    );
  }

  let runId;
  try {
    const body = await request.json();
    runId = body.runId || null;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!runId) {
    return NextResponse.json({ error: 'runId is required.' }, { status: 400 });
  }

  try {
    const result = await requeueRun(String(runId));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
