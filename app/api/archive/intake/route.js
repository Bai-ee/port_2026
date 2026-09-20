import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { createIntake, markUploaded, listRecentIntake } = require('../../../../api/_lib/archive-intake.cjs');

// Lane 2 (phone upload) intake — browser/admin side. See docs/archive/INTAKE_CONTRACT.md.
// POST mints a signed PUT URL under archive-intake/{intakeId}/{safeFileName};
// PATCH confirms the object landed and flips the doc to UPLOADED; GET lists
// recent intake docs for the Quick Ingest panel's recent list.

async function auth(request) {
  try { const decoded = await verifyAdminRequest(buildAuthRequestShim(request)); return { decoded }; }
  catch (e) { return { denied: NextResponse.json({ error: e instanceof Error ? e.message : 'Forbidden.' }, { status: 403 }) }; }
}

export async function POST(request) {
  const { decoded, denied } = await auth(request);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { fileName, contentType, sizeBytes } = body || {};
  if (!fileName || !contentType) return NextResponse.json({ error: 'fileName and contentType are required' }, { status: 400 });

  try {
    const result = await createIntake({ fileName, contentType, sizeBytes, createdBy: { uid: decoded.uid, email: decoded.email || null } });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    const status = error?.status || 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Intake failed.' }, { status });
  }
}

export async function PATCH(request) {
  const { denied } = await auth(request);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { intakeId, state, sizeBytes } = body || {};
  if (state !== 'UPLOADED') return NextResponse.json({ error: 'The browser may only confirm state: UPLOADED.' }, { status: 400 });

  try {
    const result = await markUploaded({ intakeId, sizeBytes });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const status = error?.status || 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Confirm failed.' }, { status });
  }
}

export async function GET(request) {
  const { denied } = await auth(request);
  if (denied) return denied;

  const limit = request.nextUrl.searchParams.get('limit');
  const items = await listRecentIntake({ limit: limit ? Number(limit) : 20 });
  return NextResponse.json({ items }, { headers: { 'cache-control': 'no-store' } });
}
