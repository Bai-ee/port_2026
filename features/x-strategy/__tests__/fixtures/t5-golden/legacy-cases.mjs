// Inputs shared by the throwaway legacy-capture script and t5-golden.test.js. The expected OUTPUTS (legacy-golden.json)
// were produced by running the pre-T5 route functions extracted verbatim from `git show 5cfce1e9:app/api/dashboard/quote-targets/route.js`.
export const DATE = '2026-10-11';

export const REFRESH_CASES = {
  'profile-default': { ownHandle: 'bai_ee', benchmarkHandles: ['seb__design'] },
  'profile-lanes-tier-two-benchmarks': { ownHandle: 'bai_ee', benchmarkHandles: ['seb__design', 'peer'], lanes: ['design', 'web3'], tierOverride: 2, timezone: 'America/Chicago' },
  'no-profile': null,
  'incomplete-profile-no-benchmark': { ownHandle: 'bai_ee' },
  'own-corpus-missing': { ownHandle: 'nobody', benchmarkHandles: ['seb__design'] },
  'no-benchmark-corpus': { ownHandle: 'bai_ee', benchmarkHandles: ['ghost'] },
};

export const CONTENT_PLAN_CASES = {
  'posts5-no-profile': { config: null, body: { date: DATE } },
  'posts8-profile-with-lanes': { config: { ownHandle: 'other_acct', benchmarkHandles: ['peer'], lanes: ['design', 'web3'] }, body: { date: DATE, posts: 8 } },
  'posts3-default-profile': { config: { ownHandle: 'bai_ee', benchmarkHandles: ['seb__design'] }, body: { date: DATE, posts: 3 } },
};

/** x_corpora stat-block readers as the pre-T5 route used them (readCorpus / readCorpora). */
export function makeLegacyReaders({ own, bench, summarizeCorpus }) {
  const blocks = {
    bai_ee: { handle: 'bai_ee', stats: summarizeCorpus(own, { handle: 'bai_ee' }), meta: { source: 'ingest', posts: own.length, ingestedAt: 1760000000000 } },
    seb__design: { handle: 'seb__design', stats: summarizeCorpus(bench, { handle: 'seb__design' }), meta: { source: 'ingest', posts: bench.length, ingestedAt: 1760000000001 } },
    peer: { handle: 'peer', stats: summarizeCorpus(bench.slice(0, 200), { handle: 'peer' }), meta: { source: 'ingest', posts: 200, ingestedAt: 1760000000002 } },
  };
  const key = (h) => String(h ?? '').trim().replace(/^@+/, '').toLowerCase();
  return {
    readCorpus: async (h) => blocks[key(h)] ?? null,
    readCorpora: async (hs) => [...new Set(hs.map(key))].map((k) => blocks[k]).filter(Boolean),
  };
}
