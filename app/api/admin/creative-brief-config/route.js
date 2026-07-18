import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Creative Brief composer config — backs the admin "Brief Composer" card.
// GET returns the normalized config + the section registry (serialized here
// because the client must not import the CJS feature module directly).
// POST saves {include, order} to system_flags/creative_brief_config.
// The brief render (brief-preview + the public hitloop sample) reads the same
// doc via loadCreativeBriefConfig; a missing doc = as-built defaults.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const {
  CREATIVE_BRIEF_GROUPS,
  SIMPLE_BRIEF_GROUPS,
  CREATIVE_BRIEF_LAYOUTS,
  CONFIG_DOC_PATH,
  loadCreativeBriefConfig,
  normalizeCreativeBriefConfig,
} = require('../../../../features/scout-intake/creative-brief-config.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request) {
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }
  const config = await loadCreativeBriefConfig(fb.adminDb);
  return json({ config, groups: CREATIVE_BRIEF_GROUPS, simpleGroups: SIMPLE_BRIEF_GROUPS, layouts: CREATIVE_BRIEF_LAYOUTS });
}

export async function POST(request) {
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }
  const config = normalizeCreativeBriefConfig(body);
  try {
    await fb.adminDb.collection(CONFIG_DOC_PATH.collection).doc(CONFIG_DOC_PATH.doc).set({
      ...config,
      updatedAt: fb.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    return json({ error: err?.message || 'Save failed.' }, 500);
  }
  return json({ ok: true, config });
}
