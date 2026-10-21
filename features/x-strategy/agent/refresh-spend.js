// refresh-spend.js - the agent's own refresh spend ledger: x_agent_refresh_spend/{clientId}/days/{YYYY-MM-DD (UTC)}
// = { usd, runs: [{ at, group, usd }] }. Only ESTIMATES are stored (see PLACEHOLDER_USD in refresh-engine.js): the real
// bill is the provider's. It exists so the owner's daily cap ("Let the agent refresh paid sources") is enforced across
// turns. Pure store interface: get(clientId, day) -> { usd, runs } ; add(clientId, day, entry) -> { usd, runs }.

export const REFRESH_SPEND_COLLECTION = 'x_agent_refresh_spend';
const RUNS_MAX = 60;
const round = (n) => Math.round(n * 10000) / 10000;

export const utcDayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

const empty = () => ({ usd: 0, runs: [] });
const clean = (d) => ({ usd: Number.isFinite(Number(d?.usd)) ? Number(d.usd) : 0, runs: Array.isArray(d?.runs) ? d.runs : [] });

export function createFirestoreRefreshSpendStore(db) {
  const ref = (clientId, day) => db.collection(REFRESH_SPEND_COLLECTION).doc(clientId).collection('days').doc(day);
  return {
    async get(clientId, day) {
      const s = await ref(clientId, day).get();
      return s.exists ? clean(s.data()) : empty();
    },
    // A transaction keeps two concurrent turns from losing each other's entry.
    async add(clientId, day, entry) {
      const r = ref(clientId, day);
      const apply = (cur) => {
        const c = clean(cur);
        return { usd: round(c.usd + entry.usd), runs: [...c.runs, entry].slice(-RUNS_MAX) };
      };
      if (typeof db.runTransaction === 'function') {
        return db.runTransaction(async (tx) => {
          const next = apply((await tx.get(r)).data());
          tx.set(r, next);
          return next;
        });
      }
      const next = apply((await r.get()).data());
      await r.set(next);
      return next;
    },
  };
}

export function createMemoryRefreshSpendStore() {
  const docs = new Map();
  return {
    async get(clientId, day) { return clean(docs.get(`${clientId}/${day}`)); },
    async add(clientId, day, entry) {
      const c = clean(docs.get(`${clientId}/${day}`));
      const next = { usd: round(c.usd + entry.usd), runs: [...c.runs, entry].slice(-RUNS_MAX) };
      docs.set(`${clientId}/${day}`, next);
      return next;
    },
  };
}
