// Client readiness gate for the content loop (daily loop, quote-targets daily run, MCP regenerate, scheduled cron).
// Replaces the owner-only POC allowlist: a client may run the loop when ITS OWN records say it is set up, never
// because it is the home client. Fails closed: a missing input denies with a code naming that input.
//
// Ready = approved Client Brain + a Strategy plan doc + a connected X account,
//         OR an explicit per-client override `clients/{id}.contentLoop.enabled === true` (set by the owner).
// Reads only; writes nothing. `db` is an injected Firestore (admin SDK or the test fake).

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;

/** Ordered checks. `code` is what callers and the UI see; `input` names the record the owner must fix. */
export const READINESS_INPUTS = Object.freeze([
  { input: 'client-brain', code: 'client-brain-not-approved', fix: 'Approve the Client Brain (Client Brain card).' },
  { input: 'strategy-plan', code: 'client-plan-missing', fix: 'Build the Strategy plan (Marketing Director › Strategy).' },
  { input: 'x-account', code: 'client-x-not-connected', fix: 'Connect X in the Social Accounts card.' },
]);

const cleanHandle = (h) => String(h || '').trim().replace(/^@+/, '') || null;

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
 * @returns {Promise<{clientId:string, exists:boolean, ready:boolean, override:boolean, missing:{input:string,code:string,fix:string}[], xUsername:string|null, brainStatus:string|null}>}
 */
export async function readClientReadiness(db, clientId) {
  if (!db) throw new Error('readClientReadiness: db is required');
  const id = String(clientId || '').trim();
  if (!CLIENT_ID_RE.test(id)) throw Object.assign(new Error('A valid clientId is required.'), { status: 400, code: 'client-id-required' });

  const [client, brain, plan, social] = await Promise.all([
    readDoc(db, `clients/${id}`),
    readDoc(db, `clients/${id}/client_brain/current`),
    readDoc(db, `x_strategy_plans/${id}`),
    readDoc(db, `social_accounts/${id}`),
  ]);
  const brainStatus = brain?.status || null;
  const xUsername = cleanHandle(social?.platforms?.x?.username);
  const override = client?.contentLoop?.enabled === true;
  const has = {
    'client-brain': brainStatus === 'approved',
    'strategy-plan': !!plan,
    'x-account': !!xUsername,
  };
  const missing = READINESS_INPUTS.filter((r) => !has[r.input]);
  return { clientId: id, exists: !!client, ready: !!client && (override || missing.length === 0), override, missing, xUsername, brainStatus };
}

/**
 * Throws 403 unless the client is ready. The error `code` names the first missing input
 * (`client-not-found` when the clients doc is absent); `missing` carries them all.
 */
export async function assertClientReady(db, clientId) {
  const r = await readClientReadiness(db, clientId);
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
 * social_accounts username → saved xGrowth profile ownHandle → Brain identity xHandle (any status).
 * @param {object} [opts] { xGrowth?: saved marketingBriefConfig.xGrowth (skips the client_configs read when given) }
 * @returns {Promise<{handle:string|null, source:string|null}>}
 */
export async function resolveClientXHandle(db, clientId, { xGrowth } = {}) {
  if (!db) throw new Error('resolveClientXHandle: db is required');
  const id = String(clientId || '').trim();
  if (!CLIENT_ID_RE.test(id)) throw Object.assign(new Error('A valid clientId is required.'), { status: 400, code: 'client-id-required' });
  const social = await readDoc(db, `social_accounts/${id}`);
  const fromSocial = cleanHandle(social?.platforms?.x?.username);
  if (fromSocial) return { handle: fromSocial, source: 'social-account' };
  const growth = xGrowth !== undefined ? xGrowth : (await readDoc(db, `client_configs/${id}`))?.marketingBriefConfig?.xGrowth;
  const fromProfile = cleanHandle(growth?.ownHandle);
  if (fromProfile) return { handle: fromProfile, source: 'xgrowth-profile' };
  // Deliberately any Brain status: this only names the account (identity), it is not copy fed to a model.
  const brain = await readDoc(db, `clients/${id}/client_brain/current`);
  const fromBrain = cleanHandle(brain?.identity?.xHandle);
  if (fromBrain) return { handle: fromBrain, source: 'client-brain' };
  return { handle: null, source: null };
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
