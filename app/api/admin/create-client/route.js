import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { createWebsitelessClient } = require('../../../../api/_lib/client-provisioning.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Forbidden.' }, 403);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const companyName = String(body.companyName || '').trim();
  if (!companyName) {
    return json({ error: 'Provide a client name.' }, 400);
  }

  try {
    const result = await createWebsitelessClient({
      adminUid: decoded.uid,
      adminEmail: decoded.email || '',
      companyName,
      ideaDescription: body.ideaDescription || '',
    });
    return json({ ok: true, clientId: result.clientId, client: result.client });
  } catch (err) {
    return json({ error: err.message || 'Could not create client.' }, err.status || 500);
  }
}
