// Where each X data set comes from, per client: 'mac' (free: bird on the owner's Mac) or 'x-api' (paid, works in
// production with the Mac off). Stored at client_configs/{clientId}.marketingBriefConfig.xGrowth.dataSources:
//   { strategyAccounts:'mac'|'x-api', quoteTargets:'mac'|'x-api', autoDaily:{ strategyAccounts:boolean, quoteTargets:boolean } }
// Defaults: everything 'mac' / false. Client-safe pure normalizer + a small Firestore reader/saver.
//
// Persistence: the save is a deep merge on the dotted path (set({marketingBriefConfig:{xGrowth:{dataSources}}},{merge:true})),
// the same way xGrowth.watchlist survives; normalizeXGrowthProfile (marketing-brief/config route, profile saver) does not
// name this block but those writes are merge:true, so it is preserved (test: data-sources.test.js).

export const DATA_SOURCE_KEYS = Object.freeze(['strategyAccounts', 'quoteTargets']);
export const DATA_SOURCE_VALUES = Object.freeze(['mac', 'x-api']);
export const DEFAULT_DATA_SOURCES = Object.freeze({
  strategyAccounts: 'mac',
  quoteTargets: 'mac',
  autoDaily: Object.freeze({ strategyAccounts: false, quoteTargets: false }),
});

const pick = (v) => (DATA_SOURCE_VALUES.includes(v) ? v : 'mac');

/** Pure. Accepts anything; unknown keys dropped. `autoDaily` only ever true for a key whose source is 'x-api'. */
export function normalizeDataSources(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const strategyAccounts = pick(r.strategyAccounts);
  const quoteTargets = pick(r.quoteTargets);
  const auto = r.autoDaily && typeof r.autoDaily === 'object' ? r.autoDaily : {};
  return {
    strategyAccounts,
    quoteTargets,
    autoDaily: {
      strategyAccounts: auto.strategyAccounts === true && strategyAccounts === 'x-api',
      quoteTargets: auto.quoteTargets === true && quoteTargets === 'x-api',
    },
  };
}

/** Partial update onto the stored value (only the keys present in `patch` change), then normalized. */
export function applyDataSourcesPatch(prior, patch) {
  const base = normalizeDataSources(prior);
  const p = patch && typeof patch === 'object' ? patch : {};
  return normalizeDataSources({
    strategyAccounts: p.strategyAccounts !== undefined ? p.strategyAccounts : base.strategyAccounts,
    quoteTargets: p.quoteTargets !== undefined ? p.quoteTargets : base.quoteTargets,
    autoDaily: { ...base.autoDaily, ...(p.autoDaily && typeof p.autoDaily === 'object' ? p.autoDaily : {}) },
  });
}

const okClient = (id) => typeof id === 'string' && id && !id.includes('/');

export async function readDataSources(db, clientId) {
  if (!okClient(clientId)) return normalizeDataSources(null);
  const snap = await db.collection('client_configs').doc(clientId).get();
  return normalizeDataSources(snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth?.dataSources : null);
}

export async function saveDataSources(db, clientId, patch) {
  if (!okClient(clientId)) throw Object.assign(new Error('A client is required.'), { status: 400 });
  const next = applyDataSourcesPatch(await readDataSources(db, clientId), patch);
  await db.collection('client_configs').doc(clientId).set({ marketingBriefConfig: { xGrowth: { dataSources: next } } }, { merge: true });
  return next;
}
