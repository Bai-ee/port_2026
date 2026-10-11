// Owner-pilot access gate for Content Management. Layered ON TOP of the existing admin/client context:
// it never replaces requireAdminContext/resolveContext, it narrows who may use the pilot feature.
//
//   PILOT_OWNER_UIDS   comma list of Firebase uids allowed to operate the pilot
//   PILOT_CLIENT_IDS   comma list of client ids the pilot may touch
//
// The client id is whatever the SERVER resolved (getEffectiveClientContext); a request body, UI state or model
// output is never an input here. Production fails CLOSED when either list is unset; local/dev defaults the
// client list to the owner client and allows any uid that already passed the admin gate.

const OWNER_CLIENT_ID = 'bryan-balli-WUoltG84';

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
// Fail closed everywhere except an explicit local/dev run: Vercel preview and production deployments both count
// as production (previews share production Firestore), as does any NODE_ENV=production without VERCEL_ENV.
const isProduction = (env) => {
  const v = env.VERCEL_ENV;
  if (v && v !== 'development') return true;
  return env.NODE_ENV === 'production';
};

function deny(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

/**
 * @param {{clientId?:string, ownClientId?:string, impersonating?:boolean}} context  resolved server-side
 * @param {{uid?:string}} decoded  the verified token
 * @returns {{uid:string, clientId:string}}
 * @throws Error with .status 401/403/503
 */
function requirePilotOwner(context, decoded, env = process.env) {
  const uid = decoded?.uid;
  if (!uid) throw deny(401, 'Sign in to use Content Management.', 'pilot-unauthenticated');
  const clientId = context?.clientId;
  if (!clientId) throw deny(404, 'No client workspace was found.', 'pilot-no-client');

  const uids = list(env.PILOT_OWNER_UIDS);
  const clients = list(env.PILOT_CLIENT_IDS);
  const prod = isProduction(env);
  if (prod && (!uids.length || !clients.length)) {
    throw deny(503, 'Content Management pilot access is not configured.', 'pilot-not-configured');
  }
  const allowedClients = clients.length ? clients : [OWNER_CLIENT_ID];
  if (uids.length && !uids.includes(uid)) {
    throw deny(403, 'Content Management is limited to the pilot owner.', 'pilot-not-owner');
  }
  if (!allowedClients.includes(clientId)) {
    throw deny(403, 'Content Management is not enabled for this client.', 'pilot-wrong-client');
  }
  return { uid, clientId };
}

/** uid-only variant for admin routes that have no client context (e.g. the archive inbox's global package store). */
function requirePilotOwnerUid(decoded, env = process.env) {
  const uid = decoded?.uid;
  if (!uid) throw deny(401, 'Sign in to use Content Management.', 'pilot-unauthenticated');
  const uids = list(env.PILOT_OWNER_UIDS);
  if (isProduction(env) && !uids.length) throw deny(503, 'Content Management pilot access is not configured.', 'pilot-not-configured');
  if (uids.length && !uids.includes(uid)) throw deny(403, 'Content Management is limited to the pilot owner.', 'pilot-not-owner');
  return { uid };
}

/** Is this client a pilot client (plan enforcement at scheduling applies)? Dev defaults to the owner client. */
function isPilotClient(clientId, env = process.env) {
  if (!clientId) return false;
  const clients = list(env.PILOT_CLIENT_IDS);
  if (clients.length) return clients.includes(clientId);
  // List unset: the owner client is still a pilot client (in production too), so a mis-set env can never
  // silently drop plan enforcement; requirePilotOwner separately fails closed (503) in production.
  return clientId === OWNER_CLIENT_ID;
}

module.exports = { requirePilotOwner, requirePilotOwnerUid, isPilotClient, OWNER_CLIENT_ID };
