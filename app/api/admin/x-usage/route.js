import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { readXUsage, setXPricing, getXProjectUsage } from '../../../../features/x-api-usage/index.js';

// Admin-only X API spend ledger.
//   GET  ?days=30                 -> readXUsage (free: Firestore reads only)
//   POST {action:'set-pricing'}   -> owner-set rates + caps (system_flags/x_api_pricing)
//   POST {action:'project-usage'} -> REAL call to X (GET /2/usage/tweets); explicit admin click only
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');

const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

async function requireAdmin(request) {
  try { await verifyAdminRequest(buildAuthRequestShim(request)); return true; } catch { return false; }
}

export async function GET(request) {
  if (!(await requireAdmin(request))) return json({ error: 'Unauthorized.' }, 401);
  const days = Number(new URL(request.url).searchParams.get('days') || 30);
  try {
    return json({ ok: true, ...(await readXUsage({ days })) });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err).slice(0, 200) }, 500);
  }
}

export async function POST(request) {
  if (!(await requireAdmin(request))) return json({ error: 'Unauthorized.' }, 401);
  let body = {};
  try { body = await request.json(); } catch { /* empty body */ }
  try {
    if (body.action === 'set-pricing') {
      return json({ ok: true, pricing: await setXPricing(body) });
    }
    if (body.action === 'project-usage') {
      return json({ ok: true, usage: await getXProjectUsage(), callsMade: 2 });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err).slice(0, 200) }, err?.status && err.status < 600 ? err.status : 500);
  }
}
