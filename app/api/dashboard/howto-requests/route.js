import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { renderNow } from '../../../../features/brief-video/worker.js';
import { submitHowtoRequest, getHowtoRequest } from '../../../../features/brief-video/howto-request.js';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CQ-HowTo request intake for the agent action catalog (video.howto.request.*). Tier 1: Firestore only, no spend.
// Writes howto_requests/{id} while status === 'submitted' (or auto-approved v3.2); the owner script approves older requests.
// action 'render-now' starts the render of one draft immediately (capped, same job + service trigger as the cron). Logic: features/brief-video/howto-request.js.

const shim = (request) => ({ headers: { authorization: request.headers.get('authorization'), Authorization: request.headers.get('authorization') } });
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

async function resolve(request) {
  const decoded = await verifyRequestUser(shim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.clientId) { const e = new Error('No clientId on user record.'); e.status = 404; throw e; }
  return { decoded, context };
}

const reply = (out) => json(out, out.status && !out.ok ? out.status : 200);

export async function POST(request) {
  let r;
  try { r = await resolve(request); } catch (err) { return json({ error: err.message || 'Unauthorized.' }, err.status || 401); }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  if (body?.action === 'render-now') {
    const out = await renderNow({ db: fb.adminDb, clientId: r.context.clientId, postId: body.postId, narration: body.narration });
    return reply(out.ok ? { ...out, clientId: r.context.clientId } : { ...out, error: out.error });
  }
  if (body?.action !== 'submit') return json({ error: 'Unknown action.' }, 400);
  const out = await submitHowtoRequest(fb.adminDb, { clientId: r.context.clientId, request: body.request, by: r.decoded?.email || r.decoded?.uid || null });
  return reply(out.ok ? { ...out, clientId: r.context.clientId } : { ...out, error: out.errors ? `${out.error}: ${out.errors.join('; ')}` : out.error });
}

export async function GET(request) {
  let r;
  try { r = await resolve(request); } catch (err) { return json({ error: err.message || 'Unauthorized.' }, err.status || 401); }
  const url = new URL(request.url);
  if (url.searchParams.get('action') !== 'get') return json({ error: 'Unknown action.' }, 400);
  const out = await getHowtoRequest(fb.adminDb, { clientId: r.context.clientId, id: url.searchParams.get('id') });
  return reply(out.ok ? { ...out, clientId: r.context.clientId } : out);
}
