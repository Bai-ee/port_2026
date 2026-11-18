// Client readiness gate for the content loop (daily loop, quote-targets daily run, MCP regenerate, scheduled cron).
// Replaces the owner-only POC allowlist: a client may run the loop when ITS OWN records say it is set up, never
// because it is the home client. Fails closed: a missing input denies with a code naming that input.
//
// Ready = approved Client Brain + a Strategy plan doc + the client's X identity,
//         OR an explicit per-client override `clients/{id}.contentLoop.enabled === true` (set by the owner).
// X identity = the client's OWN handle (owner rule 2026-11-18): the brand handle (xGrowth.ownHandle, else Brain
// identity.xHandle), else the connected X account, which counts ONLY when it is not the owner's own account
// (the owner connects @bai_ee to client workspaces just to get API access; that never makes @bai_ee the client's
// identity). When a brand handle exists the connected account counts only if its username equals it. The home client
// keeps the owner's account as its own. The loop only DRAFTS, so a strategy-only client (delegates who cannot connect
// the account) still gets it. Posting is unchanged and never goes through this resolver.
// Publishing never relies on this gate; the publish path checks the connected account itself.
// Reads only; writes nothing. `db` is an injected Firestore (admin SDK or the test fake).

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;

/** Ordered checks. `code` is what callers and the UI see; `input` names the record the owner must fix. */
export const READINESS_INPUTS = Object.freeze([
  { input: 'client-brain', code: 'client-brain-not-approved', fix: 'Approve the Client Brain (Client Brain card).' },
  { input: 'strategy-plan', code: 'client-plan-missing', fix: 'Build the Strategy plan (Marketing Director › Strategy).' },
  { input: 'x-account', code: 'client-x-not-connected', fix: 'Save the X handle in Strategy > X profile, or connect X in the Social Accounts card.' },
]);

const cleanHandle = (h) => String(h || '').trim().replace(/^@+/, '') || null;
const sameHandle = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

// Owner credential's X user id (free, parsed from the OAuth1 token). Lazy so this module stays light; null-safe.
async function lookupOwnerUserId() {
  try {
    const { getOwnerReadIdentity } = await import('../social-posting/twitter-service.js');
    return String(getOwnerReadIdentity()?.userId || '') || null;
  } catch { return null; }
}
async function lookupIsHome(clientId) {
  try {
    const { createRequire } = await import('node:module');
    const { resolveDigestClientId } = createRequire(import.meta.url)('../intelligence/_digest-config.js');
    const home = await resolveDigestClientId();
    return Boolean(home) && home === clientId;
  } catch { return false; }
}

// Test seam: lets tests stub the lazy owner/home lookups so they never touch real Firestore or env.
const deps = { lookupOwnerUserId, lookupIsHome };
export function __setReadinessDepsForTest(over) {
  deps.lookupOwnerUserId = over?.lookupOwnerUserId || lookupOwnerUserId;
  deps.lookupIsHome = over?.lookupIsHome || lookupIsHome;
}

/**
 * The connected account's X user id: x.userId, else the `<digits>-` prefix of an oauth1 access token. Null when neither.
 */
export function connectedAccountUserId(x) {
  if (x?.userId) return String(x.userId);
  const m = /^(\d+)-/.exec(String(x?.oauth1?.accessToken || ''));
  return m ? m[1] : null;
}

/**
 * Does the connected X account count as THIS client's identity? Pure.
 * brand handle present -> only when the username equals it; no brand handle -> only when its userId is not
 * the owner's (fails closed when the owner id is unknown); a userId-less doc counts only when it is the client's own
 * oauth1 dev app. `isHome` (the owner's own client) always counts.
 */
export function connectedAccountCounts(x, { brandHandle, ownerUserId, isHome = false } = {}) {
  const username = cleanHandle(x?.username);
  if (isHome) return !!username;
  if (!username) return false;
  if (brandHandle) return sameHandle(username, brandHandle);
  // A userId-less doc counts only when it is the client's OWN dev app (oauth1): the owner's cross-client
  // connections go through HITLOOP's OAuth2 app. Anything else unverifiable fails closed.
  const userId = connectedAccountUserId(x);
  if (!userId) return Boolean(x?.oauth1);
  if (!ownerUserId) return false;
  return userId !== String(ownerUserId);
}

/** The client's brand handle only (never the connected account): xGrowth.ownHandle, then Brain identity.xHandle (any status). */
export async function resolveBrandHandle(db, clientId, { xGrowth } = {}) {
  if (!db) throw new Error('resolveBrandHandle: db is required');
  const id = String(clientId || '').trim();
  if (!CLIENT_ID_RE.test(id)) throw Object.assign(new Error('A valid clientId is required.'), { status: 400, code: 'client-id-required' });
  const growth = xGrowth !== undefined ? xGrowth : (await readDoc(db, `client_configs/${id}`))?.marketingBriefConfig?.xGrowth;
  const fromProfile = cleanHandle(growth?.ownHandle);
  if (fromProfile) return { handle: fromProfile, source: 'xgrowth-profile' };
  // Deliberately any Brain status: this only names the account (identity), it is not copy fed to a model.
  const brain = await readDoc(db, `clients/${id}/client_brain/current`);
  const fromBrain = cleanHandle(brain?.identity?.xHandle);
  if (fromBrain) return { handle: fromBrain, source: 'client-brain' };
  return { handle: null, source: null };
}

