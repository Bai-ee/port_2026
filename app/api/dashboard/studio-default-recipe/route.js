import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { loadAdminAccess } = require('../../../../api/_lib/client-provisioning.cjs');
const { readSignupRecipeConfig, writeSignupRecipeConfig } = require('../../../../api/_lib/signup-video-recipe.cjs');

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

// The signup video template is global config — admin only.
async function requireAdmin(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const access = await loadAdminAccess(decoded.email);
  if (!access.isAdmin) { const e = new Error('Forbidden: admin access required.'); e.status = 403; throw e; }
  return decoded;
}

export async function GET(request) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  try {
    const config = await readSignupRecipeConfig();
    return json({ ok: true, ...config });
  } catch (err) {
    return json({ error: `Could not read the signup video template: ${err.message}` }, 500);
  }
}

export async function PUT(request) {
  let decoded;
  try {
    decoded = await requireAdmin(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  // Accept either the recipe directly or { recipe }. url is ignored — it's
  // injected per signup at render time.
  const rawRecipe = body?.recipe && typeof body.recipe === 'object' ? body.recipe : body;
  if (!rawRecipe || typeof rawRecipe !== 'object') {
    return json({ error: 'A recipe object is required.' }, 400);
  }

  try {
    const config = await writeSignupRecipeConfig(rawRecipe, { email: decoded.email });
    return json({ ok: true, ...config });
  } catch (err) {
    return json({ error: `Could not save the signup video template: ${err.message}` }, 500);
  }
}
