// Defensive wrapper around the WS2 draft store (contract 7.5). The UI talks only
// to this adapter, so a missing optional method or a partial snapshot degrades to
// a no-op instead of throwing, and snapshots keep their referential stability.

const METHODS = [
  'startDraft', 'discardDraft', 'saveDraft', 'loadSaved', 'setApplied', 'updateDraft', 'commitTransient',
  'undo', 'redo', 'resetRole', 'resetMode', 'resetDraft', 'setEditingMode', 'setPreviewMode', 'setCompare',
  'exportBundle', 'importText', 'acceptExternal', 'keepMine',
];

export const EMPTY_SNAPSHOT = Object.freeze({
  active: false,
  applied: false,
  draft: null,
  production: null,
  dirty: false,
  differsFromProduction: false,
  savedAt: null,
  canUndo: false,
  canRedo: false,
  editingMode: 'light',
  previewMode: null,
  compare: 'draft',
  resolved: null,
  report: null,
  reportPending: false,
  externalChange: false,
  storageAvailable: true,
});

const cache = new WeakMap();

export function normalizeSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return EMPTY_SNAPSHOT;
  const hit = cache.get(snap);
  if (hit) return hit;
  const out = { ...EMPTY_SNAPSHOT, ...snap };
  if (out.editingMode !== 'light' && out.editingMode !== 'dark') out.editingMode = 'light';
  if (out.compare !== 'production') out.compare = 'draft';
  cache.set(snap, out);
  return out;
}

export function createStudioStore(raw) {
  const adapter = {
    raw,
    subscribe: (fn) => (raw && typeof raw.subscribe === 'function' ? raw.subscribe(fn) : () => {}),
    getSnapshot: () => normalizeSnapshot(raw && raw.getSnapshot && raw.getSnapshot()),
    getServerSnapshot: () => normalizeSnapshot(raw && (raw.getServerSnapshot ? raw.getServerSnapshot() : raw.getSnapshot && raw.getSnapshot())),
    has: (name) => !!raw && typeof raw[name] === 'function',
  };
  for (const name of METHODS) {
    adapter[name] = (...args) => (raw && typeof raw[name] === 'function' ? raw[name](...args) : undefined);
  }
  return adapter;
}