// Brand first; the connected account only under connectedAccountCounts. `isHome`/`ownerUserId` resolve lazily, and only
// when they can matter (no brand handle and a connected account exists), so the common paths stay pure.
async function pickIdentity(x, brand, { ownerUserId, isHome, clientId }) {
  const username = cleanHandle(x?.username);
  if (brand.handle) return brand;
  if (!username) return { handle: null, source: null };
  // The owner id only matters when the account has an id to compare; skip the lookup otherwise.
  const owner = ownerUserId === undefined && connectedAccountUserId(x) ? await deps.lookupOwnerUserId() : (ownerUserId ?? null);
  const counts = (home) => connectedAccountCounts(x, { brandHandle: null, ownerUserId: owner, isHome: home });
  if (counts(false)) return { handle: username, source: 'social-account' };
  const home = isHome === undefined ? await deps.lookupIsHome(clientId) : isHome;
  return counts(home) ? { handle: username, source: 'social-account' } : { handle: null, source: null };
}

// collection/doc chaining (not db.doc(path)) so the in-memory test Firestore works too.
async function readDoc(db, path) {
  const parts = path.split('/');
  let ref = db.collection(parts[0]).doc(parts[1]);
  for (let i = 2; i < parts.length; i += 2) ref = ref.collection(parts[i]).doc(parts[i + 1]);
  const snap = await ref.get();
  return snap.exists ? (snap.data() || {}) : null;
}

/**
 * Read-only readiness report. Never throws for a not-ready client; throws only on a bad clientId or a db failure.
 * @param {object} [opts] { ownerUserId?: owner's X user id (default: lazy getOwnerReadIdentity, null-safe), isHome?: boolean (default: lazy digest-client lookup, only when needed) }
 * @returns {Promise<{clientId:string, exists:boolean, ready:boolean, override:boolean, missing:{input:string,code:string,fix:string}[], xHandle:string|null, xSource:'social-account'|'xgrowth-profile'|'client-brain'|null, brainStatus:string|null}>}
 */
export async function readClientReadiness(db, clientId, opts = {}) {
  if (!db) throw new Error('readClientReadiness: db is required');
  const id = String(clientId || '').trim();
  if (!CLIENT_ID_RE.test(id)) throw Object.assign(new Error('A valid clientId is required.'), { status: 400, code: 'client-id-required' });

  const [client, brain, plan, social, config] = await Promise.all([
    readDoc(db, `clients/${id}`),
    readDoc(db, `clients/${id}/client_brain/current`),
    readDoc(db, `x_strategy_plans/${id}`),
    readDoc(db, `social_accounts/${id}`),
    readDoc(db, `client_configs/${id}`),
  ]);
  const brainStatus = brain?.status || null;
  const profileHandle = cleanHandle(config?.marketingBriefConfig?.xGrowth?.ownHandle);
  const brainHandle = cleanHandle(brain?.identity?.xHandle);
  const brand = profileHandle ? { handle: profileHandle, source: 'xgrowth-profile' } : brainHandle ? { handle: brainHandle, source: 'client-brain' } : { handle: null, source: null };
  const { handle: xHandle, source: xSource } = await pickIdentity(social?.platforms?.x, brand, { ownerUserId: opts.ownerUserId, isHome: opts.isHome, clientId: id });
  const override = client?.contentLoop?.enabled === true;
  const has = {
    'client-brain': brainStatus === 'approved',
    'strategy-plan': !!plan,
    'x-account': !!xHandle,
  };
  const missing = READINESS_INPUTS.filter((r) => !has[r.input]);
  return { clientId: id, exists: !!client, ready: !!client && (override || missing.length === 0), override, missing, xHandle, xSource, brainStatus };
}

/**
 * Throws 403 unless the client is ready. The error `code` names the first missing input
 * (`client-not-found` when the clients doc is absent); `missing` carries them all.
 */
export async function assertClientReady(db, clientId, opts) {
  const r = await readClientReadiness(db, clientId, opts);
  if (r.ready) return r;
  if (!r.exists) {
    throw Object.assign(new Error(`Client ${r.clientId} does not exist.`), { status: 403, code: 'client-not-found', missing: [] });
  }
  const names = r.missing.map((m) => m.input).join(', ');
  throw Object.assign(
    new Error(`The content loop is not set up for ${r.clientId}: missing ${names}. ${r.missing.map((m) => m.fix).join(' ')}`),
    { status: 403, code: r.missing[0].code, missing: r.missing.map((m) => m.code) },
  );
}

/**
 * The client's own X handle, from its own records only (never a home/owner default):
 * brand handle (xGrowth.ownHandle → Brain identity.xHandle, any status), else the connected social_accounts username
 * ONLY when it is the client's own (see connectedAccountCounts: never the owner's @bai_ee used just for API access).
 * @param {object} [opts] { xGrowth?: saved marketingBriefConfig.xGrowth (skips the client_configs read when given), ownerUserId?, isHome? }
 * @returns {Promise<{handle:string|null, source:string|null}>}
 */
export async function resolveClientXHandle(db, clientId, { xGrowth, ownerUserId, isHome } = {}) {
  const brand = await resolveBrandHandle(db, clientId, { xGrowth });
  const id = String(clientId).trim();
  const social = await readDoc(db, `social_accounts/${id}`);
  return pickIdentity(social?.platforms?.x, brand, { ownerUserId, isHome, clientId: id });
}

/** Like resolveClientXHandle but throws 409 `client-x-handle-missing` when the client has no handle anywhere. */
export async function requireClientXHandle(db, clientId, opts) {
  const r = await resolveClientXHandle(db, clientId, opts);
  if (r.handle) return r;
  throw Object.assign(
    new Error(`No X handle on record for ${clientId}: connect X in the Social Accounts card, save the X profile in Strategy, or add "X Handle" to the Client Brain.`),
    { status: 409, code: 'client-x-handle-missing' },
  );
}
