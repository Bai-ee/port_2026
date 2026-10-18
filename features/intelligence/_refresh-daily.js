// Daily (automatic) refresh profile — which Refresh groups the unattended crons run for a client.
//
// Stored on digest_config/{clientId}.refreshDaily = { enabled, groups[], updatedAt, updatedBy }.
// Edited from the Refresh modal's "Daily" tab (admin route app/api/admin/refresh-daily). Manual refreshes
// ("Run now" tab, Generate & Send) never read it: it only gates what the crons do on their own.
//
// No saved profile = the default derived from what the crons ran before this existed, so shipping it changes
// nothing until the owner saves a profile: enabled, every cron-run group ticked, X search only when the legacy
// per-client dailyXSearch opt-in was on.
//
// CommonJS: required from the ESM worker routes (createRequire) and pure enough for node tests.

// Refresh groups an unattended cron can run (ids match components/dashboard/marketing/refresh-groups.js).
//   renders        -> pre-digest-refresh phase=modules
//   market-signals -> pre-digest-refresh phase=signals (Scout, watchlist, Reddit/IG, Opportunity without X)
//   x-search       -> pre-digest-refresh phase=signals, the paid X part (Opportunity on X + Market Talk on X)
//   analysis       -> pre-digest-refresh phase=analysis
//   today-queue    -> daily-loop (Today's suggestions + calendar fill)
const DAILY_GROUP_IDS = Object.freeze(['market-signals', 'x-search', 'analysis', 'renders', 'today-queue']);

function defaultRefreshDaily(rawConfig = {}) {
  return {
    enabled: true,
    groups: ['market-signals', 'analysis', 'renders', 'today-queue', ...(rawConfig?.dailyXSearch === true ? ['x-search'] : [])],
  };
}

function normalizeRefreshDaily(value) {
  const v = value && typeof value === 'object' ? value : {};
  const groups = [...new Set((Array.isArray(v.groups) ? v.groups : []).map((g) => String(g || '').trim()))]
    .filter((g) => DAILY_GROUP_IDS.includes(g));
  return { enabled: v.enabled !== false, groups };
}

/** Effective profile from a raw digest_config doc: the saved one, else the legacy-equivalent default. */
function resolveRefreshDaily(rawConfig = {}) {
  const saved = rawConfig?.refreshDaily;
  if (saved && typeof saved === 'object') {
    return { ...normalizeRefreshDaily(saved), saved: true, updatedAt: saved.updatedAt || null, updatedBy: saved.updatedBy || null };
  }
  return { ...defaultRefreshDaily(rawConfig), saved: false, updatedAt: null, updatedBy: null };
}

/** The group set an unattended cron may run for this client (empty when the Daily switch is off). */
function cronGroupsFor(profile) {
  return new Set(profile?.enabled ? profile.groups : []);
}

function db() {
  return require('../../api/_lib/firebase-admin.cjs').adminDb;
}

async function readRefreshDaily(clientId) {
  if (!clientId) return resolveRefreshDaily({});
  const snap = await db().collection('digest_config').doc(String(clientId)).get();
  return resolveRefreshDaily(snap.exists ? snap.data() || {} : {});
}

async function saveRefreshDaily(clientId, input = {}, { by = null } = {}) {
  if (!clientId) throw Object.assign(new Error('clientId is required.'), { status: 400 });
  const next = { ...normalizeRefreshDaily(input), updatedAt: new Date().toISOString(), updatedBy: by ? String(by).slice(0, 200) : null };
  await db().collection('digest_config').doc(String(clientId)).set({ refreshDaily: next }, { merge: true });
  return { ...next, saved: true };
}

module.exports = {
  DAILY_GROUP_IDS,
  defaultRefreshDaily,
  normalizeRefreshDaily,
  resolveRefreshDaily,
  cronGroupsFor,
  readRefreshDaily,
  saveRefreshDaily,
};
