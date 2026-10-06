// The three content engines (+ identity) — the allocation axis of the Active
// Content System (docs/plans/ACTIVE-CONTENT-SYSTEM-PLAN.md §3).
//
// WHY THIS EXISTS: series are habits ("Record of the Day"); engines are the
// supply lines the calendar balances. A package's engine decides which daily
// allowance it draws from, so high-volume record content cannot crowd out
// original thinking or client work. Series map to an engine by default; a
// package may override it with its own `engine` field.
//
// Pure data + pure helpers. No fs, no network, no clock.

export const ENGINES = {
  record:   'Record archive — taste, music knowledge, history, discovery',
  ue:       'Underground Existence / creative tech — music + systems-building proof',
  client:   'Client work / HITLOOP — commercial application of the same judgment',
  identity: 'Original thinking — takes, quote-reacts, self-quotes that tie it together',
};

export const ENGINE_IDS = Object.keys(ENGINES);

/** Default engine per series. A package's own `engine` field wins. */
export const SERIES_ENGINE = {
  C1: 'record',   // Record of the Day
  C2: 'record',   // Label Vault
  C3: 'record',   // Event Archive — music history, same archive engine
  C4: 'ue',       // Own Productions
  C5: 'ue',       // Hardware / Process
  C6: 'client',   // Design/Dev Artifacts
  C7: 'identity', // Takes with Receipts
  C8: 'identity', // Quote-react
  C9: 'identity', // Self-quote Resurrection
};

export function isEngine(id) {
  return ENGINE_IDS.includes(id);
}

/** The engine a package draws from: its own valid `engine`, else its series
 * default, else 'identity'. Never throws — callers can rely on a valid id. */
export function resolveEngine(pkg) {
  if (pkg && isEngine(pkg.engine)) return pkg.engine;
  return SERIES_ENGINE[pkg?.series] || 'identity';
}
