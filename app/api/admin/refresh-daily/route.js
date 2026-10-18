import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Admin-only Daily (automatic) refresh profile — the Refresh modal's "Daily" tab.
//   GET  ?clientId=                    -> effective profile (saved, or the legacy-equivalent default)
//   POST {clientId, enabled, groups[]} -> save it (digest_config/{clientId}.refreshDaily)
// Reads/writes Firestore only; nothing here runs a refresh. See features/intelligence/_refresh-daily.js.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const refreshDaily = require('../../../../features/intelligence/_refresh-daily.js');

const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const cleanId = (v) => String(v || '').trim().slice(0, 160);

async function admin(request) {
  try { return await verifyAdminRequest(buildAuthRequestShim(request)); } catch { return null; }
}

export async function GET(request) {
  if (!(await admin(request))) return json({ error: 'Unauthorized.' }, 401);
  const clientId = cleanId(new URL(request.url).searchParams.get('clientId'));
  if (!clientId) return json({ error: 'clientId is required.' }, 400);
  try {
    return json({ ok: true, clientId, groupIds: refreshDaily.DAILY_GROUP_IDS, profile: await refreshDaily.readRefreshDaily(clientId) });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err).slice(0, 200) }, 500);
  }
}

export async function POST(request) {
  const decoded = await admin(request);
  if (!decoded) return json({ error: 'Unauthorized.' }, 401);
  let body = {};
  try { body = await request.json(); } catch { /* empty body */ }
  const clientId = cleanId(body?.clientId);
  if (!clientId) return json({ error: 'clientId is required.' }, 400);
  try {
    const profile = await refreshDaily.saveRefreshDaily(clientId, { enabled: body?.enabled, groups: body?.groups }, { by: decoded.email || decoded.uid });
    return json({ ok: true, clientId, profile });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err).slice(0, 200) }, err?.status || 500);
  }
}
