import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext, loadAdminAccess } = require('../../../../api/_lib/client-provisioning.cjs');
const templates = require('../../../../api/_lib/studio-templates.cjs');

// Metadata-only route: reads/writes studio_templates records. No render work,
// no services/studio-render involvement — see docs/plans/STUDIO-ROADMAP-
// NEXT-PHASE-SONNET-HANDOFF.md Slice 3.
export const dynamic = 'force-dynamic';

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

/**
 * Resolves BOTH the effective tenant context (clientId, for scoping reads/
 * writes — impersonation-aware via getEffectiveClientContext) AND the
 * caller's REAL admin status via a SEPARATE loadAdminAccess call.
 *
 * These are deliberately not the same check: getEffectiveClientContext's own
 * `isAdmin` field reflects whether the caller is CURRENTLY IMPERSONATING as
 * an admin (it hardcodes `isAdmin: false` whenever `requested === ownClientId`
 * — i.e. an admin viewing their own dashboard, not impersonating anyone,
 * reads back isAdmin:false from that function). Global-template permission
 * checks need "is this person really an admin at all", not "are they
 * impersonating right now" — same reasoning app/api/dashboard/media/route.js
 * already documents for its own Archive/Publishing admin gate ("Resolve
 * admin from the verified token email, not the impersonation flag").
 */
async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) { const e = new Error('No user record.'); e.status = 404; throw e; }
  const adminAccess = await loadAdminAccess(decoded.email);
  return { decoded, context, isAdmin: adminAccess.isAdmin };
}

function authShape({ decoded, context, isAdmin }) {
  return { clientId: context.clientId || null, uid: decoded.uid, isAdmin };
}

export async function GET(request) {
  let resolved;
  try {
    resolved = await resolveContext(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  const auth = authShape(resolved);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const kind = url.searchParams.get('kind');
  const includeArchived = url.searchParams.get('includeArchived') === '1';

  try {
    if (id) {
      const doc = await templates.getTemplate(id, auth);
      if (!doc) return json({ error: 'Template not found.' }, 404);
      return json({ ok: true, template: doc });
    }
    if (!kind) return json({ error: 'kind is required to list templates.' }, 400);
    const list = await templates.listTemplates({ kind, clientId: auth.clientId, uid: auth.uid, includeArchived });
    return json({ ok: true, templates: list });
  } catch (err) {
    return json({ error: err.message || 'Request failed.' }, err.status || 500);
  }
}

export async function POST(request) {
  let resolved;
  try {
    resolved = await resolveContext(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  const auth = authShape(resolved);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const action = body?.action;
  try {
    switch (action) {
      case 'create': {
        // scope/clientId/ownerUid are NEVER taken from the request body for
        // a non-global scope — clientId always comes from the server-
        // resolved auth context, ownerUid always from the verified token,
        // so a caller cannot forge either. `scope` itself IS caller-chosen
        // (a user picks Client vs. their own private User scope, or Global
        // if they're an admin) — passed through UNCOERCED (default 'client'
        // only when omitted entirely); an invalid value is rejected with 400
        // by createTemplate's own assertValidScope, never silently coerced
        // to 'client' (a prior version of this route did exactly that,
        // which would have let a malformed/typo'd scope value silently
        // succeed as a private client-scope write instead of failing loudly).
        const scope = body.scope === undefined ? 'client' : body.scope;
        const doc = await templates.createTemplate({
          kind: body.kind,
          scope,
          ownerUid: auth.uid,
          clientId: auth.clientId,
          name: body.name,
          recipe: body.recipe,
          sourceSeed: body.sourceSeed,
          isAdmin: auth.isAdmin,
        });
        return json({ ok: true, template: doc }, 201);
      }
      case 'update': {
        if (!body.id) return json({ error: 'id is required.' }, 400);
        const doc = await templates.updateTemplate({
          id: body.id, clientId: auth.clientId, uid: auth.uid, isAdmin: auth.isAdmin,
          name: body.name, recipe: body.recipe, expectedVersion: body.expectedVersion,
        });
        return json({ ok: true, template: doc });
      }
      case 'archive': {
        if (!body.id) return json({ error: 'id is required.' }, 400);
        const doc = await templates.archiveTemplate(body.id, auth);
        return json({ ok: true, template: doc });
      }
      case 'unarchive': {
        if (!body.id) return json({ error: 'id is required.' }, 400);
        const doc = await templates.unarchiveTemplate(body.id, auth);
        return json({ ok: true, template: doc });
      }
      case 'duplicate': {
        if (!body.id) return json({ error: 'id is required.' }, 400);
        const doc = await templates.duplicateTemplate({
          id: body.id, clientId: auth.clientId, uid: auth.uid, isAdmin: auth.isAdmin, name: body.name,
        });
        return json({ ok: true, template: doc }, 201);
      }
      case 'promote': {
        if (!body.id) return json({ error: 'id is required.' }, 400);
        const doc = await templates.promoteToGlobal({ id: body.id, isAdmin: auth.isAdmin });
        return json({ ok: true, template: doc });
      }
      case 'demote': {
        if (!body.id) return json({ error: 'id is required.' }, 400);
        const doc = await templates.demoteGlobal({
          id: body.id, isAdmin: auth.isAdmin, targetClientId: body.targetClientId || auth.clientId, targetScope: body.targetScope,
        });
        return json({ ok: true, template: doc });
      }
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return json({ error: err.message || 'Request failed.' }, err.status || 500);
  }
}
