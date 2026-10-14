import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { resolveDashboardClientContext } = require('../_context.cjs');
const { isAdminEmail } = require('../../../../../api/_lib/auth.cjs');
const { markClientBrainStatus, readClientBrainDoc } = require('../../../../../features/client-brain/store.cjs');
const { onBrainStatusChanged, syncBrainToSystem } = require('../../../../../features/client-brain/brain-sync.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request) {
  let context;
  let decoded;
  try {
    ({ context, decoded } = await resolveDashboardClientContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const status = body?.status || 'approved';

  // Re-sync only: push the already-approved Brain into the cards again. Does not
  // change status and does not run adoption. Admin-only.
  if (body?.resync === true) {
    try {
      if (!(await isAdminEmail(decoded?.email))) return json({ error: 'Admin only.' }, 403);
      const brain = await readClientBrainDoc(context.clientId);
      if (!brain || brain.status !== 'approved' || !brain.markdownSource) {
        return json({ error: 'Re-sync needs an approved Brain with Markdown. Approve the Brain first.' }, 409);
      }
      const brainSync = { ...(await syncBrainToSystem(context.clientId, { brain })), adoption: null };
      return json({ ok: true, clientId: context.clientId, brain, brainSync });
    } catch (err) {
      return json({ error: err.message || 'Could not re-sync Client Brain.' }, err.status || 500);
    }
  }
  try {
    const brain = await markClientBrainStatus(context.clientId, status);
    // Approval pushes the Brain into every field it owns (brain-sync.cjs) and
    // keeps the Markdown frontmatter status in step. Non-fatal for the approve.
    let brainSync = null;
    try {
      brainSync = await onBrainStatusChanged(context.clientId, brain);
    } catch (err) {
      brainSync = { error: err.message };
    }
    return json({ ok: true, clientId: context.clientId, brain, brainSync });
  } catch (err) {
    return json({ error: err.message || 'Could not update Client Brain status.' }, err.status || 500);
  }
}
