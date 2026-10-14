// Per-client quote-target watchlist (multi-client Phase 4.4).
// Stored at client_configs/{clientId}.marketingBriefConfig.xGrowth.watchlist as an array of
// { handle, vein, note?, unproven? } (the same shape as HOME_SEED_WATCHLIST entries).
// Fail closed: absent / malformed => [] (no tracked accounts), never the home seed.

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Keep only well-formed entries (valid handle, string vein), de-duplicated by handle (case-insensitive).
 * @param {unknown} list
 * @returns {{handle:string, vein:string, note?:string, unproven?:boolean}[]}
 */
export function normalizeWatchlist(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const handle = String(raw.handle || '').trim().replace(/^@+/, '');
    const vein = typeof raw.vein === 'string' ? raw.vein.trim() : '';
    if (!HANDLE_RE.test(handle) || !vein) continue;
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      handle, vein,
      ...(typeof raw.note === 'string' && raw.note ? { note: raw.note } : {}),
      ...(raw.unproven ? { unproven: true } : {}),
    });
  }
  return out;
}

/** The watchlist from a client's raw marketingBriefConfig.xGrowth (pure). */
export function watchlistFromXGrowth(xGrowth) {
  return normalizeWatchlist(xGrowth?.watchlist);
}

/**
 * Read one client's stored watchlist. Firestore read only; [] when the client, config or field is absent.
 * @param {{collection:Function}} db  firebase-admin Firestore
 * @param {string} clientId
 */
export async function readClientWatchlist(db, clientId) {
  if (!clientId || typeof clientId !== 'string' || clientId.includes('/')) return [];
  const snap = await db.collection('client_configs').doc(clientId).get();
  return snap.exists ? watchlistFromXGrowth(snap.data()?.marketingBriefConfig?.xGrowth) : [];
}

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const splitIds = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Which clients one scan run covers (pure). --client <id> | --clients a,b,c | --pilot (env PILOT_CLIENT_IDS).
 * Order kept, duplicates dropped. No ids => { error } (never a default client).
 * @param {{client?:string, clients?:string, pilot?:boolean}} args
 * @param {Record<string,string|undefined>} [env]
 * @returns {{clientIds:string[]} | {error:string}}
 */
export function resolveScanClients({ client = '', clients = '', pilot = false } = {}, env = {}) {
  const ids = [...splitIds(client), ...splitIds(clients), ...(pilot ? splitIds(env.PILOT_CLIENT_IDS) : [])];
  if (pilot && !splitIds(env.PILOT_CLIENT_IDS).length) return { error: '--pilot needs PILOT_CLIENT_IDS (comma list) in the environment.' };
  const bad = ids.filter((id) => !CLIENT_ID_RE.test(id));
  if (bad.length) return { error: `invalid client id(s): ${bad.join(', ')}` };
  const clientIds = [...new Set(ids)];
  if (!clientIds.length) return { error: 'a client is required: --client <id>, --clients a,b,c or --pilot.' };
  return { clientIds };
}

/**
 * The accounts one client's scan fetches (pure): proven entries first, then unproven, so a truncated scan keeps the
 * highest-value half; `maxAccounts` rotates by `offset`; `only` narrows to one handle on the list.
 * @param {{handle:string, unproven?:boolean}[]} watchlist  the client's stored list
 */
export function selectScanTargets(watchlist, { only = '', maxAccounts = 0, offset = 0 } = {}) {
  const list = Array.isArray(watchlist) ? watchlist : [];
  if (only) {
    const want = String(only).replace(/^@/, '').toLowerCase();
    return list.filter((a) => String(a.handle).toLowerCase() === want);
  }
  const ordered = [...list].sort((a, b) => Number(!!a.unproven) - Number(!!b.unproven));
  if (!ordered.length || !maxAccounts || maxAccounts >= ordered.length) return ordered;
  const start = ((offset % ordered.length) + ordered.length) % ordered.length;
  return Array.from({ length: maxAccounts }, (_, i) => ordered[(start + i) % ordered.length]);
}
